const { systemLogger } = require('../logger/Logger');
const exchangeUtils = require('../exchange/ExchangeUtils');

/**
 * 成交量动态正态分布策略
 * 基于 norm_policy.txt 实现，适配3分钟K线周期
 * 
 * 参数调整说明（2分钟 -> 3分钟）：
 * - K线数量：720根保持不变（代表36小时的历史数据）
 * - 窗口阈值：0.3倍峰值成交量
 * - 边沿定义：前后各4根K线（原2分钟为前后3根）
 * - Delta阈值：1200（原2分钟为800，按1.5倍调整）
 * - 环比爆发：2.0倍（原2.2倍，3分钟周期波动更大需要降低）
 * - 5期均值比：1.8倍（原1.9倍，同理调整）
 */
class VolumeProfileStrategy {
  constructor() {
    this.klineLimit = 720; // 720根3分钟K线 = 36小时
    this.windowThreshold = 0.3; // 窗口阈值：峰值的30%
    this.edgeRange = 4; // 边沿范围：前后4根K线
    this.valueAreaPercentage = 0.7; // 价值区域：70%成交量
    this.quietMode = false; // 静默模式（回测时减少日志）
    
    // 模块B参数（适配3分钟 - 激进版）
    // 目标：让边沿触发能有5-20%转化为信号
    this.params = {
      P1_WEIGHT: 0.25,  // 边沿位置权重（基础分）
      P2_LOCAL_Z_THRESHOLD: 1.2,  // 局部Z值阈值（激进：1.8 -> 1.2）
      P2_WEIGHT: 0.20,
      P3_GLOBAL_Z_THRESHOLD: 1.0,  // 全局Z值阈值（激进：1.5 -> 1.0）
      P3_WEIGHT: 0.15,
      P4_VOLUME_RATIO: 1.3,  // 环比爆发（激进：1.6 -> 1.3）
      P4_WEIGHT: 0.20,
      P5_MA5_RATIO: 1.2,  // 5期均值比（激进：1.5 -> 1.2）
      P5_WEIGHT: 0.10,
      P6_DIST_STRENGTH: 0.9,  // 分布强度（激进：1.2 -> 0.9）
      P6_WEIGHT: 0.05,
      P7_CONTINUATION_RATIO: 0.6,  // 次根持续
      P7_WEIGHT: 0.03,
      P8_WEIGHT: 0.02,  // 时段权重
      
      // 最低分数要求（P1 + 任意1-2个其他条件即可）
      MIN_SCORE_B: 0.35  // 降低：从0.25提高到0.35，但条件更容易满足
    };
    
    // 模块C参数（适配3分钟）
    this.moduleC = {
      ORDERBOOK_RATIO_LONG: 2.8,  // 多头订单簿比率
      ORDERBOOK_RATIO_SHORT: 0.35,  // 空头订单簿比率
      DELTA_THRESHOLD_LONG: 1200,  // Delta阈值-多头（调整：800 -> 1200）
      DELTA_THRESHOLD_SHORT: -1200,  // Delta阈值-空头
      FUNDING_RATE_LONG: -0.0001,  // 资金费率-多头
      FUNDING_RATE_SHORT: 0.0003  // 资金费率-空头
    };
    
    // 模块D参数（融合决策 - 激进调整，匹配实际ScoreB范围0.4-0.7）
    this.moduleD = {
      SCORE_B_STRONG: 0.50,  // 降低：0.80 -> 0.50
      SCORE_C_STRONG: 0.65,  // 降低：0.75 -> 0.65
      SCORE_C_LIGHT: 0.50,   // 保持：0.50
      FINAL_SCORE_THRESHOLD: 0.48,  // 大幅降低：0.78 -> 0.48
      WEIGHT_B: 0.6,  // ScoreB权重60%
      WEIGHT_C: 0.4   // ScoreC权重40%
    };
  }

