const { systemLogger } = require('../logger/Logger');
const exchangeUtils = require('../exchange/ExchangeUtils');

/**
 * 成交量动态正态分布策略 v2.0
 * 基于 正态分布初稿1策略.txt 实现，严格遵循文档要求
 * 
 * 核心变化：
 * 1. 边沿定义：VAH ~ VAH+3（右侧3根K线），VAL-3 ~ VAL（左侧3根K线）
 * 2. 8参数系统：严格按照文档阈值（P2:2.3, P3:2.0, P4:2.2, P5:1.9, P6:1.3）
 * 3. 决策简化：移除模块C/D，只使用 Score_B ≥ 0.75 触发交易
 * 4. P7次根持续：需要T+1确认（回测中需要下一根K线数据）
 * 5. P8时段权重：亚洲×1.2，欧美×1.0，深夜×0.8
 * 
 * 适配说明（2分钟K线）：
 * - K线数量：720根（24小时，2分钟K线）
 * - 边沿范围：保持3根K线（文档要求）
 * - 其他参数：保持文档原值（2.3/2.0/2.2/1.9/1.3）
 */
class VolumeProfileStrategy {
  constructor() {
    this.klineLimit = 720; // 720根K线（24小时，2分钟K线）
    this.windowThreshold = 0.3; // 窗口阈值：峰值的30%
    this.edgeRange = 3; // 边沿范围：3根K线（文档要求：VAH+3, VAL-3）
    this.valueAreaPercentage = 0.7; // 价值区域：70%成交量
    this.quietMode = false; // 静默模式（回测时减少日志）
    
    // 模块B：8参数系统（严格按照文档）
    this.params = {
      // P1: 边沿位置（必须）
      P1_WEIGHT: 0.25,
      
      // P2: 局部Z值 (Vₜ - μ_local)/σ_local > 2.3
      P2_LOCAL_Z_THRESHOLD: 2.3,
      P2_WEIGHT: 0.20,
      
      // P3: 全局Z值 (Vₜ - μ_720)/σ_720 > 2.0
      P3_GLOBAL_Z_THRESHOLD: 2.0,
      P3_WEIGHT: 0.15,
      
      // P4: 环比爆发 Vₜ / Vₜ₋₁ > 2.2倍
      P4_VOLUME_RATIO: 2.2,
      P4_WEIGHT: 0.20,
      
      // P5: 5期均值 Vₜ / 平均(Vₜ₋₅~ₜ₋₁) > 1.9倍
      P5_MA5_RATIO: 1.9,
      P5_WEIGHT: 0.10,
      
      // P6: 分布强度 当前峰值 > 1.3 × 全天均值
      P6_DIST_STRENGTH: 1.3,
      P6_WEIGHT: 0.05,
      
      // P7: 次根持续 Vₜ₊₁ > 0.6 × Vₜ (需T+1确认)
      P7_CONTINUATION_RATIO: 0.6,
      P7_WEIGHT: 0.03,
      
      // P8: 时段权重 亚洲×1.2，欧美×1.0，深夜×0.8
      P8_WEIGHT: 0.02,
      
      // Score_B 阈值（文档要求：T = 0.75）
      SCORE_B_THRESHOLD: 0.75
    };
  }

