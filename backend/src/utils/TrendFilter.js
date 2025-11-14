/**
 * 趋势过滤器
 * 识别市场状态，避免在震荡市交易
 */

class TrendFilter {
  /**
   * 计算EMA
   */
  static calculateEMA(klines, period) {
    const closes = klines.map(k => k[4]);
    const multiplier = 2 / (period + 1);
    let ema = closes[0];
    
    for (let i = 1; i < closes.length; i++) {
      ema = (closes[i] - ema) * multiplier + ema;
    }
    
    return ema;
  }

  /**
   * 识别市场状态
   * @param {Array} klines - 至少需要100根K线
   * @returns {string} 'UPTREND' | 'DOWNTREND' | 'RANGING'
   */
  static identifyMarketState(klines) {
    if (!klines || klines.length < 100) {
      return 'UNKNOWN';
    }

    // 计算多个周期的EMA
    const ema20 = this.calculateEMA(klines.slice(-100), 20);
    const ema50 = this.calculateEMA(klines.slice(-100), 50);
    const ema100 = this.calculateEMA(klines.slice(-100), 100);
    
    const currentPrice = klines[klines.length - 1][4];
    
    // 计算EMA的间距（判断趋势强度）
    const ema20_50_gap = Math.abs(ema20 - ema50) / ema50;
    const ema50_100_gap = Math.abs(ema50 - ema100) / ema100;
    
    // 强趋势阈值：降低到0.5%，更容易识别趋势
    const strongTrendThreshold = 0.005; // 0.5%（原1%）
    
    // 判断上升趋势
    if (ema20 > ema50 && ema50 > ema100 && 
        ema20_50_gap > strongTrendThreshold) {
      return 'UPTREND';
    }
    
    // 判断下降趋势
    if (ema20 < ema50 && ema50 < ema100 && 
        ema20_50_gap > strongTrendThreshold) {
      return 'DOWNTREND';
    }
    
    // 震荡市
    return 'RANGING';
  }

  /**
   * 判断信号是否应该执行
   * @param {string} marketState - 市场状态
   * @param {string} signalDirection - 信号方向 'long' | 'short'
   * @param {number} finalScore - 信号得分
   * @returns {Object} { allowed: boolean, reason: string, adjustedScore: number }
   */
  static shouldExecuteSignal(marketState, signalDirection, finalScore) {
    // ==================== 只做空模式 ====================
    // 回测数据显示：
    // - 做空（熊市）: +13.37%，胜率35.17% ✓
    // - 做多（牛市）: -31.57%，胜率31.47% ✗
    // - 做多（震荡）: -37.38%，胜率21.70% ✗
    // 结论：策略只在做空时有效，禁止做多
    const ONLY_SHORT_MODE = true;
    
    if (ONLY_SHORT_MODE && signalDirection === 'long') {
      return {
        allowed: false,
        reason: 'SHORT-ONLY mode: Long signals disabled (poor backtest performance)',
        adjustedScore: 0
      };
    }
    // ==================== 只做空模式结束 ====================
    
    // 震荡市：提高阈值而非完全禁止（平衡方案）
    if (marketState === 'RANGING') {
      // 震荡市要求更高的信号质量
      const requiredScore = 0.60; // 震荡市需要60分以上
      if (finalScore >= requiredScore) {
        return {
          allowed: true,
          reason: 'Ranging market - high quality signal accepted',
          adjustedScore: finalScore
        };
      } else {
        return {
          allowed: false,
          reason: `Ranging market - score ${finalScore.toFixed(2)} < ${requiredScore}`,
          adjustedScore: finalScore
        };
      }
    }
    
    // 上升趋势：允许做多，做空需要更高分数
    if (marketState === 'UPTREND') {
      if (signalDirection === 'long') {
        // 顺势做多：降低要求
        return {
          allowed: finalScore >= 0.45,
          reason: 'Uptrend - long signal with trend',
          adjustedScore: finalScore
        };
      } else {
        // 逆势做空：提高要求
        return {
          allowed: finalScore >= 0.65,
          reason: signalDirection === 'short' && finalScore >= 0.65
            ? 'Uptrend - strong short signal accepted (counter-trend)'
            : `Uptrend - short signal filtered (score ${finalScore.toFixed(2)} < 0.65)`,
          adjustedScore: finalScore
        };
      }
    }
    
    // 下降趋势：允许做空，做多需要更高分数
    if (marketState === 'DOWNTREND') {
      if (signalDirection === 'short') {
        // 顺势做空：降低要求
        return {
          allowed: finalScore >= 0.45,
          reason: 'Downtrend - short signal with trend',
          adjustedScore: finalScore
        };
      } else {
        // 逆势做多：提高要求
        return {
          allowed: finalScore >= 0.65,
          reason: signalDirection === 'long' && finalScore >= 0.65
            ? 'Downtrend - strong long signal accepted (counter-trend)'
            : `Downtrend - long signal filtered (score ${finalScore.toFixed(2)} < 0.65)`,
          adjustedScore: finalScore
        };
      }
    }
    
    // 未知状态：保守处理
    return {
      allowed: finalScore >= 0.55,
      reason: 'Unknown market state - moderate threshold',
      adjustedScore: finalScore
    };
  }

  /**
   * 计算趋势强度 (0-1)
   */
  static calculateTrendStrength(klines) {
    if (!klines || klines.length < 100) {
      return 0;
    }

    const ema20 = this.calculateEMA(klines.slice(-100), 20);
    const ema50 = this.calculateEMA(klines.slice(-100), 50);
    
    // 间距越大，趋势越强
    const gap = Math.abs(ema20 - ema50) / ema50;
    
    // 归一化到0-1
    return Math.min(gap / 0.05, 1); // 5%以上算最强趋势
  }
}

module.exports = TrendFilter;

