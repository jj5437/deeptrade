const { systemLogger } = require('../logger/Logger');
const exchangeUtils = require('../exchange/ExchangeUtils');

/**
 * 成交量动态正态分布策略 v2.1 - 优化版
 * 基于 正态分布初稿1策略 - 优化1.txt 实现
 * 
 * 核心优化：
 * 1. 边沿定义：VAH ~ VAH+3（右侧3根K线），VAL-3 ~ VAL（左侧3根K线）
 * 2. 8参数系统优化：
 *    - P1权重提升：0.25 → 0.30
 *    - P2局部Z值放宽：2.3 → 1.8（捕捉早期异动）
 *    - P3全局Z值放宽：2.0 → 1.5（防假突破）
 *    - P4动态双模式：模式A(1.7×快信号) 或 模式B(1.5×+T+1确认)，权重0.20 → 0.15
 *    - P5放宽：1.9 → 1.6（防毛刺）
 *    - P6放宽：1.3 → 1.1（保留弱峰机会）
 *    - P7放宽：0.6 → 0.7
 *    - P8重构：动态流动性评分系统（亚洲1.1，欧美1.3，深夜0.7）
 * 3. Score_B阈值降低：0.75 → 0.65（提升信号频率）
 * 4. 流动性评分作为乘数（取代硬过滤）
 * 5. 动态止损：VAL/VAH ± 3×ATR(14)
 * 6. 分批止盈：50%@VPOC + 50%追踪止盈(1.5×ATR)
 * 
 * 适配说明（2分钟K线）：
 * - K线数量：720根（24小时，2分钟K线）
 * - 边沿范围：保持3根K线（文档要求）
 */