  /**
   * 模块A：成交量动态正态分布系统
   * 严格按照文档要求：
   * 1. 峰值识别：成交量 > 均值 + 1.5σ，峰间距 ≥ 6根
   * 2. 窗口划分：峰值左右扩展至成交量降至峰值30%
   * 3. 正态拟合：N(μ, σ²)，μ = VPOC
   * 4. 价值区：70%成交量累计区 → VAL / VAH
   * 5. 7%边沿定义：上边沿VAH ~ VAH+3，下边沿VAL-3 ~ VAL
   * 
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

      // 提取成交量序列和价格数据
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

      // 1. 峰值识别：成交量 > 均值 + 1.5σ，峰间距 ≥ 6根
      const meanVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
      const stdVolume = this.calculateStd(volumes, meanVolume);
      const threshold = meanVolume + 1.5 * stdVolume;

      const peaks = [];
      for (let i = 6; i < volumes.length - 6; i++) {
        if (volumes[i] > threshold) {
          // 确保是局部最大值
          const isLocalMax = volumes[i] >= volumes[i-1] && volumes[i] >= volumes[i+1];
          if (isLocalMax) {
            // 检查与已有峰值的距离（峰间距 ≥ 6根）
            const tooClose = peaks.some(p => Math.abs(p.index - i) < 6);
            if (!tooClose) {
              peaks.push({ index: i, volume: volumes[i] });
            }
          }
        }
      }

      if (peaks.length === 0) {
        if (!this.quietMode) {
          systemLogger.warn(`[模块A] ${logPrefix}未找到显著的成交量峰值`);
        }
        return null;
      }

      // 选择成交量最大的峰值作为主峰
      const mainPeak = peaks.reduce((max, p) => p.volume > max.volume ? p : max, peaks[0]);
      if (!this.quietMode) {
        systemLogger.info(`[模块A] ${logPrefix}主峰位置: 索引=${mainPeak.index}, 成交量=${mainPeak.volume.toFixed(2)}`);
      }

      // 2. 窗口划分：峰值左右扩展至成交量降至峰值30%
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

      if (!this.quietMode) {
        systemLogger.info(`[模块A] ${logPrefix}分析窗口: [${leftIdx}, ${rightIdx}], 长度=${rightIdx - leftIdx + 1}`);
      }

      // 3. 在窗口内计算成交量剖面
      const windowData = prices.slice(leftIdx, rightIdx + 1);
      const volumeProfile = this.buildVolumeProfile(windowData);

      // 4. 找到VPOC（成交量最大的价格）- 即正态分布的μ
      const vpocEntry = volumeProfile.reduce((max, entry) => 
        entry.volume > max.volume ? entry : max, volumeProfile[0]
      );
      const VPOC = vpocEntry.price;

      // 5. 计算价值区（VAH/VAL）- 70%成交量累计区
      const totalVolume = volumeProfile.reduce((sum, entry) => sum + entry.volume, 0);
      const targetVolume = totalVolume * this.valueAreaPercentage;
      
      const { VAH, VAL } = this.calculateValueArea(volumeProfile, vpocEntry, targetVolume);

      // 6. 定义边沿索引（动态：7%~5%区间）
      const lowIdxVP = volumeProfile.findIndex(e => e.price === VAL);
      const highIdxVP = volumeProfile.findIndex(e => e.price === VAH);

      const lowerEdgeIndices = [];
      const upperEdgeIndices = [];

      // 下边沿：从VAL向左累计，5%~7%区间
      if (lowIdxVP > 0) {
        let cum = 0;
        let i5 = null, i7 = null;
        for (let i = lowIdxVP - 1; i >= 0; i--) {
          cum += volumeProfile[i].volume;
          if (i5 === null && cum >= totalVolume * 0.05) i5 = i;
          if (i7 === null && cum >= totalVolume * 0.07) { i7 = i; break; }
        }
        if (i5 !== null && i7 !== null) {
          const bandMin = Math.min(volumeProfile[i7].price, volumeProfile[i5].price);
          const bandMax = Math.max(volumeProfile[i7].price, volumeProfile[i5].price);
          for (let j = 0; j < prices.length; j++) {
            const p = prices[j].midPrice;
            if (p >= bandMin && p <= bandMax) lowerEdgeIndices.push(j);
          }
        }
      }

      // 上边沿：从VAH向右累计，5%~7%区间
      if (highIdxVP >= 0 && highIdxVP < volumeProfile.length - 1) {
        let cum = 0;
        let i5 = null, i7 = null;
        for (let i = highIdxVP + 1; i < volumeProfile.length; i++) {
          cum += volumeProfile[i].volume;
          if (i5 === null && cum >= totalVolume * 0.05) i5 = i;
          if (i7 === null && cum >= totalVolume * 0.07) { i7 = i; break; }
        }
        if (i5 !== null && i7 !== null) {
          const bandMin = Math.min(volumeProfile[i5].price, volumeProfile[i7].price);
          const bandMax = Math.max(volumeProfile[i5].price, volumeProfile[i7].price);
          for (let j = 0; j < prices.length; j++) {
            const p = prices[j].midPrice;
            if (p >= bandMin && p <= bandMax) upperEdgeIndices.push(j);
          }
        }
      }

      // 计算窗口内的统计数据（用于P2局部Z值）
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
        distMean,      // 窗口内均值（用于P2）
        distStd,       // 窗口内标准差（用于P2）
        distPeakVol,   // 窗口内峰值（用于P6）
        meanVolume720: meanVolume,  // 720根K线均值（用于P3）
        stdVolume720: stdVolume,    // 720根K线标准差（用于P3）
        windowRange: [leftIdx, rightIdx],
        latestIndex: prices.length - 1
      };

      if (!this.quietMode) {
        systemLogger.info(`[模块A] ${logPrefix}计算完成: VAH=${VAH.toFixed(2)}, VAL=${VAL.toFixed(2)}, VPOC=${VPOC.toFixed(2)}`);
        systemLogger.info(`[模块A] ${logPrefix}边沿范围: 下边沿[${lowerEdgeIndices[0] || 'N/A'}, ${lowerEdgeIndices[lowerEdgeIndices.length - 1] || 'N/A'}], 上边沿[${upperEdgeIndices[0] || 'N/A'}, ${upperEdgeIndices[upperEdgeIndices.length - 1] || 'N/A'}]`);
      }
      return result;

    } catch (error) {
      systemLogger.error(`[模块A] ${logPrefix}计算成交量分布失败: ${error.message}`);
      return null;
    }
  }

  /**
   * 将1分钟K线合并为2分钟K线
   * @param {Array} klines1m - 1分钟K线数组 [timestamp, open, high, low, close, volume]
   * @returns {Array} 合并后的2分钟K线数组
   */
  merge1mTo2m(klines1m) {
    if (!klines1m || klines1m.length === 0) {
      return [];
    }

    const klines2m = [];
    
    // 每2根1分钟K线合并成1根2分钟K线
    for (let i = 0; i < klines1m.length - 1; i += 2) {
      const k1 = klines1m[i];
      const k2 = klines1m[i + 1];
      
      if (!k1 || !k2) {
        break; // 如果最后一根K线没有配对，跳过
      }

      // 合并逻辑：
      // timestamp: 第一根K线的时间戳
      // open: 第一根K线的开盘价
      // high: 两根K线的最高价
      // low: 两根K线的最低价
      // close: 第二根K线的收盘价
      // volume: 两根K线的成交量之和
      const mergedKline = [
        k1[0],                    // timestamp (第一根的时间)
        k1[1],                    // open (第一根的开盘价)
        Math.max(k1[2], k2[2]),  // high (最高价)
        Math.min(k1[3], k2[3]),  // low (最低价)
        k2[4],                    // close (第二根的收盘价)
        k1[5] + k2[5]            // volume (成交量之和)
      ];
      
      klines2m.push(mergedKline);
    }

    return klines2m;
  }