  /**
   * 模块A：成交量动态正态分布系统（从K线数据计算）
   * 计算VAH, VAL, VPOC
   * @param {Array} klines - K线数据数组
   * @param {string} symbol - 交易对（用于日志）
   */
  async calculateVolumeProfileFromKlines(klines, symbol = '') {
    try {
      const logPrefix = symbol ? `${symbol} ` : '';
      if (!this.quietMode) {
        systemLogger.info(`[模块A] 开始计算${logPrefix}成交量分布...`);
      }
      
      if (!klines || klines.length < this.klineLimit) {
        systemLogger.error(`[模块A] ${logPrefix}K线数据不足，需要${this.klineLimit}根，实际${klines ? klines.length : 0}根`);
        return null;
      }

      // 提取成交量序列
      const volumes = klines.map(k => k[5]); // [timestamp, open, high, low, close, volume]
      const prices = klines.map(k => ({
        timestamp: k[0],
        open: k[1],
        high: k[2],
        low: k[3],
        close: k[4],
        volume: k[5],
        midPrice: (k[2] + k[3]) / 2  // (high + low) / 2
      }));

      // 简化版：找到最大成交量峰值（替代GMM）
      const meanVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
      const stdVolume = this.calculateStd(volumes, meanVolume);
      const threshold = meanVolume + 1.5 * stdVolume;

      // 找到所有超过阈值的峰值
      const peaks = [];
      for (let i = 6; i < volumes.length - 6; i++) {
        if (volumes[i] > threshold) {
          // 确保是局部最大值
          const isLocalMax = volumes[i] >= volumes[i-1] && volumes[i] >= volumes[i+1];
          if (isLocalMax) {
            // 检查与已有峰值的距离
            const tooClose = peaks.some(p => Math.abs(p.index - i) < 6);
            if (!tooClose) {
              peaks.push({ index: i, volume: volumes[i] });
            }
          }
        }
      }

      if (peaks.length === 0) {
        systemLogger.warn(`[模块A] ${logPrefix}未找到显著的成交量峰值`);
        return null;
      }

      // 选择成交量最大的峰值
      const mainPeak = peaks.reduce((max, p) => p.volume > max.volume ? p : max, peaks[0]);
      systemLogger.info(`[模块A] ${logPrefix}主峰位置: 索引=${mainPeak.index}, 成交量=${mainPeak.volume.toFixed(2)}`);

      // 确定分析窗口
      const windowThresholdVol = mainPeak.volume * this.windowThreshold;
      let leftIdx = mainPeak.index;
      let rightIdx = mainPeak.index;

      // 向左扩展
      while (leftIdx > 0 && volumes[leftIdx] >= windowThresholdVol) {
        leftIdx--;
      }

      // 向右扩展
      while (rightIdx < volumes.length - 1 && volumes[rightIdx] >= windowThresholdVol) {
        rightIdx++;
      }

      systemLogger.info(`[模块A] ${logPrefix}分析窗口: [${leftIdx}, ${rightIdx}], 长度=${rightIdx - leftIdx + 1}`);

      // 在窗口内计算成交量剖面
      const windowData = prices.slice(leftIdx, rightIdx + 1);
      const volumeProfile = this.buildVolumeProfile(windowData);

      // 找到VPOC（成交量最大的价格）
      const vpocEntry = volumeProfile.reduce((max, entry) => 
        entry.volume > max.volume ? entry : max, volumeProfile[0]
      );
      const VPOC = vpocEntry.price;

      // 计算价值区（VAH/VAL）
      const totalVolume = volumeProfile.reduce((sum, entry) => sum + entry.volume, 0);
      const targetVolume = totalVolume * this.valueAreaPercentage;
      
      const { VAH, VAL } = this.calculateValueArea(volumeProfile, vpocEntry, targetVolume);

      // 定义边沿索引
      const valIdx = this.findFirstPriceIndex(prices, VAL);
      const vahIdx = this.findFirstPriceIndex(prices, VAH);

      const lowerEdgeIndices = [];
      const upperEdgeIndices = [];
      
      if (valIdx !== -1) {
        for (let i = Math.max(0, valIdx - this.edgeRange); i <= Math.min(prices.length - 1, valIdx + this.edgeRange); i++) {
          lowerEdgeIndices.push(i);
        }
      }
      
      if (vahIdx !== -1) {
        for (let i = Math.max(0, vahIdx - this.edgeRange); i <= Math.min(prices.length - 1, vahIdx + this.edgeRange); i++) {
          upperEdgeIndices.push(i);
        }
      }

      // 计算窗口内的统计数据
      const windowVolumes = volumes.slice(leftIdx, rightIdx + 1);
      const distMean = windowVolumes.reduce((a, b) => a + b, 0) / windowVolumes.length;
      const distStd = this.calculateStd(windowVolumes, distMean);
      const distPeakVol = Math.max(...windowVolumes);

      const result = {
        VAH,
        VAL,
        VPOC,
        lowerEdgeIndices,
        upperEdgeIndices,
        distMean,
        distStd,
        distPeakVol,
        meanVolume720: meanVolume,
        stdVolume720: stdVolume,
        windowRange: [leftIdx, rightIdx],
        latestIndex: prices.length - 1  // 最新K线的索引
      };

      systemLogger.info(`[模块A] ${logPrefix}计算完成: VAH=${VAH.toFixed(2)}, VAL=${VAL.toFixed(2)}, VPOC=${VPOC.toFixed(2)}`);
      return result;

    } catch (error) {
      systemLogger.error(`[模块A] ${logPrefix}计算成交量分布失败: ${error.message}`);
      return null;
    }
  }

