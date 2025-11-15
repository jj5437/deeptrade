const { systemLogger } = require('../controllers/logger/Logger');

/**
 * 性能指标计算器
 * 计算回测的各种性能指标
 */
class PerformanceMetrics {
  constructor() {
    this.TRADING_DAYS_PER_YEAR = 365;
    this.RISK_FREE_RATE = 0.02; // 无风险利率 2%
  }

  /**
   * 计算完整的性能指标
   * @param {Array} trades - 交易记录
   * @param {Array} equityCurve - 权益曲线
   * @param {number} initialCapital - 初始资金
   * @returns {Object} 性能指标
   */
  calculateMetrics(trades, equityCurve, initialCapital) {
    systemLogger.info('📊 开始计算性能指标...');

    if (!trades || trades.length === 0) {
      systemLogger.warn('⚠️ 无交易记录，返回空指标');
      return this.getEmptyMetrics();
    }

    const metrics = {
      // 基础统计
      total_trades: trades.length,
      winning_trades: 0,
      losing_trades: 0,
      
      // 收益指标
      total_return: 0,
      total_return_pct: 0,
      annualized_return: 0,
      
      // 风险指标
      max_drawdown: 0,
      max_drawdown_pct: 0,
      max_drawdown_duration: 0,
      
      // 比率指标
      sharpe_ratio: 0,
      sortino_ratio: 0,
      calmar_ratio: 0,
      profit_factor: 0,
      
      // 交易统计
      win_rate: 0,
      avg_win: 0,
      avg_loss: 0,
      avg_trade: 0,
      largest_win: 0,
      largest_loss: 0,
      
      // 连续性指标
      max_consecutive_wins: 0,
      max_consecutive_losses: 0,
      current_streak: 0,
      
      // 其他指标
      expectancy: 0,
      kelly_criterion: 0,
      
      // 详细数据
      trades: trades,
      equity_curve: equityCurve
    };

    // 1. 基础统计
    trades.forEach(trade => {
      if (trade.net_return > 0) {
        metrics.winning_trades++;
      } else if (trade.net_return < 0) {
        metrics.losing_trades++;
      }
    });

    // 2. 收益指标
    const finalEquity = equityCurve[equityCurve.length - 1].equity;
    metrics.total_return = finalEquity - initialCapital;
    metrics.total_return_pct = (metrics.total_return / initialCapital) * 100;

    // 计算交易天数
    const startTime = equityCurve[0].timestamp;
    const endTime = equityCurve[equityCurve.length - 1].timestamp;
    const tradingDays = (endTime - startTime) / (1000 * 60 * 60 * 24);
    const tradingYears = tradingDays / this.TRADING_DAYS_PER_YEAR;

    metrics.annualized_return = tradingYears > 0 
      ? (Math.pow(finalEquity / initialCapital, 1 / tradingYears) - 1) * 100
      : 0;

    // 3. 风险指标 - 最大回撤
    const ddResult = this.calculateMaxDrawdown(equityCurve);
    metrics.max_drawdown = ddResult.maxDrawdown;
    metrics.max_drawdown_pct = ddResult.maxDrawdownPct;
    metrics.max_drawdown_duration = ddResult.maxDuration;

    // 4. 夏普比率和索提诺比率
    const returns = trades.map(t => t.net_return / initialCapital);
    const ratios = this.calculateRiskAdjustedReturns(returns, tradingYears);
    metrics.sharpe_ratio = ratios.sharpe;
    metrics.sortino_ratio = ratios.sortino;

    // 5. 卡尔玛比率 (Calmar Ratio)
    metrics.calmar_ratio = metrics.max_drawdown_pct !== 0
      ? metrics.annualized_return / Math.abs(metrics.max_drawdown_pct)
      : 0;

    // 6. 利润因子 (Profit Factor)
    const grossProfit = trades
      .filter(t => t.net_return > 0)
      .reduce((sum, t) => sum + t.net_return, 0);
    const grossLoss = Math.abs(trades
      .filter(t => t.net_return < 0)
      .reduce((sum, t) => sum + t.net_return, 0));
    
    metrics.profit_factor = grossLoss > 0 ? grossProfit / grossLoss : 0;

    // 7. 交易统计
    metrics.win_rate = (metrics.winning_trades / metrics.total_trades) * 100;
    
    const winTrades = trades.filter(t => t.net_return > 0);
    const lossTrades = trades.filter(t => t.net_return < 0);
    
    metrics.avg_win = winTrades.length > 0
      ? winTrades.reduce((sum, t) => sum + t.net_return, 0) / winTrades.length
      : 0;
    
    metrics.avg_loss = lossTrades.length > 0
      ? lossTrades.reduce((sum, t) => sum + t.net_return, 0) / lossTrades.length
      : 0;
    
    metrics.avg_trade = trades.reduce((sum, t) => sum + t.net_return, 0) / trades.length;
    
    metrics.largest_win = winTrades.length > 0
      ? Math.max(...winTrades.map(t => t.net_return))
      : 0;
    
    metrics.largest_loss = lossTrades.length > 0
      ? Math.min(...lossTrades.map(t => t.net_return))
      : 0;

    // 8. 连续性指标
    const streaks = this.calculateStreaks(trades);
    metrics.max_consecutive_wins = streaks.maxWins;
    metrics.max_consecutive_losses = streaks.maxLosses;
    metrics.current_streak = streaks.current;

    // 9. 期望值 (Expectancy)
    metrics.expectancy = (metrics.win_rate / 100) * metrics.avg_win 
      + ((100 - metrics.win_rate) / 100) * metrics.avg_loss;

    // 10. 凯利准则 (Kelly Criterion)
    if (metrics.avg_loss !== 0) {
      const winProb = metrics.win_rate / 100;
      const winLossRatio = Math.abs(metrics.avg_win / metrics.avg_loss);
      metrics.kelly_criterion = winProb - ((1 - winProb) / winLossRatio);
    }

    systemLogger.info('✅ 性能指标计算完成');
    return metrics;
  }

