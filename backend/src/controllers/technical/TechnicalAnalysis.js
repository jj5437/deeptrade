const { SMA, EMA, RSI, MACD, ATR } = require('technicalindicators');
const { systemLogger } = require('../logger/Logger');
const exchangeUtils = require('../exchange/ExchangeUtils');

/**
 * 技术分析模块
 */
class TechnicalAnalysis {
  /**
   * 检查3分钟K线是否收盘（失效条件检查）
   */
  checkKlineClose(currentPrice, invalidationLevel) {
    return currentPrice >= invalidationLevel;
  }

  /**
   * 分析15分钟趋势
   */
  analyze15mTrend(klineData) {
    try {
      if (!klineData || klineData.length < 20) {
        return {
          trend: 'UNKNOWN',
          reason: '数据不足',
          confidence: 0
        };
      }

      const closes = klineData.map(k => k.close);
      const highs = klineData.map(k => k.high);
      const lows = klineData.map(k => k.low);

      // 计算技术指标
      const sma20 = SMA.calculate({ period: 20, values: closes });
      const ema12 = EMA.calculate({ period: 12, values: closes });
      const ema26 = EMA.calculate({ period: 26, values: closes });
      const rsi = RSI.calculate({ period: 14, values: closes });

      const currentClose = closes[closes.length - 1];
      const currentSma20 = sma20[sma20.length - 1];
      const currentEma12 = ema12[ema12.length - 1];
      const currentEma26 = ema26[ema26.length - 1];
      const currentRsi = rsi[rsi.length - 1];

      // MACD计算
      const macd = currentEma12 - currentEma26;

      // 趋势判断逻辑
      let trend = 'SIDEWAYS';
      let reason = '';
      let confidence = 0.5;

      // 价格相对于均线
      const priceAboveSma20 = currentClose > currentSma20;
      const priceAboveEma12 = currentClose > currentEma12;

      // EMA金叉死叉
      const emaBullish = currentEma12 > currentEma26;

      // RSI超买超卖
      const rsiOverbought = currentRsi > 70;
      const rsiOversold = currentRsi < 30;

      // 综合判断
      if (priceAboveSma20 && emaBullish && macd > 0 && !rsiOverbought) {
        trend = 'BULLISH';
        reason = `价格突破均线(EMA12>EMA26), MACD为正(${macd.toFixed(2)}), RSI适中(${currentRsi.toFixed(1)})`;
        confidence = 0.8;
      } else if (!priceAboveSma20 && !emaBullish && macd < 0 && !rsiOversold) {
        trend = 'BEARISH';
        reason = `价格跌破均线(EMA12<EMA26), MACD为负(${macd.toFixed(2)}), RSI适中(${currentRsi.toFixed(1)})`;
        confidence = 0.8;
      } else if (rsiOverbought) {
        trend = 'BEARISH';
        reason = `RSI超买(${currentRsi.toFixed(1)} > 70), 可能回调`;
        confidence = 0.6;
      } else if (rsiOversold) {
        trend = 'BULLISH';
        reason = `RSI超卖(${currentRsi.toFixed(1)} < 30), 可能反弹`;
        confidence = 0.6;
      }

      return {
        trend,
        reason,
        confidence,
        indicators: {
          sma20: currentSma20,
          ema12: currentEma12,
          ema26: currentEma26,
          macd,
          rsi: currentRsi
        }
      };
    } catch (error) {
      systemLogger.error(`15分钟趋势分析失败: ${error.message}`);
      return {
        trend: 'ERROR',
        reason: `分析错误: ${error.message}`,
        confidence: 0
      };
    }
  }

  /**
   * 分析4小时趋势
   */
  analyze4hTrend(klineData) {
    try {
      if (!klineData || klineData.length < 50) {
        return {
          trend: 'UNKNOWN',
          reason: '数据不足',
          confidence: 0
        };
      }

      const closes = klineData.map(k => k.close);
      const highs = klineData.map(k => k.high);
      const lows = klineData.map(k => k.low);

      // 计算技术指标
      const sma50 = SMA.calculate({ period: 50, values: closes });
      const ema21 = EMA.calculate({ period: 21, values: closes });
      const rsi = RSI.calculate({ period: 14, values: closes });

      const currentClose = closes[closes.length - 1];
      const currentSma50 = sma50[sma50.length - 1];
      const currentEma21 = ema21[ema21.length - 1];
      const currentRsi = rsi[rsi.length - 1];

      // 趋势判断
      let trend = 'SIDEWAYS';
      let reason = '';
      let confidence = 0.5;

      const priceAboveSma50 = currentClose > currentSma50;
      const priceAboveEma21 = currentClose > currentEma21;
      const emaBullish = currentEma21 > currentSma50;

      if (priceAboveSma50 && priceAboveEma21 && emaBullish) {
        trend = 'BULLISH';
        reason = `4小时级别多头排列(价格>EMA21>SMA50), RSI: ${currentRsi.toFixed(1)}`;
        confidence = 0.9;
      } else if (!priceAboveSma50 && !priceAboveEma21 && !emaBullish) {
        trend = 'BEARISH';
        reason = `4小时级别空头排列(价格<EMA21<SMA50), RSI: ${currentRsi.toFixed(1)}`;
        confidence = 0.9;
      } else {
        trend = 'SIDEWAYS';
        reason = `4小时级别震荡整理, RSI: ${currentRsi.toFixed(1)}`;
        confidence = 0.5;
      }

      return {
        trend,
        reason,
        confidence,
        indicators: {
          sma50: currentSma50,
          ema21: currentEma21,
          rsi: currentRsi
        }
      };
    } catch (error) {
      systemLogger.error(`4小时趋势分析失败: ${error.message}`);
      return {
        trend: 'ERROR',
        reason: `分析错误: ${error.message}`,
        confidence: 0
      };
    }
  }