  /**
   * 模块A：成交量动态正态分布系统（实盘模式 - 从API获取）
   * 计算VAH, VAL, VPOC
   */
  async calculateVolumeProfile(symbol) {
    try {
      // 获取720根3分钟K线
      const klines = await exchangeUtils.fetchOHLCV(symbol, '3m', this.klineLimit);
      if (!klines || klines.length < this.klineLimit) {
        systemLogger.error(`[模块A] ${symbol} K线数据不足`);
        return null;
      }

      return await this.calculateVolumeProfileFromKlines(klines, symbol);
    } catch (error) {
      systemLogger.error(`[模块A] ${symbol} 获取数据失败: ${error.message}`);
      return null;
    }
  }

  /**
   * 构建成交量剖面
   */
  buildVolumeProfile(priceData) {
    const profile = {};
    
    // 将价格分组（使用中间价）
    priceData.forEach(item => {
      const price = Math.round(item.midPrice * 100) / 100; // 保留2位小数
      if (!profile[price]) {
        profile[price] = 0;
      }
      profile[price] += item.volume;
    });

    // 转换为数组并排序
    return Object.entries(profile)
      .map(([price, volume]) => ({ price: parseFloat(price), volume }))
      .sort((a, b) => a.price - b.price);
  }

  /**
   * 计算价值区（VAH/VAL）
   */
  calculateValueArea(volumeProfile, vpocEntry, targetVolume) {
    let accumulatedVolume = vpocEntry.volume;
    let lowIdx = volumeProfile.indexOf(vpocEntry);
    let highIdx = lowIdx;

    // 交替向上下扩展
    while (accumulatedVolume < targetVolume && (lowIdx > 0 || highIdx < volumeProfile.length - 1)) {
      const volumeBelow = lowIdx > 0 ? volumeProfile[lowIdx - 1].volume : 0;
      const volumeAbove = highIdx < volumeProfile.length - 1 ? volumeProfile[highIdx + 1].volume : 0;

      if (volumeBelow > volumeAbove && lowIdx > 0) {
        lowIdx--;
        accumulatedVolume += volumeBelow;
      } else if (highIdx < volumeProfile.length - 1) {
        highIdx++;
        accumulatedVolume += volumeAbove;
      } else if (lowIdx > 0) {
        lowIdx--;
        accumulatedVolume += volumeBelow;
      }
    }

    return {
      VAL: volumeProfile[lowIdx].price,
      VAH: volumeProfile[highIdx].price
    };
  }

  /**
   * 找到价格首次出现的索引
   */
  findFirstPriceIndex(prices, targetPrice) {
    for (let i = 0; i < prices.length; i++) {
      if (Math.abs(prices[i].midPrice - targetPrice) / targetPrice < 0.01) { // 1%容差
        return i;
      }
    }
    return -1;
  }

  /**
   * 计算标准差
   */
  calculateStd(values, mean) {
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
  }