class VolumeProfileStrategy {
  constructor() {
    this.klineLimit = 720; // 720根K线（24小时，2分钟K线）
    this.windowThreshold = 0.3; // 窗口阈值：峰值的30%
    this.edgeRange = 3; // 边沿范围：3根K线（文档要求：VAH+3, VAL-3）
    this.valueAreaPercentage = 0.7; // 价值区域：70%成交量
    this.quietMode = false; // 静默模式（回测时减少日志）
    
    // 模块B：8参数系统（v2.1优化版）
    this.params = {
      // P1: 边沿位置（必须，权重提升）
      P1_WEIGHT: 0.30,
      
      // P2: 局部Z值 (Vₜ - μ_local)/σ_local > 1.8（放宽，捕捉早期异动）
      P2_LOCAL_Z_THRESHOLD: 1.8,
      P2_WEIGHT: 0.20,
      
      // P3: 全局Z值 (Vₜ - μ_720)/σ_720 > 1.5（放宽，防假突破）
      P3_GLOBAL_Z_THRESHOLD: 1.5,
      P3_WEIGHT: 0.15,
      
      // P4: 动态双模式环比爆发
      // 模式A：Vₜ / Vₜ₋₁ > 1.7（快信号）
      // 模式B：Vₜ / Vₜ₋₁ > 1.5 且 Vₜ₊₁ > 0.8 × Vₜ（T+1确认，防假量）
      P4_VOLUME_RATIO_FAST: 1.7,      // 模式A阈值
      P4_VOLUME_RATIO_CONFIRM: 1.5,   // 模式B阈值
      P4_CONTINUATION_CONFIRM: 0.8,   // 模式B的T+1确认阈值
      P4_WEIGHT: 0.15,
      
      // P5: 5期均值 Vₜ / 平均(Vₜ₋₅~ₜ₋₁) > 1.6倍（放宽，防毛刺）
      P5_MA5_RATIO: 1.6,
      P5_WEIGHT: 0.10,
      
      // P6: 分布强度 当前峰值 > 1.1 × 全天均值（放宽，保留弱峰机会）
      P6_DIST_STRENGTH: 1.1,
      P6_WEIGHT: 0.05,
      
      // P7: 次根持续 Vₜ₊₁ > 0.7 × Vₜ（略放宽）
      P7_CONTINUATION_RATIO: 0.7,
      P7_WEIGHT: 0.03,
      
      // P8: 动态流动性评分系统
      P8_WEIGHT: 0.02,
      P8_TIME_COEFFICIENTS: {
        ASIAN: 1.1,    // 亚洲盘
        EUROPE_US: 1.3, // 欧美盘
        NIGHT: 0.7      // 深夜
      },
      
      // Score_B 阈值（优化：0.75 → 0.65，提升信号频率）
      SCORE_B_THRESHOLD: 0.65,
      
      // ATR参数（用于动态止损止盈）
      ATR_PERIOD: 14,
      ATR_STOP_MULTIPLIER: 3.0,
      ATR_TRAILING_MULTIPLIER: 1.5
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
   * 计算ATR（Average True Range）
   * @param {Array} klines - K线数据数组 [timestamp, open, high, low, close, volume]
   * @param {number} period - ATR周期，默认14
   * @returns {number} ATR值
   */
  calculateATR(klines, period = 14) {
    if (!klines || klines.length < period + 1) {
      return 0;
    }

    const trueRanges = [];
    for (let i = 1; i < klines.length; i++) {
      const high = klines[i][2];
      const low = klines[i][3];
      const prevClose = klines[i - 1][4];
      
      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      trueRanges.push(tr);
    }

    // 计算ATR（简单移动平均）
    const recentTR = trueRanges.slice(-period);
    const atr = recentTR.reduce((sum, tr) => sum + tr, 0) / recentTR.length;
    
    return atr;
  }

  /**
   * 获取时段系数（P8优化版）
   * 亚洲×1.1，欧美×1.3，深夜×0.7
   */
  getTimeCoefficient(timestamp) {
    const date = new Date(timestamp);
    const hour = date.getUTCHours();
    
    // 亚洲盘：8:00-16:00 UTC（北京时间16:00-00:00）
    if (hour >= 8 && hour < 16) {
      return this.params.P8_TIME_COEFFICIENTS.ASIAN;
    }
    // 欧美盘：16:00-24:00 UTC（北京时间00:00-08:00）
    else if (hour >= 16 && hour < 24) {
      return this.params.P8_TIME_COEFFICIENTS.EUROPE_US;
    }
    // 深夜：0:00-8:00 UTC（北京时间08:00-16:00）
    else {
      return this.params.P8_TIME_COEFFICIENTS.NIGHT;
    }
  }

  /**
   * 计算动态流动性评分（P8优化版）
   * L = min(1.0, Vₜ / avg(Vₜ₋₃₀~ₜ₋₁)) × 时段系数
   * @param {number} currentVolume - 当前成交量
   * @param {Array} previousKlines - 历史K线数据
   * @param {number} timestamp - 当前时间戳
   * @returns {number} 流动性评分 L
   */
  calculateLiquidityScore(currentVolume, previousKlines, timestamp) {
    if (!previousKlines || previousKlines.length < 30) {
      return 1.0; // 数据不足，返回中性评分
    }

    // 计算最近30根K线的平均成交量
    const recent30Volumes = previousKlines.slice(-30).map(k => k[5]);
    const avg30 = recent30Volumes.reduce((sum, v) => sum + v, 0) / recent30Volumes.length;
    
    // 成交量比率，最大为1.0
    const volumeRatio = Math.min(1.0, currentVolume / avg30);
    
    // 时段系数
    const timeCoefficient = this.getTimeCoefficient(timestamp);
    
    // 流动性评分
    const liquidityScore = volumeRatio * timeCoefficient;
    
    return liquidityScore;
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

      // P4: 动态双模式环比爆发
      // 模式A：Vₜ / Vₜ₋₁ > 1.7（快信号）
      // 模式B：Vₜ / Vₜ₋₁ > 1.5 且 Vₜ₊₁ > 0.8 × Vₜ（T+1确认，防假量）
      const previousVolume = previousKlines[previousKlines.length - 1][5];
      const volumeRatio = currentVolume / previousVolume;
      
      let p4Pass = false;
      let p4Mode = null;
      
      // 模式A：快信号
      if (volumeRatio > this.params.P4_VOLUME_RATIO_FAST) {
        p4Pass = true;
        p4Mode = 'A';
      }
      // 模式B：T+1确认（需要nextKline）
      else if (volumeRatio > this.params.P4_VOLUME_RATIO_CONFIRM && nextKline) {
        const nextVolume = nextKline[5];
        const continuationRatio = nextVolume / currentVolume;
        if (continuationRatio > this.params.P4_CONTINUATION_CONFIRM) {
          p4Pass = true;
          p4Mode = 'B';
        }
      }
      
      if (p4Pass) {
        scoreB += this.params.P4_WEIGHT;
      }
      
      details.P4 = { 
        passed: p4Pass, 
        mode: p4Mode,
        ratio: volumeRatio.toFixed(2), 
        thresholdFast: this.params.P4_VOLUME_RATIO_FAST,
        thresholdConfirm: this.params.P4_VOLUME_RATIO_CONFIRM
      };
      
      if (!this.quietMode) {
        systemLogger.info(`[模块B] ${symbol} P4: 环比=${volumeRatio.toFixed(2)} 模式=${p4Mode || 'N/A'} ${p4Pass ? '✓ 通过' : '✗ 未通过'}`);
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

      // P8: 动态流动性评分系统（不再直接加分，而是作为Score_B的乘数）
      const liquidityScore = this.calculateLiquidityScore(currentVolume, previousKlines, currentTimestamp);
      const timeCoefficient = this.getTimeCoefficient(currentTimestamp);
      
      details.P8 = { 
        liquidityScore: liquidityScore.toFixed(3),
        timeCoefficient: timeCoefficient,
        note: '流动性评分将作为Score_B的乘数'
      };
      
      if (!this.quietMode) {
        systemLogger.info(`[模块B] ${symbol} P8: 流动性评分=${liquidityScore.toFixed(3)} (时段系数=${timeCoefficient})`);
      }

      // 应用流动性评分作为乘数
      const scoreBWithLiquidity = scoreB * liquidityScore;
      
      if (!this.quietMode) {
        systemLogger.info(`[模块B] ${symbol} 基础得分: ${scoreB.toFixed(3)}, 流动性评分: ${liquidityScore.toFixed(3)}, 最终得分: ${scoreBWithLiquidity.toFixed(3)}, 方向: ${direction}`);
      }
      
      return { 
        scoreB: scoreBWithLiquidity,  // 返回应用流动性评分后的得分
        scoreBRaw: scoreB,              // 保留原始得分用于调试
        liquidityScore,
        direction, 
        details 
      };

    } catch (error) {
      systemLogger.error(`[模块B] 检测 ${symbol} 成交量爆发失败: ${error.message}`);
      return { scoreB: 0, scoreBRaw: 0, liquidityScore: 0, direction: null, details: {} };
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

      // 模块B: 检测成交量爆发（已包含流动性评分）
      const { scoreB, scoreBRaw, liquidityScore, direction, details } = await this.detectVolumeSpike(
        symbol,
        volumeProfile,
        currentKline,
        previousKlines,
        nextKline
      );

      // 移除硬过滤，流动性评分已作为乘数应用到scoreB中
      // P4检查：必须满足P4（确保有"突然"特征）
      if (!details?.P4?.passed) {
        this.quietMode = wasQuiet;
        return {
          signal: 'HOLD',
          reason: 'P4环比爆发未满足',
          confidence: 'LOW',
          scoreB,
          scoreBRaw,
          liquidityScore,
          direction: null,
          details
        };
      }
      // 决策：Score_B ≥ 0.65 触发交易（已包含流动性评分）
      if (!direction || scoreB < this.params.SCORE_B_THRESHOLD) {
        this.quietMode = wasQuiet;
        return {
          signal: 'HOLD',
          reason: `Score_B insufficient: ${scoreB.toFixed(3)} < ${this.params.SCORE_B_THRESHOLD}`,
          confidence: 'LOW',
          scoreB,
          scoreBRaw,
          liquidityScore,
          direction: null,
          details
        };
      }

      // 生成交易信号
      const signal = direction === 'long' ? 'BUY' : 'SELL';
      
      // 计算ATR（用于动态止损止盈）
      const atr = this.calculateATR(klines.slice(0, this.klineLimit), this.params.ATR_PERIOD);
      
      // 动态止损：VAL/VAH ± 3×ATR
      // 分批止盈：50%@VPOC + 50%追踪止盈(1.5×ATR)
      let stopLoss, takeProfit1, takeProfit2, trailingStop;
      
      if (direction === 'long') {
        // 多单：止损在VAL - 3×ATR
        stopLoss = volumeProfile.VAL - (this.params.ATR_STOP_MULTIPLIER * atr);
        // 第一批止盈：50%@VPOC
        takeProfit1 = volumeProfile.VPOC;
        // 第二批止盈：目标VAH
        takeProfit2 = volumeProfile.VAH;
        // 追踪止盈：距当前价 1.5×ATR
        trailingStop = currentPrice - (this.params.ATR_TRAILING_MULTIPLIER * atr);
      } else {
        // 空单：止损在VAH + 3×ATR
        stopLoss = volumeProfile.VAH + (this.params.ATR_STOP_MULTIPLIER * atr);
        // 第一批止盈：50%@VPOC
        takeProfit1 = volumeProfile.VPOC;
        // 第二批止盈：目标VAL
        takeProfit2 = volumeProfile.VAL;
        // 追踪止盈：距当前价 1.5×ATR
        trailingStop = currentPrice + (this.params.ATR_TRAILING_MULTIPLIER * atr);
      }

      const decision = {
        signal,
        suggestion: `${direction.toUpperCase()}_${scoreB >= 0.80 ? 'STRONG' : 'MEDIUM'}`,
        finalScore: scoreB,
        scoreB,
        scoreBRaw,
        liquidityScore,
        scoreC: 0, // 不再使用模块C
        direction,
        // 动态止损止盈
        stopLoss,
        takeProfit: takeProfit2,  // 主要目标
        takeProfit1,              // 第一批止盈 (50%@VPOC)
        takeProfit2,              // 第二批止盈 (50%@VAH/VAL)
        trailingStop,             // 追踪止盈
        atr,                      // ATR值，供参考
        confidence: scoreB >= 0.80 ? 'HIGH' : 'MEDIUM',
        reason: `Volume spike at ${direction === 'long' ? 'VAL' : 'VAH'} boundary with Score_B=${scoreB.toFixed(2)} (raw=${scoreBRaw.toFixed(2)}, L=${liquidityScore.toFixed(2)})`,
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
