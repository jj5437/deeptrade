const { systemLogger } = require('../logger/Logger');

/**
 * 风险管理模块
 */
class RiskManagement {
  /**
   * 计算夏普比率
   */
  calculateSharpeRatio(returns, riskFreeRate = 0.02) {
    try {
      if (!returns || returns.length === 0) {
        return { sharpe: 0, sortino: 0, calmar: 0 };
      }

      // 计算平均收益率
      const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;

      // 计算收益率标准差
      const variance = returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length;
      const stdDev = Math.sqrt(variance);

      // 计算下行标准差（仅考虑负收益）
      const negativeReturns = returns.filter(r => r < 0);
      const downsideVariance = negativeReturns.length > 0
        ? negativeReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / negativeReturns.length
        : 0;
      const downsideDeviation = Math.sqrt(downsideVariance);

      // 计算最大回撤
      const maxDrawdown = this.calculateMaxDrawdown(returns);

      // 夏普比率
      const sharpe = stdDev === 0 ? 0 : (meanReturn - riskFreeRate) / stdDev;

      // 索提诺比率
      const sortino = downsideDeviation === 0 ? 0 : (meanReturn - riskFreeRate) / downsideDeviation;

      // 卡玛比率
      const calmar = maxDrawdown === 0 ? 0 : meanReturn / maxDrawdown;

      return {
        sharpe: parseFloat(sharpe.toFixed(4)),
        sortino: parseFloat(sortino.toFixed(4)),
        calmar: parseFloat(calmar.toFixed(4)),
        maxDrawdown: parseFloat(maxDrawdown.toFixed(4))
      };
    } catch (error) {
      systemLogger.error(`计算夏普比率失败: ${error.message}`);
      return { sharpe: 0, sortino: 0, calmar: 0, maxDrawdown: 0 };
    }
  }

  /**
   * 计算最大回撤
   */
  calculateMaxDrawdown(returns) {
    try {
      let peak = 0;
      let maxDrawdown = 0;
      let cumulativeReturn = 0;

      for (const ret of returns) {
        cumulativeReturn += ret;
        peak = Math.max(peak, cumulativeReturn);
        const drawdown = (peak - cumulativeReturn) / peak;
        maxDrawdown = Math.max(maxDrawdown, drawdown);
      }

      return maxDrawdown;
    } catch (error) {
      systemLogger.error(`计算最大回撤失败: ${error.message}`);
      return 0;
    }
  }

  /**
   * 更新组合收益率
   */
  updatePortfolioReturns(symbol, returns, newReturn) {
    if (!returns[symbol]) {
      returns[symbol] = [];
    }

    returns[symbol].push(newReturn);

    // 保留最近200条记录
    if (returns[symbol].length > 200) {
      returns[symbol].shift();
    }

    return returns[symbol];
  }

  /**
   * 生成性能洞察
   */
  generatePerformanceInsights(symbol, performance, portfolioReturns) {
    try {
      const insights = {
        symbol,
        winRate: performance.totalTrades > 0
          ? (performance.winningTrades / performance.totalTrades * 100).toFixed(1)
          : 0,
        totalTrades: performance.totalTrades,
        totalPnl: performance.totalPnl.toFixed(2),
        currentConsecutiveLosses: performance.currentConsecutiveLosses,
        maxConsecutiveLosses: performance.maxConsecutiveLosses,
        recommendation: 'HOLD'
      };

      // 风险建议
      if (performance.currentConsecutiveLosses >= 3) {
        insights.recommendation = 'REDUCE_POSITION';
        insights.reason = '连续亏损3次，建议减少仓位';
      } else if (performance.currentConsecutiveLosses >= 5) {
        insights.recommendation = 'STOP_TRADING';
        insights.reason = '连续亏损5次，建议暂停交易';
      } else if (insights.winRate < 40 && performance.totalTrades >= 10) {
        insights.recommendation = 'REVIEW_STRATEGY';
        insights.reason = '胜率低于40%，建议回顾策略';
      } else if (performance.currentConsecutiveLosses === 0 && performance.totalTrades >= 5) {
        insights.recommendation = 'MAINTAIN';
        insights.reason = '表现良好，保持当前策略';
      }

      // 添加组合分析
      if (portfolioReturns[symbol] && portfolioReturns[symbol].length >= 20) {
        const ratios = this.calculateSharpeRatio(portfolioReturns[symbol]);
        insights.ratios = ratios;

        if (ratios.sharpe < 0.5) {
          insights.riskWarning = '夏普比率偏低，风险调整后收益不佳';
        }
      }

      return insights;
    } catch (error) {
      systemLogger.error(`生成性能洞察失败: ${error.message}`);
      return {
        symbol,
        recommendation: 'ERROR',
        reason: `分析错误: ${error.message}`
      };
    }
  }