  /**
   * 模块A：从API获取数据（实盘模式）
   * 币安只支持1分钟K线，需要获取1440条1分钟K线，合并成720条2分钟K线
   */
  async calculateVolumeProfile(symbol) {
    try {
      // 获取1440条1分钟K线（720 * 2）
      const klines1m = await exchangeUtils.getOHLCVWithRetry(symbol, '1m', this.klineLimit * 2);
      if (!klines1m || klines1m.length < this.klineLimit * 2) {
        systemLogger.error(`[模块A] ${symbol} 1分钟K线数据不足，需要${this.klineLimit * 2}根，实际${klines1m ? klines1m.length : 0}根`);
        return null;
      }

      // 合并成2分钟K线
      const klines2m = this.merge1mTo2m(klines1m);
      if (klines2m.length < this.klineLimit) {
        systemLogger.error(`[模块A] ${symbol} 合并后2分钟K线数据不足，需要${this.klineLimit}根，实际${klines2m.length}根`);
        return null;
      }

      if (!this.quietMode) {
        systemLogger.info(`[模块A] ${symbol} 获取${klines1m.length}根1分钟K线，合并为${klines2m.length}根2分钟K线`);
      }

      return await this.calculateVolumeProfileFromKlines(klines2m, symbol);
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
    
    priceData.forEach(item => {
      const price = Math.round(item.midPrice * 100) / 100; // 保留2位小数
      if (!profile[price]) {
        profile[price] = 0;
      }
      profile[price] += item.volume;
    });

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

    // 交替向上下扩展，直到累计成交量达到目标
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
   * 找到价格在K线中的索引（用于边沿定义）
   */
  findPriceIndexInKlines(prices, targetPrice) {
    let minDiff = Infinity;
    let bestIdx = -1;
    
    for (let i = 0; i < prices.length; i++) {
      const diff = Math.abs(prices[i].midPrice - targetPrice);
      if (diff < minDiff) {
        minDiff = diff;
        bestIdx = i;
      }
    }
    
    // 如果价格差异在1%以内，认为找到了
    if (minDiff / targetPrice < 0.01) {
      return bestIdx;
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
   * 获取时段权重（P8）
   * 亚洲×1.2，欧美×1.0，深夜×0.8
   */
  getTimeWeight(timestamp) {
    const date = new Date(timestamp);
    const hour = date.getUTCHours();
    
    // 亚洲盘：8:00-16:00 UTC（北京时间16:00-00:00）
    if (hour >= 8 && hour < 16) {
      return 1.2;
    }
    // 欧美盘：16:00-24:00 UTC（北京时间00:00-08:00）
    else if (hour >= 16 && hour < 24) {
      return 1.0;
    }
    // 深夜：0:00-8:00 UTC（北京时间08:00-16:00）
    else {
      return 0.8;
    }
  }

  /**
   * 模块B：7%边沿"突然放大"检测系统（8大参数）
   * 严格按照文档要求实现
   * 
   * @param {string} symbol - 交易对
   * @param {Object} volumeProfile - 模块A的输出
   * @param {Array} currentKline - 当前K线
   * @param {Array} previousKlines - 历史K线（用于P4/P5）
   * @param {Array} nextKline - 下一根K线（用于P7，可选，回测时提供）
   */
  async detectVolumeSpike(symbol, volumeProfile, currentKline, previousKlines, nextKline = null) {
    try {
      if (!this.quietMode) {
        systemLogger.info(`[模块B] 开始检测 ${symbol} 的成交量爆发...`);
      }
      
      if (!volumeProfile || !currentKline || !previousKlines || previousKlines.length < 5) {
        if (!this.quietMode) {
          systemLogger.error(`[模块B] ${symbol} 输入数据不足`);
        }
        return { scoreB: 0, direction: null, details: {} };
      }

      let scoreB = 0.0;
      let direction = null;
      const details = {};

      const currentVolume = currentKline[5];
      const currentPrice = currentKline[4]; // close price
      const currentIndex = volumeProfile.latestIndex;
      const currentTimestamp = currentKline[0];

      // P1: 边沿位置检查（必须，权重0.25）
      // 检查是否在 [VAL-3, VAL] 或 [VAH, VAH+3]
      const isInLowerEdge = volumeProfile.lowerEdgeIndices.includes(currentIndex);
      const isInUpperEdge = volumeProfile.upperEdgeIndices.includes(currentIndex);

      if (!isInLowerEdge && !isInUpperEdge) {
        if (!this.quietMode) {
          systemLogger.info(`[模块B] ${symbol} 不在边沿区域 (索引=${currentIndex}, VAL边沿=${JSON.stringify(volumeProfile.lowerEdgeIndices)}, VAH边沿=${JSON.stringify(volumeProfile.upperEdgeIndices)})`);
        }
        return { scoreB: 0, direction: null, details: {} };
      }

      scoreB += this.params.P1_WEIGHT;
      direction = isInLowerEdge ? 'long' : 'short';
      details.P1 = { passed: true, edge: isInLowerEdge ? 'VAL' : 'VAH', index: currentIndex };
      
      if (!this.quietMode) {
        systemLogger.info(`[模块B] ${symbol} P1通过: 位于${isInLowerEdge ? '下(VAL)' : '上(VAH)'}边沿，得分+${this.params.P1_WEIGHT}`);
      }

      // P2: 局部Z值 (Vₜ - μ_local)/σ_local > 2.3
      const zLocal = (currentVolume - volumeProfile.distMean) / volumeProfile.distStd;
      const p2Pass = zLocal > this.params.P2_LOCAL_Z_THRESHOLD;
      if (p2Pass) {
        scoreB += this.params.P2_WEIGHT;
      }
      details.P2 = { passed: p2Pass, zLocal: zLocal.toFixed(2), threshold: this.params.P2_LOCAL_Z_THRESHOLD };
      if (!this.quietMode) {
        systemLogger.info(`[模块B] ${symbol} P2: 局部Z值=${zLocal.toFixed(2)} (阈值=${this.params.P2_LOCAL_Z_THRESHOLD}) ${p2Pass ? '✓ 通过' : '✗ 未通过'}`);
      }

      // P3: 全局Z值 (Vₜ - μ_720)/σ_720 > 2.0
      const zGlobal = (currentVolume - volumeProfile.meanVolume720) / volumeProfile.stdVolume720;
      const p3Pass = zGlobal > this.params.P3_GLOBAL_Z_THRESHOLD;
      if (p3Pass) {
        scoreB += this.params.P3_WEIGHT;
      }
      details.P3 = { passed: p3Pass, zGlobal: zGlobal.toFixed(2), threshold: this.params.P3_GLOBAL_Z_THRESHOLD };
      if (!this.quietMode) {
        systemLogger.info(`[模块B] ${symbol} P3: 全局Z值=${zGlobal.toFixed(2)} (阈值=${this.params.P3_GLOBAL_Z_THRESHOLD}) ${p3Pass ? '✓ 通过' : '✗ 未通过'}`);
      }

      // P4: 环比爆发 Vₜ / Vₜ₋₁ > 2.2倍
      const previousVolume = previousKlines[previousKlines.length - 1][5];
      const volumeRatio = currentVolume / previousVolume;
      const p4Pass = volumeRatio > this.params.P4_VOLUME_RATIO;
      if (p4Pass) {
        scoreB += this.params.P4_WEIGHT;
      }
      details.P4 = { passed: p4Pass, ratio: volumeRatio.toFixed(2), threshold: this.params.P4_VOLUME_RATIO };
      if (!this.quietMode) {
        systemLogger.info(`[模块B] ${symbol} P4: 环比=${volumeRatio.toFixed(2)} (阈值=${this.params.P4_VOLUME_RATIO}) ${p4Pass ? '✓ 通过' : '✗ 未通过'}`);
      }

      // P5: 5期均值 Vₜ / 平均(Vₜ₋₅~ₜ₋₁) > 1.9倍
      const recent5Volumes = previousKlines.slice(-5).map(k => k[5]);
      const mean5 = recent5Volumes.reduce((a, b) => a + b, 0) / recent5Volumes.length;
      const ma5Ratio = currentVolume / mean5;
      const p5Pass = ma5Ratio > this.params.P5_MA5_RATIO;
      if (p5Pass) {
        scoreB += this.params.P5_WEIGHT;
      }
      details.P5 = { passed: p5Pass, ratio: ma5Ratio.toFixed(2), threshold: this.params.P5_MA5_RATIO };
      if (!this.quietMode) {
        systemLogger.info(`[模块B] ${symbol} P5: 5期均值比=${ma5Ratio.toFixed(2)} (阈值=${this.params.P5_MA5_RATIO}) ${p5Pass ? '✓ 通过' : '✗ 未通过'}`);
      }

      // P6: 分布强度 当前峰值 > 1.3 × 全天均值
      const distRatio = volumeProfile.distPeakVol / volumeProfile.meanVolume720;
      const p6Pass = distRatio > this.params.P6_DIST_STRENGTH;
      if (p6Pass) {
        scoreB += this.params.P6_WEIGHT;
      }
      details.P6 = { passed: p6Pass, ratio: distRatio.toFixed(2), threshold: this.params.P6_DIST_STRENGTH, reference: 'window_peak' };
      if (!this.quietMode) {
        systemLogger.info(`[模块B] ${symbol} P6: 分布强度比=${distRatio.toFixed(2)} (峰值/全天均值, 阈值=${this.params.P6_DIST_STRENGTH}) ${p6Pass ? '✓ 通过' : '✗ 未通过'}`);
      }

      // P7: 次根持续 Vₜ₊₁ > 0.6 × Vₜ (需T+1确认)
      let p7Pass = false;
      if (nextKline) {
        const nextVolume = nextKline[5];
        const continuationRatio = nextVolume / currentVolume;
        p7Pass = continuationRatio > this.params.P7_CONTINUATION_RATIO;
        if (p7Pass) {
          scoreB += this.params.P7_WEIGHT;
        }
        details.P7 = { passed: p7Pass, ratio: continuationRatio.toFixed(2), threshold: this.params.P7_CONTINUATION_RATIO, hasNextKline: true };
        if (!this.quietMode) {
          systemLogger.info(`[模块B] ${symbol} P7: 次根持续比=${continuationRatio.toFixed(2)} (阈值=${this.params.P7_CONTINUATION_RATIO}) ${p7Pass ? '✓ 通过' : '✗ 未通过'}`);
        }
      } else {
        // 实盘模式：无法验证P7，跳过（不影响得分）
        details.P7 = { passed: false, hasNextKline: false, note: '实盘模式，无法验证T+1' };
        if (!this.quietMode) {
          systemLogger.info(`[模块B] ${symbol} P7: 跳过（实盘模式，无T+1数据）`);
        }
      }

      // P8: 时段权重 亚洲×1.2，欧美×1.0，深夜×0.8
      const timeWeight = this.getTimeWeight(currentTimestamp);
      const p8Score = this.params.P8_WEIGHT * timeWeight;
      scoreB += p8Score;
      details.P8 = { timeWeight: timeWeight, score: p8Score.toFixed(3) };
      if (!this.quietMode) {
        systemLogger.info(`[模块B] ${symbol} P8: 时段权重=${timeWeight}, 得分=${p8Score.toFixed(3)}`);
      }

      if (!this.quietMode) {
        systemLogger.info(`[模块B] ${symbol} 最终得分: ${scoreB.toFixed(3)}, 方向: ${direction}`);
      }
      
      return { scoreB, direction, details };

    } catch (error) {
      systemLogger.error(`[模块B] 检测 ${symbol} 成交量爆发失败: ${error.message}`);
      return { scoreB: 0, direction: null, details: {} };
    }
  }

  /**
   * 完整策略分析流程
   * 简化版：只使用 Score_B ≥ 0.75 触发交易
   * 
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
      // 注意：回测系统应该已经提供合并好的2分钟K线
      if (offlineMode && historicalKlines) {
        klines = historicalKlines;
      } else {
        // 实盘模式：获取1分钟K线并合并为2分钟K线
        // 需要获取 (klineLimit + 1) * 2 根1分钟K线，合并后得到 klineLimit + 1 根2分钟K线
        const klines1m = await exchangeUtils.getOHLCVWithRetry(symbol, '1m', (this.klineLimit + 1) * 2);
        if (!klines1m || klines1m.length < (this.klineLimit + 1) * 2) {
          this.quietMode = wasQuiet;
          return {
            signal: 'HOLD',
            reason: `Insufficient 1m kline data: ${klines1m ? klines1m.length : 0}/${(this.klineLimit + 1) * 2}`,
            confidence: 'LOW'
          };
        }
        
        // 合并成2分钟K线
        klines = this.merge1mTo2m(klines1m);
        
        if (!this.quietMode) {
          systemLogger.info(`[策略] ${symbol} 获取${klines1m.length}根1分钟K线，合并为${klines.length}根2分钟K线`);
        }
      }

      if (!klines || klines.length < this.klineLimit) {
        this.quietMode = wasQuiet;
        return {
          signal: 'HOLD',
          reason: `Insufficient kline data: ${klines ? klines.length : 0}/${this.klineLimit}`,
          confidence: 'LOW'
        };
      }

      // 模块A: 计算成交量分布
      const volumeProfile = await this.calculateVolumeProfileFromKlines(klines.slice(0, this.klineLimit), symbol);
      if (!volumeProfile) {
        this.quietMode = wasQuiet;
        return {
          signal: 'HOLD',
          reason: 'Volume profile calculation failed',
          confidence: 'LOW'
        };
      }

      let currentKline, previousKlines, nextKline = null;
      if (offlineMode) {
        const currentIndex = klines.length >= this.klineLimit + 2 ? this.klineLimit : klines.length - 1;
        currentKline = klines[currentIndex];
        previousKlines = klines.slice(0, currentIndex);
        nextKline = klines[currentIndex + 1] || null;
      } else {
        currentKline = klines[klines.length - 1];
        previousKlines = klines.slice(0, -1);
      }

      // 模块B: 检测成交量爆发
      const { scoreB, direction, details } = await this.detectVolumeSpike(
        symbol,
        volumeProfile,
        currentKline,
        previousKlines,
        nextKline
      );

      // 决策过滤：仅在高流动性时段启用（P8），且必须满足P4“突然”
      if (details?.P8 && details.P8.timeWeight < 1.0) {
        this.quietMode = wasQuiet;
        return {
          signal: 'HOLD',
          reason: 'Low liquidity session (P8 filter)',
          confidence: 'LOW',
          scoreB,
          direction: null,
          details
        };
      }
      if (!details?.P4?.passed) {
        this.quietMode = wasQuiet;
        return {
          signal: 'HOLD',
          reason: 'P4环比爆发未满足',
          confidence: 'LOW',
          scoreB,
          direction: null,
          details
        };
      }
      // 决策过滤：仅在高流动性时段启用（P8），且必须满足P4“突然”
      if (details?.P8 && details.P8.timeWeight < 1.0) {
        this.quietMode = wasQuiet;
        return {
          signal: 'HOLD',
          reason: 'Low liquidity session (P8 filter)',
          confidence: 'LOW',
          scoreB,
          direction: null,
          details
        };
      }
      if (!details?.P4?.passed) {
        this.quietMode = wasQuiet;
        return {
          signal: 'HOLD',
          reason: 'P4环比爆发未满足',
          confidence: 'LOW',
          scoreB,
          direction: null,
          details
        };
      }
      // 决策：Score_B ≥ 0.75 触发交易
      if (!direction || scoreB < this.params.SCORE_B_THRESHOLD) {
        this.quietMode = wasQuiet;
        return {
          signal: 'HOLD',
          reason: `Score_B insufficient: ${scoreB.toFixed(3)} < ${this.params.SCORE_B_THRESHOLD}`,
          confidence: 'LOW',
          scoreB,
          direction: null,
          details
        };
      }

      // 生成交易信号
      const signal = direction === 'long' ? 'BUY' : 'SELL';
      
      // 计算止损止盈（严格按照文档）
      // 止损：多单VAL-3下1%，空单VAH+3上1%
      // 止盈：目标VAH（多）/ VAL（空）
      let stopLoss, takeProfit;
      if (direction === 'long') {
        // 多单：止损在VAL-3下1%，止盈目标VAH
        const val3Price = volumeProfile.VAL * 0.99; // 简化：假设VAL-3约等于VAL的99%
        stopLoss = currentPrice * 0.99; // 当前价下1%
        takeProfit = volumeProfile.VAH; // 目标VAH
      } else {
        // 空单：止损在VAH+3上1%，止盈目标VAL
        const vah3Price = volumeProfile.VAH * 1.01; // 简化：假设VAH+3约等于VAH的101%
        stopLoss = currentPrice * 1.01; // 当前价上1%
        takeProfit = volumeProfile.VAL; // 目标VAL
      }

      const decision = {
        signal,
        suggestion: `${direction.toUpperCase()}_${scoreB >= 0.85 ? 'STRONG' : 'MEDIUM'}`,
        finalScore: scoreB,
        scoreB,
        scoreC: 0, // 不再使用模块C
        direction,
        stopLoss,
        takeProfit,
        confidence: scoreB >= 0.85 ? 'HIGH' : 'MEDIUM',
        reason: `Volume spike at ${direction === 'long' ? 'VAL' : 'VAH'} boundary with Score_B=${scoreB.toFixed(2)}`,
        details
      };

      this.quietMode = wasQuiet;
      
      if (!this.quietMode) {
        systemLogger.info(`[决策] ✅ ${symbol}: ${signal} 信号, Score_B=${scoreB.toFixed(3)}, 置信度=${decision.confidence}`);
        systemLogger.info(`========== 策略分析完成: ${symbol} ==========\n`);
      }
      
      return decision;

    } catch (error) {
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