  /**
   * 获取多时间框架分析
   */
  getMultiTimeframeAnalysis(symbol, trendAnalysis, kline15m, kline4h) {
    try {
      const analysis15m = this.analyze15mTrend(kline15m);
      const analysis4h = this.analyze4hTrend(kline4h);

      trendAnalysis[symbol] = {
        '15m': analysis15m,
        '4h': analysis4h,
        updatedAt: new Date().toISOString()
      };

      // 趋势一致性检查
      const trendConsistency = this.checkTrendConsistency(analysis15m, analysis4h);

      return {
        symbol,
        ...trendAnalysis[symbol],
        consistency: trendConsistency
      };
    } catch (error) {
      systemLogger.error(`多时间框架分析失败: ${error.message}`);
      return {
        symbol,
        '15m': { trend: 'ERROR', reason: error.message },
        '4h': { trend: 'ERROR', reason: error.message },
        consistency: false
      };
    }
  }

  /**
   * 检查趋势一致性
   */
  checkTrendConsistency(analysis15m, analysis4h) {
    const trend15m = analysis15m.trend;
    const trend4h = analysis4h.trend;

    // 强一致
    if (trend15m === trend4h && ['BULLISH', 'BEARISH'].includes(trend15m)) {
      return {
        consistent: true,
        level: 'STRONG',
        reason: `${trend15m}趋势一致`
      };
    }

    // 部分一致
    if (trend15m === 'BULLISH' && trend4h !== 'BEARISH') {
      return {
        consistent: true,
        level: 'WEAK',
        reason: '15分钟看多，4小时中性或看多'
      };
    }

    if (trend15m === 'BEARISH' && trend4h !== 'BULLISH') {
      return {
        consistent: true,
        level: 'WEAK',
        reason: '15分钟看空，4小时中性或看空'
      };
    }

    // 不一致
    return {
      consistent: false,
      level: 'NONE',
      reason: `15分钟${trend15m}与4小时${trend4h}趋势冲突`
    };
  }

  /**
   * 检测背离
   */
  detectDivergence(klineData) {
    try {
      if (!klineData || klineData.length < 50) {
        return { detected: false, type: null };
      }

      const closes = klineData.map(k => k.close);
      const highs = klineData.map(k => k.high);
      const lows = klineData.map(k => k.low);
      const rsi = RSI.calculate({ period: 14, values: closes });

      // 查找最近的高点和低点
      const recentHighs = highs.slice(-20);
      const recentLows = lows.slice(-20);
      const recentRsi = rsi.slice(-20);

      const maxHigh = Math.max(...recentHighs);
      const maxHighIndex = recentHighs.indexOf(maxHigh);
      const rsiAtMaxHigh = recentRsi[maxHighIndex];

      const minLow = Math.min(...recentLows);
      const minLowIndex = recentLows.indexOf(minLow);
      const rsiAtMinLow = recentRsi[minLowIndex];

      const currentPrice = closes[closes.length - 1];
      const currentRsi = rsi[rsi.length - 1];

      // 顶背离检测
      if (currentPrice > maxHigh && currentRsi < rsiAtMaxHigh) {
        return {
          detected: true,
          type: 'BEARISH_DIVERGENCE',
          reason: '价格创新高但RSI未创新高，警惕回调'
        };
      }

      // 底背离检测
      if (currentPrice < minLow && currentRsi > rsiAtMinLow) {
        return {
          detected: true,
          type: 'BULLISH_DIVERGENCE',
          reason: '价格创新低但RSI未创新低，可能反弹'
        };
      }

      return { detected: false, type: null };
    } catch (error) {
      systemLogger.error(`背离检测失败: ${error.message}`);
      return { detected: false, type: 'ERROR', reason: error.message };
    }
  }