  /**
   * 模块B：7%边沿"突然放大"检测系统
   * 返回 Score_B 和信号方向
   */
  async detectVolumeSpike(symbol, volumeProfile, currentKline, previousKlines) {
    try {
      if (!this.quietMode) {
        systemLogger.info(`[模块B] 开始检测 ${symbol} 的成交量爆发...`);
      }
      
      if (!volumeProfile || !currentKline || !previousKlines || previousKlines.length < 6) {
        systemLogger.error(`[模块B] ${symbol} 输入数据不足`);
        return { scoreB: 0, signal: null };
      }

      let scoreB = 0.0;
      let direction = null;

      const currentVolume = currentKline[5];
      const currentPrice = currentKline[4]; // close price
      
      // P1: 边沿位置检查（基于价值区范围）
      // 定义边沿范围：基于价值区宽度的百分比，而非绝对价格百分比
      const valueAreaRange = volumeProfile.VAH - volumeProfile.VAL;
      const edgeThreshold = valueAreaRange * 0.10; // 价值区宽度的10%作为边沿范围（放宽）
      
      // 检查是否在VAL下方边沿（做多机会）
      const distanceToVAL = currentPrice - volumeProfile.VAL;
      const isInLowerEdge = distanceToVAL >= -edgeThreshold && distanceToVAL <= edgeThreshold;
      
      // 检查是否在VAH上方边沿（做空机会）
      const distanceToVAH = currentPrice - volumeProfile.VAH;
      const isInUpperEdge = distanceToVAH >= -edgeThreshold && distanceToVAH <= edgeThreshold;

      if (!isInLowerEdge && !isInUpperEdge) {
        if (!this.quietMode) {
          systemLogger.info(`[模块B] ${symbol} 不在边沿区域 (价格=${currentPrice.toFixed(2)}, VAL=${volumeProfile.VAL.toFixed(2)}, VAH=${volumeProfile.VAH.toFixed(2)}, 边沿阈值=$${edgeThreshold.toFixed(2)})`);
        }
        return { scoreB: 0, direction: null };
      }

      scoreB += this.params.P1_WEIGHT;
      direction = isInLowerEdge ? 'long' : 'short';
      
      if (!this.quietMode) {
        systemLogger.info(`[模块B] ${symbol} P1通过: 位于${isInLowerEdge ? '下(VAL)' : '上(VAH)'}边沿，得分+${this.params.P1_WEIGHT}`);
        systemLogger.info(`[模块B] ${symbol}   当前价=${currentPrice.toFixed(2)}, 距离${isInLowerEdge ? 'VAL' : 'VAH'}=$${Math.abs(isInLowerEdge ? distanceToVAL : distanceToVAH).toFixed(2)} (阈值=$${edgeThreshold.toFixed(2)})`);
      }

      // P2: 局部Z值
      const zLocal = (currentVolume - volumeProfile.distMean) / volumeProfile.distStd;
      const p2Pass = zLocal > this.params.P2_LOCAL_Z_THRESHOLD;
      if (p2Pass) {
        scoreB += this.params.P2_WEIGHT;
      }
      if (!this.quietMode) {
        systemLogger.info(`[模块B] ${symbol} P2: 局部Z值=${zLocal.toFixed(2)} (阈值=${this.params.P2_LOCAL_Z_THRESHOLD}) ${p2Pass ? '✓ 通过' : '✗ 未通过'}`);
      }

      // P3: 全局Z值
      const zGlobal = (currentVolume - volumeProfile.meanVolume720) / volumeProfile.stdVolume720;
      const p3Pass = zGlobal > this.params.P3_GLOBAL_Z_THRESHOLD;
      if (p3Pass) {
        scoreB += this.params.P3_WEIGHT;
      }
      if (!this.quietMode) {
        systemLogger.info(`[模块B] ${symbol} P3: 全局Z值=${zGlobal.toFixed(2)} (阈值=${this.params.P3_GLOBAL_Z_THRESHOLD}) ${p3Pass ? '✓ 通过' : '✗ 未通过'}`);
      }

      // P4: 环比爆发
      const previousVolume = previousKlines[previousKlines.length - 1][5];
      const volumeRatio = currentVolume / previousVolume;
      const p4Pass = volumeRatio > this.params.P4_VOLUME_RATIO;
      if (p4Pass) {
        scoreB += this.params.P4_WEIGHT;
      }
      if (!this.quietMode) {
        systemLogger.info(`[模块B] ${symbol} P4: 环比=${volumeRatio.toFixed(2)} (阈值=${this.params.P4_VOLUME_RATIO}) ${p4Pass ? '✓ 通过' : '✗ 未通过'}`);
      }

      // P5: 5期均值
      const recent5Volumes = previousKlines.slice(-5).map(k => k[5]);
      const mean5 = recent5Volumes.reduce((a, b) => a + b, 0) / recent5Volumes.length;
      const ma5Ratio = currentVolume / mean5;
      const p5Pass = ma5Ratio > this.params.P5_MA5_RATIO;
      if (p5Pass) {
        scoreB += this.params.P5_WEIGHT;
      }
      if (!this.quietMode) {
        systemLogger.info(`[模块B] ${symbol} P5: 5期均值比=${ma5Ratio.toFixed(2)} (阈值=${this.params.P5_MA5_RATIO}) ${p5Pass ? '✓ 通过' : '✗ 未通过'}`);
      }

      // P6: 分布强度
      const distRatio = volumeProfile.distPeakVol / volumeProfile.meanVolume720;
      const p6Pass = distRatio > this.params.P6_DIST_STRENGTH;
      if (p6Pass) {
        scoreB += this.params.P6_WEIGHT;
      }
      if (!this.quietMode) {
        systemLogger.info(`[模块B] ${symbol} P6: 分布强度比=${distRatio.toFixed(2)} (阈值=${this.params.P6_DIST_STRENGTH}) ${p6Pass ? '✓ 通过' : '✗ 未通过'}`);
      }

      // P8: 时段权重
      const currentHour = new Date().getUTCHours();
      let timeWeight = 1.0;
      if (currentHour >= 0 && currentHour < 8) {
        timeWeight = 0.8; // 亚洲早盘
      } else if (currentHour >= 8 && currentHour < 16) {
        timeWeight = 1.2; // 亚洲/欧洲盘
      } else {
        timeWeight = 1.0; // 欧美盘
      }
      scoreB += this.params.P8_WEIGHT * timeWeight;

      if (!this.quietMode) {
        systemLogger.info(`[模块B] ${symbol} 最终得分: ${scoreB.toFixed(3)}, 方向: ${direction}`);
      }
      return { scoreB, direction };

    } catch (error) {
      systemLogger.error(`[模块B] 检测 ${symbol} 成交量爆发失败: ${error.message}`);
      return { scoreB: 0, signal: null };
    }
  }