  /**
   * 计算最大回撤
   * @param {Array} equityCurve - 权益曲线
   * @returns {Object} 最大回撤信息
   */
  calculateMaxDrawdown(equityCurve) {
    let maxEquity = equityCurve[0].equity;
    let maxDrawdown = 0;
    let maxDrawdownPct = 0;
    let drawdownStart = 0;
    let drawdownEnd = 0;
    let currentDrawdownStart = 0;

    for (let i = 0; i < equityCurve.length; i++) {
      const equity = equityCurve[i].equity;
      
      if (equity > maxEquity) {
        maxEquity = equity;
        currentDrawdownStart = i;
      }

      const drawdown = maxEquity - equity;
      const drawdownPct = (drawdown / maxEquity) * 100;

      if (drawdownPct > maxDrawdownPct) {
        maxDrawdown = drawdown;
        maxDrawdownPct = drawdownPct;
        drawdownStart = currentDrawdownStart;
        drawdownEnd = i;
      }
    }

    // 计算回撤持续时间（以K线数量计）
    const duration = drawdownEnd - drawdownStart;

    return {
      maxDrawdown,
      maxDrawdownPct,
      maxDuration: duration,
      startIndex: drawdownStart,
      endIndex: drawdownEnd
    };
  }

  /**
   * 计算风险调整后收益（夏普比率、索提诺比率）
   * @param {Array} returns - 收益率序列
   * @param {number} tradingYears - 交易年数
   * @returns {Object} 比率
   */
  calculateRiskAdjustedReturns(returns, tradingYears = 1) {
    if (!returns || returns.length === 0) {
      return { sharpe: 0, sortino: 0 };
    }

    // 计算平均收益率
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    
    // 计算标准差
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    // 年化调整
    const periodsPerYear = returns.length / tradingYears;
    const annualizedReturn = avgReturn * periodsPerYear;
    const annualizedStdDev = stdDev * Math.sqrt(periodsPerYear);

    // 夏普比率
    const sharpe = annualizedStdDev > 0
      ? (annualizedReturn - this.RISK_FREE_RATE) / annualizedStdDev
      : 0;

    // 索提诺比率（只考虑下行波动）
    const downsideVariance = returns
      .filter(r => r < avgReturn)
      .reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const downsideStdDev = Math.sqrt(downsideVariance);
    const annualizedDownsideStdDev = downsideStdDev * Math.sqrt(periodsPerYear);

    const sortino = annualizedDownsideStdDev > 0
      ? (annualizedReturn - this.RISK_FREE_RATE) / annualizedDownsideStdDev
      : 0;

    return { sharpe, sortino };
  }