  /**
   * 获取夏普分析
   */
  getSharpeAnalysis(symbol, portfolioReturns) {
    try {
      if (!portfolioReturns[symbol] || portfolioReturns[symbol].length < 10) {
        return {
          symbol,
          ratios: { sharpe: 0, sortino: 0, calmar: 0 },
          assessment: 'INSUFFICIENT_DATA',
          message: '数据不足，无法计算'
        };
      }

      const ratios = this.calculateSharpeRatio(portfolioReturns[symbol]);
      let assessment, message;

      if (ratios.sharpe > 2) {
        assessment = 'EXCELLENT';
        message = '风险调整后收益优秀';
      } else if (ratios.sharpe > 1) {
        assessment = 'GOOD';
        message = '风险调整后收益良好';
      } else if (ratios.sharpe > 0.5) {
        assessment = 'FAIR';
        message = '风险调整后收益一般';
      } else {
        assessment = 'POOR';
        message = '风险调整后收益较差';
      }

      return {
        symbol,
        ratios,
        assessment,
        message
      };
    } catch (error) {
      systemLogger.error(`夏普分析失败: ${error.message}`);
      return {
        symbol,
        ratios: { sharpe: 0, sortino: 0, calmar: 0 },
        assessment: 'ERROR',
        message: `分析错误: ${error.message}`
      };
    }
  }

  /**
   * 更新交易性能
   */
  updateTradePerformance(symbol, performance, tradeResult) {
    try {
      performance.totalTrades += 1;

      if (tradeResult.pnl > 0) {
        performance.winningTrades += 1;
        performance.currentConsecutiveLosses = 0;
      } else {
        performance.losingTrades += 1;
        performance.currentConsecutiveLosses += 1;

        if (performance.currentConsecutiveLosses > performance.maxConsecutiveLosses) {
          performance.maxConsecutiveLosses = performance.currentConsecutiveLosses;
        }
      }

      performance.totalPnl += tradeResult.pnl;

      // 更新信号准确性统计
      if (tradeResult.signal) {
        if (!performance.accuracyBySignal[tradeResult.signal]) {
          performance.accuracyBySignal[tradeResult.signal] = { wins: 0, total: 0 };
        }

        performance.accuracyBySignal[tradeResult.signal].total += 1;
        if (tradeResult.pnl > 0) {
          performance.accuracyBySignal[tradeResult.signal].wins += 1;
        }
      }

      systemLogger.info(`${symbol} 交易性能已更新: 总交易${performance.totalTrades}, 胜率${(performance.winningTrades / performance.totalTrades * 100).toFixed(1)}%`);

      return performance;
    } catch (error) {
      systemLogger.error(`更新交易性能失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 风险检查
   */
  performRiskCheck(symbol, position, marketData, tradeConfig) {
    const risks = [];

    try {
      // 检查是否在失效条件下
      const currentPrice = marketData.price;
      const invalidationLevel = tradeConfig.invalidationLevels[symbol] || 0;

      if (currentPrice < invalidationLevel) {
        risks.push({
          level: 'CRITICAL',
          type: 'INVALIDATION_BREAK',
          message: `价格跌破失效阈值: ${currentPrice.toFixed(2)} < ${invalidationLevel.toFixed(2)}`
        });
      }

      // 检查连续亏损
      if (position.performance && position.performance.currentConsecutiveLosses >= 5) {
        risks.push({
          level: 'HIGH',
          type: 'CONSECUTIVE_LOSSES',
          message: `连续亏损${position.performance.currentConsecutiveLosses}次`
        });
      }

      // 检查仓位大小
      const maxPositionSize = tradeConfig.amountUsd * tradeConfig.leverage;
      if (position.size > maxPositionSize * 1.5) {
        risks.push({
          level: 'MEDIUM',
          type: 'POSITION_SIZE',
          message: `仓位过大: ${position.size} > ${maxPositionSize * 1.5}`
        });
      }

      // 检查持仓时间
      if (position.entryTime) {
        const holdingTime = (new Date() - new Date(position.entryTime)) / 1000 / 60; // 分钟
        if (holdingTime > 240) { // 超过4小时
          risks.push({
            level: 'MEDIUM',
            type: 'HOLDING_TIME',
            message: `持仓时间过长: ${holdingTime.toFixed(0)}分钟`
          });
        }
      }

      return {
        passed: risks.filter(r => r.level === 'CRITICAL').length === 0,
        risks
      };
    } catch (error) {
      systemLogger.error(`风险检查失败: ${error.message}`);
      return {
        passed: false,
        risks: [{
          level: 'ERROR',
          type: 'CHECK_FAILED',
          message: `风险检查错误: ${error.message}`
        }]
      };
    }
  }

  /**
   * 计算建议仓位大小
   */
  calculatePositionSize(accountBalance, riskPercent, entryPrice, stopLossPrice, leverage) {
    try {
      const riskAmount = accountBalance * (riskPercent / 100);
      const priceRisk = Math.abs(entryPrice - stopLossPrice);
      const positionSize = (riskAmount / priceRisk) * leverage;

      return {
        size: positionSize,
        riskAmount,
        riskPercent
      };
    } catch (error) {
      systemLogger.error(`计算仓位大小失败: ${error.message}`);
      return {
        size: 0,
        riskAmount: 0,
        riskPercent
      };
    }
  }
}

module.exports = new RiskManagement();