  /**
   * 模块C：市场条件验证（离线/回测模式）
   * 只使用K线数据，不调用实时API
   * 返回 Score_C
   */
  async verifyMarketConditionsOffline(klines, direction) {
    try {
      if (!this.quietMode) {
        systemLogger.info(`[模块C] 离线模式验证市场条件 (方向: ${direction})...`);
      }
      
      let satisfiedConditions = 0;

      // C2: 成交量形态（使用提供的K线数据）
      try {
        const recentKlines = klines.slice(-20); // 最近20根K线
        if (recentKlines && recentKlines.length >= 20) {
          const volumes = recentKlines.map(k => k[5]);
          const closes = recentKlines.map(k => k[4]);
          
          // 找到最大成交量K线
          let maxVolIdx = 0;
          let maxVol = volumes[0];
          for (let i = 1; i < volumes.length - 1; i++) {
            if (volumes[i] > maxVol) {
              maxVol = volumes[i];
              maxVolIdx = i;
            }
          }

          // 检查成交量萎缩趋势
          const volumesAfterPeak = volumes.slice(maxVolIdx + 1);
          const currentVol = volumes[volumes.length - 1];
          const isVolumeDecreasing = currentVol < maxVol * 0.7;

          // 检查价格方向
          const priceAtPeak = closes[maxVolIdx];
          const currentPrice = closes[closes.length - 1];
          
          if (direction === 'long' && priceAtPeak > currentPrice && isVolumeDecreasing) {
            satisfiedConditions++;
            if (!this.quietMode) {
              systemLogger.info(`[模块C] 离线 C2通过: 下跌后成交量萎缩 (多头)`);
            }
          } else if (direction === 'short' && priceAtPeak < currentPrice && isVolumeDecreasing) {
            satisfiedConditions++;
            if (!this.quietMode) {
              systemLogger.info(`[模块C] 离线 C2通过: 上涨后成交量萎缩 (空头)`);
            }
          }
        }
      } catch (error) {
        if (!this.quietMode) {
          systemLogger.warn(`[模块C] 离线成交量形态分析失败: ${error.message}`);
        }
      }

      // 计算得分（离线模式只有1个条件，标准化到0-1）
      // 为了保持与实盘模式的可比性，给予基础分数
      const baseScore = 0.5; // 基础分50%（假设市场条件中性）
      const scoreC = Math.min(1.0, baseScore + (satisfiedConditions * 0.25));
      
      if (!this.quietMode) {
        systemLogger.info(`[模块C] 离线最终得分: ${scoreC.toFixed(3)} (基础分=${baseScore}, 满足=${satisfiedConditions}/1条件)`);
      }
      
      return scoreC;

    } catch (error) {
      systemLogger.error(`[模块C] 离线验证市场条件失败: ${error.message}`);
      return 0.5; // 返回中性分数
    }
  }