  /**
   * 计算连续盈亏
   * @param {Array} trades - 交易记录
   * @returns {Object} 连续性指标
   */
  calculateStreaks(trades) {
    let maxWins = 0;
    let maxLosses = 0;
    let currentWins = 0;
    let currentLosses = 0;
    let current = 0;

    trades.forEach(trade => {
      if (trade.net_return > 0) {
        currentWins++;
        currentLosses = 0;
        current = currentWins;
        maxWins = Math.max(maxWins, currentWins);
      } else if (trade.net_return < 0) {
        currentLosses++;
        currentWins = 0;
        current = -currentLosses;
        maxLosses = Math.max(maxLosses, currentLosses);
      }
    });

    return { maxWins, maxLosses, current };
  }

  /**
   * 蒙特卡洛模拟
   * @param {Array} trades - 交易记录
   * @param {number} initialCapital - 初始资金
   * @param {number} simulations - 模拟次数
   * @returns {Object} 模拟结果
   */
  monteCarloSimulation(trades, initialCapital, simulations = 1000) {
    systemLogger.info(`🎲 开始蒙特卡洛模拟 (${simulations}次)...`);

    if (!trades || trades.length < 10) {
      systemLogger.warn('⚠️ 交易数量不足，跳过蒙特卡洛模拟');
      return null;
    }

    const returns = trades.map(t => t.net_return);
    const results = [];

    for (let i = 0; i < simulations; i++) {
      // 随机打乱交易顺序
      const shuffledReturns = this.shuffleArray([...returns]);
      
      // 计算该序列的权益曲线和最大回撤
      let equity = initialCapital;
      let maxEquity = initialCapital;
      let maxDrawdownPct = 0;
      const equityCurve = [equity];

      shuffledReturns.forEach(ret => {
        equity += ret;
        equityCurve.push(equity);
        
        if (equity > maxEquity) {
          maxEquity = equity;
        }

        const drawdownPct = ((maxEquity - equity) / maxEquity) * 100;
        maxDrawdownPct = Math.max(maxDrawdownPct, drawdownPct);
      });

      const finalReturn = ((equity - initialCapital) / initialCapital) * 100;

      results.push({
        finalEquity: equity,
        finalReturn,
        maxDrawdownPct,
        equityCurve
      });
    }

    // 计算统计信息
    const finalReturns = results.map(r => r.finalReturn).sort((a, b) => a - b);
    const drawdowns = results.map(r => r.maxDrawdownPct).sort((a, b) => a - b);

    const percentile = (arr, p) => arr[Math.floor(arr.length * p)];

    const mcResults = {
      simulations,
      finalReturn: {
        min: finalReturns[0],
        max: finalReturns[finalReturns.length - 1],
        mean: finalReturns.reduce((a, b) => a + b, 0) / finalReturns.length,
        median: percentile(finalReturns, 0.5),
        p10: percentile(finalReturns, 0.1),
        p25: percentile(finalReturns, 0.25),
        p75: percentile(finalReturns, 0.75),
        p90: percentile(finalReturns, 0.9)
      },
      maxDrawdown: {
        min: drawdowns[0],
        max: drawdowns[drawdowns.length - 1],
        mean: drawdowns.reduce((a, b) => a + b, 0) / drawdowns.length,
        median: percentile(drawdowns, 0.5),
        p50: percentile(drawdowns, 0.5),
        p90: percentile(drawdowns, 0.9),
        p95: percentile(drawdowns, 0.95)
      },
      probabilityOfProfit: (finalReturns.filter(r => r > 0).length / simulations) * 100
    };

    systemLogger.info(`✅ 蒙特卡洛模拟完成`);
    systemLogger.info(`   盈利概率: ${mcResults.probabilityOfProfit.toFixed(2)}%`);
    systemLogger.info(`   最大回撤中位数: ${mcResults.maxDrawdown.median.toFixed(2)}%`);
    systemLogger.info(`   最大回撤P95: ${mcResults.maxDrawdown.p95.toFixed(2)}%`);

    return mcResults;
  }

