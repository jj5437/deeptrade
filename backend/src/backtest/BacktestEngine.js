const { systemLogger } = require('../controllers/logger/Logger');
const VolumeProfileStrategy = require('../controllers/strategy/VolumeProfileStrategy');
const PerformanceMetrics = require('./PerformanceMetrics');
const TrendFilter = require('../utils/TrendFilter');
const fs = require('fs');
const path = require('path');

/**
 * 回测引擎
 * 基于历史数据模拟交易策略执行
 */
class BacktestEngine {
  constructor(config = {}) {
    // 基础配置
    this.symbol = config.symbol || 'BTC/USDT';
    this.timeframe = config.timeframe || '1m';
    this.initialCapital = config.initialCapital || 10000;
    this.positionUsd = config.positionUsd || 10;
    this.leverage = config.leverage || 10;
    this.feeRate = config.feeRate || 0.0004; // 0.04%

    // 止损止盈（优化：放宽空间，减少震荡市被打止损）
    this.stopLossPct = config.stopLossPct || 0.010; // 1.0%（原0.6%）
    this.takeProfitPct = config.takeProfitPct || 0.020; // 2.0%（原1.2%）

    // 滑点配置
    this.slippageMode = config.slippageMode || 'fixed'; // 'fixed' or 'dynamic'
    this.fixedSlippage = config.fixedSlippage || 0.0005; // 0.05%
    this.atrPeriod = config.atrPeriod || 14;
    this.atrFactor = config.atrFactor || 0.1;

    // 策略实例
    this.strategy = VolumeProfileStrategy;
    this.metricsCalculator = new PerformanceMetrics();

    // 回测状态
    this.currentCapital = this.initialCapital;
    this.currentPosition = null;
    this.trades = [];
    this.equityCurve = [];
    
    // 权益曲线采样频率（每N根K线记录一次，减少内存占用）
    this.equitySampleRate = config.equitySampleRate || 100;
    
    // 信号统计
    this.signalStats = {
      total: 0,
      buy: 0,
      sell: 0,
      hold: 0,
      errors: 0,
      edgeHits: 0  // 边沿触发次数
    };
    
    // 诊断模式：前N次边沿触发时输出详细日志
    this.diagnosticMode = config.diagnosticMode !== false; // 默认开启
    this.diagnosticLimit = config.diagnosticLimit || 20; // 前20次
    
    // 输出目录
    this.outputDir = path.join(__dirname, '../../data/backtest');
    this.ensureOutputDirectory();

    systemLogger.info('🚀 回测引擎初始化完成');
    systemLogger.info(`   交易对: ${this.symbol}`);
    systemLogger.info(`   时间周期: ${this.timeframe}`);
    systemLogger.info(`   初始资金: $${this.initialCapital}`);
    systemLogger.info(`   杠杆: ${this.leverage}x`);
    systemLogger.info(`   止损: ${(this.stopLossPct * 100).toFixed(2)}%`);
    systemLogger.info(`   止盈: ${(this.takeProfitPct * 100).toFixed(2)}%`);
  }