  /**
   * 模块C：订单簿 + Delta + 资金费率验证系统
   * 返回 Score_C
   */
  async verifyMarketConditions(symbol, direction) {
    try {
      systemLogger.info(`[模块C] 开始验证 ${symbol} 的市场条件 (方向: ${direction})...`);
      
      let satisfiedConditions = 0;

      // C1: 订单簿多空比
      try {
        const orderBook = await exchangeUtils.fetchOrderBook(symbol, 20);
        if (orderBook && orderBook.bids && orderBook.asks) {
          const totalBids = orderBook.bids.reduce((sum, bid) => sum + bid[1], 0);
          const totalAsks = orderBook.asks.reduce((sum, ask) => sum + ask[1], 0);
          const ratio = totalBids / totalAsks;

          if (direction === 'long' && ratio >= this.moduleC.ORDERBOOK_RATIO_LONG) {
            satisfiedConditions++;
            systemLogger.info(`[模块C] ${symbol} C1通过: 订单簿比率=${ratio.toFixed(2)} (多头)`);
          } else if (direction === 'short' && ratio <= this.moduleC.ORDERBOOK_RATIO_SHORT) {
            satisfiedConditions++;
            systemLogger.info(`[模块C] ${symbol} C1通过: 订单簿比率=${ratio.toFixed(2)} (空头)`);
          }
        }
      } catch (error) {
        systemLogger.warn(`[模块C] ${symbol} 获取订单簿失败: ${error.message}`);
      }

      // C2: 成交量形态（简化版：检查近期成交量趋势）
      try {
        const recentKlines = await exchangeUtils.fetchOHLCV(symbol, '3m', 20);
        if (recentKlines && recentKlines.length >= 20) {
          const volumes = recentKlines.map(k => k[5]);
          const closes = recentKlines.map(k => k[4]);
          
          // 找到最大成交量K线
          let maxVolIdx = 0;
          let maxVol = volumes[0];
          for (let i = 1; i < volumes.length - 1; i++) {
            if (volumes[i] > maxVol) {
              maxVol = volumes[i];
              maxVolIdx = i;
            }
          }

          // 检查成交量萎缩趋势
          const volumesAfterPeak = volumes.slice(maxVolIdx + 1);
          const currentVol = volumes[volumes.length - 1];
          const isVolumeDecreasing = currentVol < maxVol * 0.7;

          // 检查价格方向
          const priceAtPeak = closes[maxVolIdx];
          const currentPrice = closes[closes.length - 1];
          
          if (direction === 'long' && priceAtPeak > currentPrice && isVolumeDecreasing) {
            satisfiedConditions++;
            systemLogger.info(`[模块C] ${symbol} C2通过: 下跌后成交量萎缩 (多头)`);
          } else if (direction === 'short' && priceAtPeak < currentPrice && isVolumeDecreasing) {
            satisfiedConditions++;
            systemLogger.info(`[模块C] ${symbol} C2通过: 上涨后成交量萎缩 (空头)`);
          }
        }
      } catch (error) {
        systemLogger.warn(`[模块C] ${symbol} 成交量形态分析失败: ${error.message}`);
      }

      // C3: Delta值（如果可用）
      // 注意：这需要实时成交流数据，目前简化为跳过
      systemLogger.info(`[模块C] ${symbol} C3跳过: Delta数据需要WebSocket实时流`);

      // C4: 资金费率
      try {
        const fundingRate = await exchangeUtils.getFundingRate(symbol);
        if (fundingRate !== null) {
          if (direction === 'long' && fundingRate <= this.moduleC.FUNDING_RATE_LONG) {
            satisfiedConditions++;
            systemLogger.info(`[模块C] ${symbol} C4通过: 资金费率=${fundingRate.toFixed(6)} (多头)`);
          } else if (direction === 'short' && fundingRate >= this.moduleC.FUNDING_RATE_SHORT) {
            satisfiedConditions++;
            systemLogger.info(`[模块C] ${symbol} C4通过: 资金费率=${fundingRate.toFixed(6)} (空头)`);
          }
        }
      } catch (error) {
        systemLogger.warn(`[模块C] ${symbol} 获取资金费率失败: ${error.message}`);
      }

      // 计算得分（满分4分，但由于跳过了C3，实际满分为3分，需要标准化）
      const scoreC = satisfiedConditions / 3.0; // 标准化到0-1
      systemLogger.info(`[模块C] ${symbol} 最终得分: ${scoreC.toFixed(3)} (${satisfiedConditions}/3条件)`);
      
      return scoreC;

    } catch (error) {
      systemLogger.error(`[模块C] 验证 ${symbol} 市场条件失败: ${error.message}`);
      return 0;
    }
  }