  /**
   * 随机打乱数组
   * @private
   */
  shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  /**
   * 生成性能报告
   * @param {Object} metrics - 性能指标
   * @param {Object} mcResults - 蒙特卡洛结果（可选）
   * @returns {string} 报告文本
   */
  generateReport(metrics, mcResults = null, diagnostics = null) {
    const lines = [];
    
    lines.push('='.repeat(80));
    lines.push('回测性能报告');
    lines.push('='.repeat(80));
    lines.push('');

    // 基础统计
    lines.push('【基础统计】');
    lines.push(`总交易次数: ${metrics.total_trades}`);
    lines.push(`盈利交易: ${metrics.winning_trades} (${metrics.win_rate.toFixed(2)}%)`);
    lines.push(`亏损交易: ${metrics.losing_trades} (${(100 - metrics.win_rate).toFixed(2)}%)`);
    lines.push('');

    // 收益指标
    lines.push('【收益指标】');
    lines.push(`总收益: $${metrics.total_return.toFixed(2)} (${metrics.total_return_pct.toFixed(2)}%)`);
    lines.push(`年化收益率: ${metrics.annualized_return.toFixed(2)}%`);
    lines.push(`平均每笔交易: $${metrics.avg_trade.toFixed(2)}`);
    lines.push(`期望值: $${metrics.expectancy.toFixed(2)}`);
    lines.push('');

    // 风险指标
    lines.push('【风险指标】');
    lines.push(`最大回撤: $${metrics.max_drawdown.toFixed(2)} (${metrics.max_drawdown_pct.toFixed(2)}%)`);
    lines.push(`最大回撤持续: ${metrics.max_drawdown_duration} 个K线周期`);
    lines.push(`夏普比率: ${metrics.sharpe_ratio.toFixed(3)}`);
    lines.push(`索提诺比率: ${metrics.sortino_ratio.toFixed(3)}`);
    lines.push(`卡尔玛比率: ${metrics.calmar_ratio.toFixed(3)}`);
    lines.push('');

    // 交易质量
    lines.push('【交易质量】');
    lines.push(`利润因子: ${metrics.profit_factor.toFixed(3)}`);
    lines.push(`平均盈利: $${metrics.avg_win.toFixed(2)}`);
    lines.push(`平均亏损: $${metrics.avg_loss.toFixed(2)}`);
    lines.push(`最大盈利: $${metrics.largest_win.toFixed(2)}`);
    lines.push(`最大亏损: $${metrics.largest_loss.toFixed(2)}`);
    lines.push(`盈亏比: ${metrics.avg_loss !== 0 ? Math.abs(metrics.avg_win / metrics.avg_loss).toFixed(2) : 'N/A'}`);
    lines.push('');

    // 连续性
    lines.push('【连续性指标】');
    lines.push(`最大连续盈利: ${metrics.max_consecutive_wins} 次`);
    lines.push(`最大连续亏损: ${metrics.max_consecutive_losses} 次`);
    lines.push(`当前连续: ${metrics.current_streak > 0 ? '+' : ''}${metrics.current_streak} 次`);
    lines.push('');

    // 资金管理
    lines.push('【资金管理建议】');
    lines.push(`凯利准则: ${(metrics.kelly_criterion * 100).toFixed(2)}% (建议仓位)`);
    lines.push(`保守仓位: ${(metrics.kelly_criterion * 50).toFixed(2)}% (凯利的50%)`);
    lines.push('');

    // 蒙特卡洛结果
    if (mcResults) {
      lines.push('【蒙特卡洛模拟】');
      lines.push(`模拟次数: ${mcResults.simulations}`);
      lines.push(`盈利概率: ${mcResults.probabilityOfProfit.toFixed(2)}%`);
      lines.push('');
      lines.push('收益分布:');
      lines.push(`  P10: ${mcResults.finalReturn.p10.toFixed(2)}%`);
      lines.push(`  P25: ${mcResults.finalReturn.p25.toFixed(2)}%`);
      lines.push(`  中位数: ${mcResults.finalReturn.median.toFixed(2)}%`);
      lines.push(`  P75: ${mcResults.finalReturn.p75.toFixed(2)}%`);
      lines.push(`  P90: ${mcResults.finalReturn.p90.toFixed(2)}%`);
      lines.push('');
      lines.push('最大回撤分布:');
      lines.push(`  P50: ${mcResults.maxDrawdown.p50.toFixed(2)}%`);
      lines.push(`  P90: ${mcResults.maxDrawdown.p90.toFixed(2)}%`);
      lines.push(`  P95: ${mcResults.maxDrawdown.p95.toFixed(2)}%`);
      lines.push('');
    }

    if (diagnostics) {
      const t = diagnostics.total || 0;
      const c = diagnostics.converted || 0;
      const fTotal = Math.max(t - c, 0);
      const fr = diagnostics.failureReasons || {};
      const mp = diagnostics.modulePass || {};
      const mt = diagnostics.moduleTotal || 0;
      lines.push('【模块B诊断】');
      lines.push(`边沿触发: ${t} 次`);
      lines.push(`转化为信号: ${t > 0 ? ((c / t) * 100).toFixed(2) : '0.00'}% (${c}/${t})`);
      lines.push('失败原因占比:');
      lines.push(`  P4未满足: ${fTotal > 0 ? ((fr.p4_failed || 0) / fTotal * 100).toFixed(2) : '0.00'}%`);
      lines.push(`  P8低流动性: ${fTotal > 0 ? ((fr.p8_low_liquidity || 0) / fTotal * 100).toFixed(2) : '0.00'}%`);
      lines.push(`  Score_B不足: ${fTotal > 0 ? ((fr.score_b_low || 0) / fTotal * 100).toFixed(2) : '0.00'}%`);
      lines.push(`  其他: ${fTotal > 0 ? ((fr.other || 0) / fTotal * 100).toFixed(2) : '0.00'}%`);
      lines.push('');
      lines.push('模块条件通过率:');
      const rate = k => mt > 0 ? (((mp[k] || 0) / mt) * 100).toFixed(2) : '0.00';
      lines.push(`  P1: ${rate('P1')}%`);
      lines.push(`  P2: ${rate('P2')}%`);
      lines.push(`  P3: ${rate('P3')}%`);
      lines.push(`  P4: ${rate('P4')}%`);
      lines.push(`  P5: ${rate('P5')}%`);
      lines.push(`  P6: ${rate('P6')}%`);
      lines.push(`  P7: ${rate('P7')}%`);
      lines.push(`  P8: ${rate('P8')}%`);
      lines.push('');
    }

    if (diagnostics) {
      const t = diagnostics.total || 0;
      const c = diagnostics.converted || 0;
      const fTotal = Math.max(t - c, 0);
      const fr = diagnostics.failureReasons || {};
      const mp = diagnostics.modulePass || {};
      const mt = diagnostics.moduleTotal || 0;
      lines.push('【模块B诊断】');
      lines.push(`边沿触发: ${t} 次`);
      lines.push(`转化为信号: ${t > 0 ? ((c / t) * 100).toFixed(2) : '0.00'}% (${c}/${t})`);
      lines.push('失败原因占比:');
      lines.push(`  P4未满足: ${fTotal > 0 ? ((fr.p4_failed || 0) / fTotal * 100).toFixed(2) : '0.00'}%`);
      lines.push(`  P8低流动性: ${fTotal > 0 ? ((fr.p8_low_liquidity || 0) / fTotal * 100).toFixed(2) : '0.00'}%`);
      lines.push(`  Score_B不足: ${fTotal > 0 ? ((fr.score_b_low || 0) / fTotal * 100).toFixed(2) : '0.00'}%`);
      lines.push(`  其他: ${fTotal > 0 ? ((fr.other || 0) / fTotal * 100).toFixed(2) : '0.00'}%`);
      lines.push('');
      lines.push('模块条件通过率:');
      const rate = k => mt > 0 ? (((mp[k] || 0) / mt) * 100).toFixed(2) : '0.00';
      lines.push(`  P1: ${rate('P1')}%`);
      lines.push(`  P2: ${rate('P2')}%`);
      lines.push(`  P3: ${rate('P3')}%`);
      lines.push(`  P4: ${rate('P4')}%`);
      lines.push(`  P5: ${rate('P5')}%`);
      lines.push(`  P6: ${rate('P6')}%`);
      lines.push(`  P7: ${rate('P7')}%`);
      lines.push(`  P8: ${rate('P8')}%`);
      lines.push('');
    }

    if (diagnostics) {
      const t = diagnostics.total || 0;
      const c = diagnostics.converted || 0;
      const fTotal = Math.max(t - c, 0);
      const fr = diagnostics.failureReasons || {};
      const mp = diagnostics.modulePass || {};
      const mt = diagnostics.moduleTotal || 0;
      lines.push('【模块B诊断】');
      lines.push(`边沿触发: ${t} 次`);
      lines.push(`转化为信号: ${t > 0 ? ((c / t) * 100).toFixed(2) : '0.00'}% (${c}/${t})`);
      lines.push('失败原因占比:');
      lines.push(`  P4未满足: ${fTotal > 0 ? ((fr.p4_failed || 0) / fTotal * 100).toFixed(2) : '0.00'}%`);
      lines.push(`  P8低流动性: ${fTotal > 0 ? ((fr.p8_low_liquidity || 0) / fTotal * 100).toFixed(2) : '0.00'}%`);
      lines.push(`  Score_B不足: ${fTotal > 0 ? ((fr.score_b_low || 0) / fTotal * 100).toFixed(2) : '0.00'}%`);
      lines.push(`  其他: ${fTotal > 0 ? ((fr.other || 0) / fTotal * 100).toFixed(2) : '0.00'}%`);
      lines.push('');
      lines.push('模块条件通过率:');
      const rate = k => mt > 0 ? (((mp[k] || 0) / mt) * 100).toFixed(2) : '0.00';
      lines.push(`  P1: ${rate('P1')}%`);
      lines.push(`  P2: ${rate('P2')}%`);
      lines.push(`  P3: ${rate('P3')}%`);
      lines.push(`  P4: ${rate('P4')}%`);
      lines.push(`  P5: ${rate('P5')}%`);
      lines.push(`  P6: ${rate('P6')}%`);
      lines.push(`  P7: ${rate('P7')}%`);
      lines.push(`  P8: ${rate('P8')}%`);
      lines.push('');
    }

    lines.push('='.repeat(80));

    return lines.join('\n');
  }

  /**
   * 获取空指标
   * @private
   */
  getEmptyMetrics() {
    return {
      total_trades: 0,
      winning_trades: 0,
      losing_trades: 0,
      total_return: 0,
      total_return_pct: 0,
      annualized_return: 0,
      max_drawdown: 0,
      max_drawdown_pct: 0,
      max_drawdown_duration: 0,
      sharpe_ratio: 0,
      sortino_ratio: 0,
      calmar_ratio: 0,
      profit_factor: 0,
      win_rate: 0,
      avg_win: 0,
      avg_loss: 0,
      avg_trade: 0,
      largest_win: 0,
      largest_loss: 0,
      max_consecutive_wins: 0,
      max_consecutive_losses: 0,
      current_streak: 0,
      expectancy: 0,
      kelly_criterion: 0,
      trades: [],
      equity_curve: []
    };
  }
}

module.exports = PerformanceMetrics;