  /**
   * 确保输出目录存在
   */
  ensureOutputDirectory() {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
      systemLogger.info(`📁 创建输出目录: ${this.outputDir}`);
    }
  }

  /**
   * 运行回测
   * @param {Array} klines - K线数据
   * @param {Object} options - 额外选项
   * @returns {Promise<Object>} 回测结果
   */
  async runBacktest(klines, options = {}) {
    systemLogger.info('\n' + '='.repeat(80));
    systemLogger.info('开始回测');
    systemLogger.info('='.repeat(80));

    // 重置状态
    this.currentCapital = this.initialCapital;
    this.currentPosition = null;
    this.trades = [];
    this.equityCurve = [];
    this.signalStats = {
      total: 0,
      buy: 0,
      sell: 0,
      hold: 0,
      errors: 0,
      edgeHits: 0
    };

    // 初始权益记录
    this.equityCurve.push({
      index: 0,
      timestamp: klines[0][0],
      equity: this.currentCapital,
      position: null
    });

    // 计算ATR（如果使用动态滑点）
    let atrValues = [];
    if (this.slippageMode === 'dynamic') {
      atrValues = this.calculateATR(klines, this.atrPeriod);
    }

    // 策略需要720根K线的历史数据
    const minBars = 720;
    systemLogger.info(`📊 K线数据: ${klines.length} 根`);
    systemLogger.info(`📊 策略需要: ${minBars} 根历史数据`);

    if (klines.length < minBars) {
      throw new Error(`K线数据不足：需要至少 ${minBars} 根，当前仅有 ${klines.length} 根`);
    }

    // 从第720根K线开始回测
    for (let i = minBars; i < klines.length; i++) {
      const currentKline = klines[i];
      const currentPrice = currentKline[4]; // close price
      const currentTime = currentKline[0];

      // 检查是否有持仓
      if (this.currentPosition) {
        // 检查止损止盈
        const exitResult = this.checkExitConditions(
          this.currentPosition,
          currentPrice,
          i
        );

        if (exitResult.shouldExit) {
          this.closePosition(exitResult.exitPrice, i, exitResult.reason);
        }
      } else {
        // 没有持仓，检查是否有开仓信号
        try {
          // 构建策略需要的数据
          const historicalKlines = klines.slice(Math.max(0, i - minBars), i + 1);
          
          // 诊断模式：前N次分析时关闭静默模式
          const shouldDiagnose = this.diagnosticMode && this.signalStats.total < this.diagnosticLimit;
          if (shouldDiagnose) {
            this.strategy.quietMode = false;
          }
          
          // 调用策略分析（离线模式）
          const signal = await this.strategy.analyze(
            this.symbol,
            currentPrice,
            historicalKlines,
            true // offlineMode
          );

          // 恢复静默模式
          if (shouldDiagnose) {
            this.strategy.quietMode = true;
          }

          // 统计信号
          this.signalStats.total++;
          if (signal && signal.signal === 'BUY') {
            this.signalStats.buy++;
          } else if (signal && signal.signal === 'SELL') {
            this.signalStats.sell++;
          } else {
            this.signalStats.hold++;
          }
          
          // 统计边沿触发（用于诊断）
          if (signal && signal.scoreB !== undefined && signal.scoreB > 0) {
            this.signalStats.edgeHits++;
            if (this.signalStats.edgeHits <= 10) {
              const timestamp = new Date(currentTime).toISOString().replace('T', ' ').substring(0, 19);
              systemLogger.info(`\n${'='.repeat(80)}`);
              systemLogger.info(`📍 第${this.signalStats.edgeHits}次边沿触发 (K线索引: ${i})`);
              systemLogger.info(`   时间: ${timestamp}`);
              systemLogger.info(`   价格: $${currentPrice.toFixed(2)}`);
              systemLogger.info(`   成交量: ${currentKline[5].toFixed(2)}`);
              systemLogger.info(`   ScoreB: ${signal.scoreB?.toFixed(3)}, ScoreC: ${signal.scoreC?.toFixed(3)}, 最终: ${signal.finalScore?.toFixed(3)}`);
              systemLogger.info(`   信号: ${signal.signal}, 置信度: ${signal.confidence}`);
              systemLogger.info(`   原因: ${signal.reason}`);
              systemLogger.info(`${'='.repeat(80)}\n`);
            }
          }

          // 如果有BUY或SELL信号，应用趋势过滤
          if (signal && (signal.signal === 'BUY' || signal.signal === 'SELL')) {
            // 识别市场状态
            const marketState = TrendFilter.identifyMarketState(historicalKlines);
            const signalDirection = signal.signal === 'BUY' ? 'long' : 'short';
            
            // 判断是否应该执行
            const filterResult = TrendFilter.shouldExecuteSignal(
              marketState,
              signalDirection,
              signal.finalScore
            );

            if (!filterResult.allowed) {
              // 信号被趋势过滤器否决
              if (this.signalStats.edgeHits <= 10) {
                systemLogger.info(`🚫 趋势过滤器否决: ${filterResult.reason}`);
              }
              continue; // 跳过此信号
            }
            
            // 信号通过趋势过滤
            const slippage = this.slippageMode === 'dynamic'
              ? this.calculateDynamicSlippage(currentPrice, atrValues[i])
              : this.fixedSlippage;

            this.openPosition(
              signal.signal,
              currentPrice,
              slippage,
              i,
              signal
            );
            
            // 打印信号详情
            systemLogger.info(`🎯 K线 ${i}: ${signal.signal} 信号 @ $${currentPrice.toFixed(2)}`);
            systemLogger.info(`   信心度: ${signal.confidence}, 最终得分: ${signal.finalScore?.toFixed(3)}`);
          }
        } catch (error) {
          // 策略执行失败，记录但继续
          this.signalStats.errors++;
          if (i % 1000 === 0 || this.signalStats.errors <= 10) {
            systemLogger.warn(`   K线 ${i}: 策略分析失败 - ${error.message}`);
          }
        }
      }

      // 记录权益曲线（采样，减少内存占用）
      if (i % this.equitySampleRate === 0 || this.currentPosition) {
        const equity = this.calculateCurrentEquity(currentPrice);
        this.equityCurve.push({
          index: i,
          timestamp: currentTime,
          equity: equity,
          position: this.currentPosition ? { ...this.currentPosition } : null
        });
      }

      // 定期报告进度
      if (i % 10000 === 0) {
        const progress = ((i - minBars) / (klines.length - minBars) * 100).toFixed(1);
        systemLogger.info(`   进度: ${progress}% (${i}/${klines.length})`);
        systemLogger.info(`   信号统计: BUY=${this.signalStats.buy} SELL=${this.signalStats.sell} HOLD=${this.signalStats.hold} 错误=${this.signalStats.errors}`);
        systemLogger.info(`   边沿触发: ${this.signalStats.edgeHits}次, 转化率: ${this.signalStats.edgeHits > 0 ? ((this.signalStats.buy + this.signalStats.sell) / this.signalStats.edgeHits * 100).toFixed(2) : 0}%`);
        systemLogger.info(`   交易数: ${this.trades.length}, 当前持仓: ${this.currentPosition ? this.currentPosition.side : '无'}`);
      }
    }

    // 如果最后还有持仓，强制平仓
    if (this.currentPosition) {
      const finalPrice = klines[klines.length - 1][4];
      this.closePosition(finalPrice, klines.length - 1, 'backtest_end');
    }

    systemLogger.info('='.repeat(80));
    systemLogger.info(`✅ 回测完成`);
    systemLogger.info(`   总信号数: ${this.signalStats.total}`);
    systemLogger.info(`   - BUY信号: ${this.signalStats.buy} (${(this.signalStats.buy / this.signalStats.total * 100).toFixed(2)}%)`);
    systemLogger.info(`   - SELL信号: ${this.signalStats.sell} (${(this.signalStats.sell / this.signalStats.total * 100).toFixed(2)}%)`);
    systemLogger.info(`   - HOLD信号: ${this.signalStats.hold} (${(this.signalStats.hold / this.signalStats.total * 100).toFixed(2)}%)`);
    systemLogger.info(`   - 错误: ${this.signalStats.errors}`);
    systemLogger.info(`   边沿触发总计: ${this.signalStats.edgeHits}次 (${(this.signalStats.edgeHits / this.signalStats.total * 100).toFixed(2)}%)`);
    systemLogger.info(`   边沿→信号转化率: ${this.signalStats.edgeHits > 0 ? ((this.signalStats.buy + this.signalStats.sell) / this.signalStats.edgeHits * 100).toFixed(2) : 0}%`);
    systemLogger.info(`   执行交易: ${this.trades.length} 笔`);
    systemLogger.info('='.repeat(80));

    // 计算性能指标
    const metrics = this.metricsCalculator.calculateMetrics(
      this.trades,
      this.equityCurve,
      this.initialCapital
    );

    // 蒙特卡洛模拟
    let mcResults = null;
    if (this.trades.length >= 10) {
      mcResults = this.metricsCalculator.monteCarloSimulation(
        this.trades,
        this.initialCapital,
        1000
      );
    }

    // 生成报告
    const report = this.metricsCalculator.generateReport(metrics, mcResults);
    console.log('\n' + report);

    return {
      metrics,
      mcResults,
      trades: this.trades,
      equityCurve: this.equityCurve,
      config: this.getConfig()
    };
  }

  /**
   * 开仓
   */
  openPosition(signal, price, slippage, index, signalData) {
    const side = signal === 'BUY' ? 'long' : 'short';
    
    // 计算实际成交价（考虑滑点）
    const entryPrice = side === 'long'
      ? price * (1 + slippage)
      : price * (1 - slippage);

    // 计算持仓数量（基于positionUsd和杠杆）
    const quantity = this.positionUsd / entryPrice;

    // 计算手续费
    const fee = this.positionUsd * this.feeRate;

    // 计算止损止盈价格
    const stopLoss = side === 'long'
      ? entryPrice * (1 - this.stopLossPct)
      : entryPrice * (1 + this.stopLossPct);

    const takeProfit = side === 'long'
      ? entryPrice * (1 + this.takeProfitPct)
      : entryPrice * (1 - this.takeProfitPct);

    this.currentPosition = {
      side,
      entry_index: index,
      entry_price: entryPrice,
      quantity,
      stop_loss: stopLoss,
      take_profit: takeProfit,
      entry_fee: fee,
      signal: signalData
    };

    // 扣除手续费
    this.currentCapital -= fee;

    systemLogger.info(`📈 开仓: ${side.toUpperCase()} @ $${entryPrice.toFixed(2)} (索引 ${index})`);
  }

  /**
   * 平仓
   */
  closePosition(exitPrice, index, reason) {
    if (!this.currentPosition) {
      return;
    }

    const pos = this.currentPosition;
    
    // 计算手续费
    const exitFee = this.positionUsd * this.feeRate;
    
    // 计算原始收益（不含杠杆）
    const priceChange = pos.side === 'long'
      ? exitPrice - pos.entry_price
      : pos.entry_price - exitPrice;
    
    const grossReturn = priceChange * pos.quantity;
    
    // 应用杠杆
    const leveragedReturn = grossReturn * this.leverage;
    
    // 扣除手续费
    const netReturn = leveragedReturn - pos.entry_fee - exitFee;
    
    // 更新资金
    this.currentCapital += netReturn;

    // 记录交易
    const trade = {
      side: pos.side,
      entry_index: pos.entry_index,
      exit_index: index,
      entry_price: pos.entry_price,
      exit_price: exitPrice,
      stop_loss_price: pos.stop_loss,
      take_profit_price: pos.take_profit,
      quantity: pos.quantity,
      exit_reason: reason,
      gross_return: grossReturn,
      leveraged_return: leveragedReturn,
      net_return: netReturn,
      entry_fee: pos.entry_fee,
      exit_fee: exitFee,
      total_fees: pos.entry_fee + exitFee,
      signal: pos.signal
    };

    this.trades.push(trade);

    const pnlSign = netReturn > 0 ? '✅' : '❌';
    systemLogger.info(`${pnlSign} 平仓: ${pos.side.toUpperCase()} @ $${exitPrice.toFixed(2)} | 盈亏: $${netReturn.toFixed(2)} | 原因: ${reason}`);

    // 清除持仓
    this.currentPosition = null;
  }

  /**
   * 检查退出条件（止损止盈）
   */
  checkExitConditions(position, currentPrice, index) {
    let shouldExit = false;
    let exitPrice = currentPrice;
    let reason = '';

    // 检查止损
    if (position.side === 'long' && currentPrice <= position.stop_loss) {
      shouldExit = true;
      exitPrice = position.stop_loss;
      reason = 'stop_loss';
    } else if (position.side === 'short' && currentPrice >= position.stop_loss) {
      shouldExit = true;
      exitPrice = position.stop_loss;
      reason = 'stop_loss';
    }

    // 检查止盈
    if (position.side === 'long' && currentPrice >= position.take_profit) {
      shouldExit = true;
      exitPrice = position.take_profit;
      reason = 'take_profit';
    } else if (position.side === 'short' && currentPrice <= position.take_profit) {
      shouldExit = true;
      exitPrice = position.take_profit;
      reason = 'take_profit';
    }

    return { shouldExit, exitPrice, reason };
  }

  /**
   * 计算当前权益
   */
  calculateCurrentEquity(currentPrice) {
    let equity = this.currentCapital;

    if (this.currentPosition) {
      const pos = this.currentPosition;
      const priceChange = pos.side === 'long'
        ? currentPrice - pos.entry_price
        : pos.entry_price - currentPrice;
      
      const unrealizedPnl = priceChange * pos.quantity * this.leverage;
      equity += unrealizedPnl;
    }

    return equity;
  }

  /**
   * 计算ATR（用于动态滑点）
   */
  calculateATR(klines, period) {
    const atrValues = [];
    const trueRanges = [];

    for (let i = 0; i < klines.length; i++) {
      const [, , high, low, close] = klines[i];
      
      if (i === 0) {
        trueRanges.push(high - low);
      } else {
        const prevClose = klines[i - 1][4];
        const tr = Math.max(
          high - low,
          Math.abs(high - prevClose),
          Math.abs(low - prevClose)
        );
        trueRanges.push(tr);
      }

      if (i >= period - 1) {
        const atr = trueRanges.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
        atrValues.push(atr);
      } else {
        atrValues.push(null);
      }
    }

    return atrValues;
  }

  /**
   * 计算动态滑点
   */
  calculateDynamicSlippage(price, atr) {
    if (!atr) {
      return this.fixedSlippage;
    }
    return (atr * this.atrFactor) / price;
  }

  /**
   * 保存交易记录到CSV
   */
  saveTradesCSV(trades, segment = 'default') {
    const filename = `${this.symbol.replace('/', '_')}_${segment}_trades.csv`;
    const filepath = path.join(this.outputDir, filename);

    const headers = 'side,entry_index,exit_index,entry_price,exit_price,stop_loss_price,take_profit_price,exit_reason,gross_return,leveraged_return,net_return\n';
    
    const rows = trades.map(t => {
      return [
        t.side,
        t.entry_index,
        t.exit_index,
        t.entry_price.toFixed(6),
        t.exit_price.toFixed(6),
        t.stop_loss_price.toFixed(6),
        t.take_profit_price.toFixed(6),
        t.exit_reason,
        t.gross_return.toFixed(6),
        t.leveraged_return.toFixed(6),
        t.net_return.toFixed(6)
      ].join(',');
    }).join('\n');

    fs.writeFileSync(filepath, headers + rows, 'utf-8');
    systemLogger.info(`💾 交易记录已保存: ${filename}`);
    
    return filepath;
  }

  /**
   * 保存回测报告到JSON
   */
  saveReportJSON(result, segment = 'default') {
    const filename = `${this.symbol.replace('/', '_')}_${segment}_report.json`;
    const filepath = path.join(this.outputDir, filename);

    // 移除trades数组（太大了），只保留统计信息
    const reportData = {
      config: result.config,
      metrics: { ...result.metrics, trades: undefined, equity_curve: undefined },
      mcResults: result.mcResults,
      tradeCount: result.trades.length,
      timestamp: new Date().toISOString()
    };

    fs.writeFileSync(filepath, JSON.stringify(reportData, null, 2), 'utf-8');
    systemLogger.info(`💾 回测报告已保存: ${filename}`);
    
    return filepath;
  }

  /**
   * 获取配置信息
   */
  getConfig() {
    return {
      symbol: this.symbol,
      timeframe: this.timeframe,
      initialCapital: this.initialCapital,
      positionUsd: this.positionUsd,
      leverage: this.leverage,
      feeRate: this.feeRate,
      stopLossPct: this.stopLossPct,
      takeProfitPct: this.takeProfitPct,
      slippageMode: this.slippageMode,
      fixedSlippage: this.fixedSlippage,
      atrPeriod: this.atrPeriod,
      atrFactor: this.atrFactor
    };
  }

  /**
   * 分市场状态回测
   * @param {Array} klines - 完整K线数据
   * @param {Array} segments - 市场状态分段
   * @returns {Promise<Object>} 各市场状态的回测结果
   */
  async runSegmentedBacktest(klines, segments) {
    systemLogger.info('\n' + '='.repeat(80));
    systemLogger.info('分市场状态回测');
    systemLogger.info('='.repeat(80));

    const results = {};

    for (const segment of segments) {
      systemLogger.info(`\n📊 回测市场状态: ${segment.name}`);
      systemLogger.info(`   时间范围: ${segment.start} -> ${segment.end}`);

      // 过滤K线数据
      const startTime = new Date(segment.start).getTime();
      const endTime = new Date(segment.end).getTime();
      const segmentKlines = klines.filter(k => k[0] >= startTime && k[0] <= endTime);

      systemLogger.info(`   K线数量: ${segmentKlines.length}`);

      if (segmentKlines.length < 720) {
        systemLogger.warn(`   ⚠️ K线数量不足，跳过此分段`);
        continue;
      }

      // 运行回测
      const result = await this.runBacktest(segmentKlines);
      results[segment.name] = result;

      // 保存结果
      this.saveTradesCSV(result.trades, segment.name);
      this.saveReportJSON(result, segment.name);
    }

    return results;
  }

  /**
   * 参数敏感性测试
   * @param {Array} klines - K线数据
   * @param {Object} paramGrid - 参数网格
   * @returns {Promise<Array>} 参数测试结果
   */
  async runParameterSensitivity(klines, paramGrid) {
    systemLogger.info('\n' + '='.repeat(80));
    systemLogger.info('参数敏感性测试');
    systemLogger.info('='.repeat(80));

    const results = [];
    const paramCombinations = this.generateParameterCombinations(paramGrid);

    systemLogger.info(`📊 总共 ${paramCombinations.length} 组参数组合`);

    for (let i = 0; i < paramCombinations.length; i++) {
      const params = paramCombinations[i];
      systemLogger.info(`\n🔧 测试参数组 ${i + 1}/${paramCombinations.length}`);
      Object.entries(params).forEach(([key, value]) => {
        systemLogger.info(`   ${key}: ${value}`);
      });

      // 应用参数到策略
      this.applyStrategyParameters(params);

      // 运行回测
      const result = await this.runBacktest(klines);
      
      results.push({
        parameters: params,
        metrics: {
          total_return_pct: result.metrics.total_return_pct,
          sharpe_ratio: result.metrics.sharpe_ratio,
          max_drawdown_pct: result.metrics.max_drawdown_pct,
          win_rate: result.metrics.win_rate,
          profit_factor: result.metrics.profit_factor,
          total_trades: result.metrics.total_trades
        }
      });
    }

    // 保存参数测试结果
    this.saveParameterTestResults(results);

    return results;
  }

  /**
   * 生成参数组合
   * @private
   */
  generateParameterCombinations(paramGrid) {
    const keys = Object.keys(paramGrid);
    const combinations = [{}];

    for (const key of keys) {
      const values = paramGrid[key];
      const newCombinations = [];

      for (const combination of combinations) {
        for (const value of values) {
          newCombinations.push({
            ...combination,
            [key]: value
          });
        }
      }

      combinations.length = 0;
      combinations.push(...newCombinations);
    }

    return combinations;
  }

  /**
   * 应用策略参数
   * @private
   */
  applyStrategyParameters(params) {
    // 应用到模块B参数
    if (params.zLocal !== undefined) {
      this.strategy.params.P2_LOCAL_Z_THRESHOLD = params.zLocal;
    }
    if (params.zGlobal !== undefined) {
      this.strategy.params.P3_GLOBAL_Z_THRESHOLD = params.zGlobal;
    }
    if (params.growthRatio !== undefined) {
      this.strategy.params.P4_VOLUME_RATIO = params.growthRatio;
    }

    // 应用到模块C参数
    if (params.delta !== undefined) {
      this.strategy.moduleC.DELTA_THRESHOLD_LONG = params.delta;
      this.strategy.moduleC.DELTA_THRESHOLD_SHORT = -params.delta;
    }
  }

  /**
   * 保存参数测试结果
   * @private
   */
  saveParameterTestResults(results) {
    const filename = `${this.symbol.replace('/', '_')}_parameter_sensitivity.json`;
    const filepath = path.join(this.outputDir, filename);

    fs.writeFileSync(filepath, JSON.stringify(results, null, 2), 'utf-8');
    systemLogger.info(`💾 参数测试结果已保存: ${filename}`);
  }
}

module.exports = BacktestEngine;