  /**
   * 获取完整的技术指标时间序列（AlphaArena风格）
   */
  async getTechnicalIndicatorsSeries(symbol, timeframe = '3m', limit = 60) {
    try {
      const tradeSymbol = symbol; // ExchangeUtils会处理符号格式

      // 获取K线数据（请求更多数据点以确保EMA50计算正常）
      const ohlcv = await exchangeUtils.getOHLCVWithRetry(tradeSymbol, timeframe, limit);

      if (!ohlcv || ohlcv.length < 50) {
        systemLogger.warn(`${symbol} ${timeframe} K线数据不足，需要至少50个数据点，实际获取: ${ohlcv ? ohlcv.length : 0}`);
        return null;
      }

      // 转换为价格序列
      const closes = ohlcv.map(k => k[4]); // close
      const highs = ohlcv.map(k => k[2]); // high
      const lows = ohlcv.map(k => k[3]); // low
      const volumes = ohlcv.map(k => k[5]); // volume

      // 验证数据完整性
      if (!closes || closes.length < 50 || closes.some(c => c === undefined || c === null)) {
        systemLogger.warn(`${symbol} 收盘价数据不完整`);
        return null;
      }

      // 计算技术指标
      const ema20 = EMA.calculate({ period: 20, values: closes });
      const ema50 = EMA.calculate({ period: 50, values: closes });

      let macd;
      try {
        const macdResult = MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 });

        // MACD.calculate 返回的是数组，每个元素包含 MACD, signal, histogram
        if (Array.isArray(macdResult) && macdResult.length > 0) {
          macd = {
            MACD: macdResult.map(x => x.MACD),
            signal: macdResult.map(x => x.signal),
            histogram: macdResult.map(x => x.histogram)
          };
        } else {
          systemLogger.warn(`${symbol} MACD返回格式不正确`);
          return null;
        }
      } catch (error) {
        systemLogger.warn(`${symbol} MACD计算失败: ${error.message}`);
        systemLogger.warn(`${symbol} 收盘价数据示例: ${closes.slice(0, 5).join(', ')}...`);
        systemLogger.warn(`${symbol} 收盘价数据: 最小=${Math.min(...closes).toFixed(2)}, 最大=${Math.max(...closes).toFixed(2)}, 包含NaN=${closes.some(c => isNaN(c))}`);
        return null;
      }

      const rsi7 = RSI.calculate({ period: 7, values: closes });
      const rsi14 = RSI.calculate({ period: 14, values: closes });
      const atr3 = ATR.calculate({ high: highs, low: lows, close: closes, period: 3 });
      const atr14 = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });

      // 验证技术指标计算结果 - 只需要确保至少有一个数据点
      if (!ema20 || ema20.length === 0) {
        systemLogger.warn(`${symbol} EMA20计算失败`);
        return null;
      }

      if (!macd || !macd.MACD || macd.MACD.length === 0) {
        systemLogger.warn(`${symbol} MACD计算失败`);
        return null;
      }

      if (!rsi7 || rsi7.length === 0) {
        systemLogger.warn(`${symbol} RSI7计算失败`);
        return null;
      }

      // 计算成交量平均值
      const volumeAvg = volumes.reduce((a, b) => a + b, 0) / volumes.length;

      // 返回最近10个数据点（与AlphaArena一致）
      const resultLimit = Math.min(10, closes.length);

      return {
        symbol,
        timeframe,
        currentPrice: closes[closes.length - 1],
        currentEma20: ema20[ema20.length - 1],
        currentMacd: macd.MACD[macd.MACD.length - 1],
        currentRsi7: rsi7[rsi7.length - 1],
        currentRsi14: rsi14[rsi14.length - 1],
        currentVolume: volumes[volumes.length - 1],
        avgVolume: volumeAvg,
        // 时间序列（最近10个点，oldest → newest）
        midPrices: closes.slice(-resultLimit),
        ema20Series: ema20.slice(-resultLimit).map(x => parseFloat(x.toFixed(3))),
        ema50Series: ema50.slice(-resultLimit).map(x => parseFloat(x.toFixed(3))),
        macdSeries: macd.MACD.slice(-resultLimit).map(x => parseFloat(x.toFixed(3))),
        rsi7Series: rsi7.slice(-resultLimit).map(x => parseFloat(x.toFixed(2))),
        rsi14Series: rsi14.slice(-resultLimit).map(x => parseFloat(x.toFixed(2))),
        atr3Series: atr3.slice(-resultLimit).map(x => parseFloat(x.toFixed(3))),
        atr14Series: atr14.slice(-resultLimit).map(x => parseFloat(x.toFixed(3))),
        volumeSeries: volumes.slice(-resultLimit)
      };
    } catch (error) {
      systemLogger.error(`获取 ${symbol} ${timeframe} 技术指标失败: ${error.message}`);
      systemLogger.error(`错误堆栈: ${error.stack}`);
      return null;
    }
  }
}

module.exports = new TechnicalAnalysis();