  /**
   * 模块D：信号融合决策引擎
   * 返回最终交易指令
   */
  makeFinalDecision(symbol, scoreB, scoreC, direction, currentPrice) {
    try {
      systemLogger.info(`[模块D] 开始融合决策 ${symbol}...`);
      systemLogger.info(`[模块D] 输入: ScoreB=${scoreB.toFixed(3)}, ScoreC=${scoreC.toFixed(3)}, 方向=${direction}`);

      // 初步决策
      let preliminaryDecision = 'VETO';
      if (scoreB >= this.moduleD.SCORE_B_STRONG && scoreC >= this.moduleD.SCORE_C_STRONG) {
        preliminaryDecision = 'STRONG';
      } else if (scoreB >= this.moduleD.SCORE_B_STRONG && scoreC >= this.moduleD.SCORE_C_LIGHT) {
        preliminaryDecision = 'LIGHT';
      }

      // 计算最终加权分
      const finalScore = this.moduleD.WEIGHT_B * scoreB + this.moduleD.WEIGHT_C * scoreC;
      systemLogger.info(`[模块D] 加权分: ${finalScore.toFixed(3)} (阈值: ${this.moduleD.FINAL_SCORE_THRESHOLD})`);

      // 最终决策
      if (preliminaryDecision !== 'VETO' && finalScore >= this.moduleD.FINAL_SCORE_THRESHOLD) {
        const signal = direction === 'long' ? 'BUY' : 'SELL';
        const suggestion = `${preliminaryDecision}_${direction.toUpperCase()}`;
        
        // 计算止损止盈（基于当前价格的固定百分比）
        // 优化：放宽空间，提高震荡市胜率
        const stopLossPercent = 0.010; // 1.0%（原0.6%）
        const takeProfitPercent = 0.020; // 2.0%（原1.2%）
        
        let stopLoss, takeProfit;
        if (direction === 'long') {
          stopLoss = currentPrice * (1 - stopLossPercent);
          takeProfit = currentPrice * (1 + takeProfitPercent);
        } else {
          stopLoss = currentPrice * (1 + stopLossPercent);
          takeProfit = currentPrice * (1 - takeProfitPercent);
        }

        const decision = {
          signal,
          suggestion,
          finalScore,
          scoreB,
          scoreC,
          direction,
          stopLoss,
          takeProfit,
          confidence: preliminaryDecision === 'STRONG' ? 'HIGH' : 'MEDIUM',
          reason: `Volume spike at ${direction === 'long' ? 'VAL' : 'VAH'} boundary with ScoreB=${scoreB.toFixed(2)}, ScoreC=${scoreC.toFixed(2)}`
        };

        systemLogger.info(`[模块D] ✅ 决策: ${suggestion}, 信号=${signal}, 置信度=${decision.confidence}`);
        return decision;
      } else {
        systemLogger.info(`[模块D] ❌ 否决交易: 初步决策=${preliminaryDecision}, 最终分=${finalScore.toFixed(3)}`);
        return {
          signal: 'HOLD',
          suggestion: 'VETO_TRADE',
          finalScore,
          scoreB,
          scoreC,
          reason: `Insufficient score or preliminary veto (ScoreB=${scoreB.toFixed(2)}, ScoreC=${scoreC.toFixed(2)})`
        };
      }

    } catch (error) {
      systemLogger.error(`[模块D] ${symbol} 决策失败: ${error.message}`);
      return {
        signal: 'HOLD',
        suggestion: 'ERROR',
        reason: `Decision error: ${error.message}`
      };
    }
  }

  /**
   * 完整策略分析流程
   * @param {string} symbol - 交易对
   * @param {number} currentPrice - 当前价格
   * @param {Array} historicalKlines - 历史K线数据（回测模式）
   * @param {boolean} offlineMode - 是否为离线模式（回测）
   */
  async analyze(symbol, currentPrice, historicalKlines = null, offlineMode = false) {
    try {
      // 回测模式启用静默模式
      const wasQuiet = this.quietMode;
      if (offlineMode) {
        this.quietMode = true;
      }
      
      if (!this.quietMode) {
        systemLogger.info(`\n========== 开始成交量策略分析: ${symbol} ==========`);
      }
      
      let klines;
      
      // 回测模式：使用提供的历史K线
      if (offlineMode && historicalKlines) {
        klines = historicalKlines;
      } else {
        // 实盘模式：从API获取K线
        klines = await exchangeUtils.fetchOHLCV(symbol, '3m', this.klineLimit + 1);
      }

      if (!klines || klines.length < this.klineLimit) {
        this.quietMode = wasQuiet; // 恢复静默模式状态
        return {
          signal: 'HOLD',
          reason: `Insufficient kline data: ${klines ? klines.length : 0}/${this.klineLimit}`,
          confidence: 'LOW'
        };
      }

      // 模块A: 计算成交量分布（使用提供的K线数据）
      const volumeProfile = await this.calculateVolumeProfileFromKlines(klines.slice(0, this.klineLimit), symbol);
      if (!volumeProfile) {
        this.quietMode = wasQuiet; // 恢复状态
        return {
          signal: 'HOLD',
          reason: 'Volume profile calculation failed',
          confidence: 'LOW'
        };
      }

      const currentKline = klines[klines.length - 1];
      const previousKlines = klines.slice(0, -1);

      // 模块B: 检测成交量爆发
      const { scoreB, direction } = await this.detectVolumeSpike(
        symbol,
        volumeProfile,
        currentKline,
        previousKlines
      );

      // 检查最低分数要求（使用MIN_SCORE_B或P1_WEIGHT）
      const minScoreRequired = this.params.MIN_SCORE_B || this.params.P1_WEIGHT;
      
      if (!direction || scoreB < minScoreRequired) {
        this.quietMode = wasQuiet; // 恢复状态
        return {
          signal: 'HOLD',
          reason: `Insufficient score: ${scoreB.toFixed(3)} < ${minScoreRequired} (need edge + volume conditions)`,
          confidence: 'LOW',
          scoreB,
          scoreC: 0,
          finalScore: 0
        };
      }

      // 模块C: 验证市场条件（离线模式下降级）
      const scoreC = offlineMode 
        ? await this.verifyMarketConditionsOffline(klines, direction)
        : await this.verifyMarketConditions(symbol, direction);

      // 模块D: 融合决策
      const decision = this.makeFinalDecision(symbol, scoreB, scoreC, direction, currentPrice);

      // 恢复静默模式状态
      this.quietMode = wasQuiet;
      
      if (!this.quietMode) {
        systemLogger.info(`========== 策略分析完成: ${symbol} ==========\n`);
      }
      return decision;

    } catch (error) {
      // 恢复静默模式状态
      this.quietMode = wasQuiet;
      systemLogger.error(`策略分析失败 ${symbol}: ${error.message}`);
      return {
        signal: 'HOLD',
        reason: `Analysis error: ${error.message}`,
        confidence: 'LOW'
      };
    }
  }
}

module.exports = new VolumeProfileStrategy();

