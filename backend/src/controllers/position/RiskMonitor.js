const { systemLogger } = require('../logger/Logger');
const { env } = require('../../config');

/**
 * 风险监控
 */
class RiskMonitor {
  constructor() {
    this.isRunning = false;
    this.interval = null;
    this.db = null;
    this.exchangeUtils = null;
    this.positionManager = null;
    this.tickerWebSocket = null;
  }

  /**
   * 初始化依赖
   */
  init(db, exchangeUtils, positionManager, tickerWebSocket = null) {
    this.db = db;
    this.exchangeUtils = exchangeUtils;
    this.positionManager = positionManager;
    this.tickerWebSocket = tickerWebSocket;
    systemLogger.info('风险监控依赖注入完成');
  }

  /**
   * 启动风险监控
   */
  start(intervalSeconds = 60) {
    if (this.isRunning) {
      systemLogger.warn('风险监控已在运行中');
      return;
    }

    this.isRunning = true;
    this.interval = setInterval(() => {
      this.performRiskCheck().catch(error => {
        systemLogger.error(`风险监控执行失败: ${error.message}`);
      });
    }, intervalSeconds * 1000);

    systemLogger.info(`风险监控已启动，检查间隔: ${intervalSeconds}秒`);
  }

  /**
   * 停止风险监控
   */
  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.isRunning = false;
    systemLogger.info('风险监控已停止');
  }

  /**
   * 执行风险检查 - 快速检查止盈止损（每30秒）
   */
  async performRiskCheck() {
    try {
      if (!this.db) {
        systemLogger.warn('风险检查: 数据库未初始化，跳过');
        return;
      }
      if (!this.exchangeUtils) {
        systemLogger.warn('风险检查: 交易所工具未初始化，跳过');
        return;
      }
      if (!this.positionManager) {
        systemLogger.warn('风险检查: 位置管理器未初始化，跳过');
        return;
      }

      // 获取所有未平仓持仓（更新价格以便计算准确的PnL）
      const positions = await this.db.getOpenPositions(false, true);

      if (positions.length === 0) {
        systemLogger.info('风险检查: 无持仓，跳过');
        return; // 无持仓时跳过
      }

      systemLogger.info(`风险检查: 检查 ${positions.length} 个持仓`);
      // 并发检查所有持仓（带超时控制）
      const checkPromises = positions.map(position =>
        Promise.race([
          this.checkPosition(position),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('检查超时')), 10000)  // 10秒超时
          )
        ])
      );
      await Promise.allSettled(checkPromises);

    } catch (error) {
      systemLogger.error(`风险检查失败: ${error.message}`, { stack: error.stack });
    }
  }

  /**
   * 检查单个持仓的止盈止损
   */
  async checkPosition(position) {
    try {
      const symbol = position.symbol;
      const side = position.side;
      systemLogger.info(`风险检查: 检查 ${symbol} ${side} 持仓`);

      // 获取当前价格（优先使用WebSocket缓存）
      let ticker = null;
      if (this.tickerWebSocket) {
        const wsTickerData = await this.tickerWebSocket.getTicker(symbol);
        if (wsTickerData) {
          ticker = {
            price: wsTickerData.price
          };
        }
      }

      // 如果WebSocket缓存未就绪，跳过此次检查（不记录错误）
      if (!ticker) {
        systemLogger.warn(`${symbol} WebSocket缓存未就绪，跳过风险检查`);
        return;
      }

      const currentPrice = ticker.price;

      // 检查止盈条件
      if (this.shouldTakeProfit(position, currentPrice)) {
        const aiTakeProfit = position.ai_take_profit;
        systemLogger.info(`🚨 [RiskMonitor] ${symbol} 触发快速止盈 (AI止盈: ${aiTakeProfit})，当前价格: ${currentPrice}`);
        // 设置当前价格到position对象
        position.currentPrice = currentPrice;
        const result = await this.positionManager.closePosition(position, 'quick_take_profit', this.db);
        if (result.success) {
          systemLogger.info(`✅ ${symbol} 快速止盈成功，PnL: ${result.pnl}`);
        }
        return;
      }

      // 检查AI止损
      if (this.shouldAiStopLoss(position, currentPrice)) {
        const aiStopLoss = position.ai_stop_loss;
        systemLogger.info(`🚨 [RiskMonitor] ${symbol} 触发AI快速止损 (AI止损: ${aiStopLoss})，当前价格: ${currentPrice}`);
        // 设置当前价格到position对象
        position.currentPrice = currentPrice;
        const result = await this.positionManager.closePosition(position, 'quick_ai_stop_loss', this.db);
        if (result.success) {
          systemLogger.info(`✅ ${symbol} AI快速止损成功，PnL: ${result.pnl}`);
        }
        return;
      }

      // 检查止损条件（传统5%止损）
      if (this.shouldStopLoss(position, currentPrice)) {
        systemLogger.info(`🚨 [RiskMonitor] ${symbol} 触发快速止损，当前价格: ${currentPrice}`);
        // 设置当前价格到position对象
        position.currentPrice = currentPrice;
        const result = await this.positionManager.closePosition(position, 'quick_stop_loss', this.db);
        if (result.success) {
          systemLogger.info(`✅ ${symbol} 快速止损成功，PnL: ${result.pnl}`);
        }
        return;
      }

    } catch (error) {
      systemLogger.error(`${position?.symbol} 风险检查失败: ${error.message}`);
    }
  }

  /**
   * 检查是否触发止盈
   */
  shouldTakeProfit(position, currentPrice) {
    // 检查AI止盈（使用数据库字段名：ai_take_profit）
    const aiTakeProfit = position.ai_take_profit;
    if (aiTakeProfit && env.trading.takeProfitEnabled) {
      if (position.side === 'buy' && currentPrice >= aiTakeProfit) {
        return true;
      }
      if (position.side === 'sell' && currentPrice <= aiTakeProfit) {
        return true;
      }
    }

    // 检查固定百分比止盈（独立检查，即使有AI止盈也会检查）
    if (env.trading.takeProfitEnabled && env.trading.takeProfitPercentage > 0) {
      const fixedTakeProfit = position.side === 'buy'
        ? position.entryPrice * (1 + env.trading.takeProfitPercentage)
        : position.entryPrice * (1 - env.trading.takeProfitPercentage);

      if (position.side === 'buy' && currentPrice >= fixedTakeProfit) {
        return true;
      }
      if (position.side === 'sell' && currentPrice <= fixedTakeProfit) {
        return true;
      }
    }

    return false;
  }

  /**
   * 检查是否触发传统止损
   */
  shouldStopLoss(position, currentPrice) {
    const threshold = env.trading.holdThreshold; // 默认0.99（1%损失）
    const entryPrice = position.entryPrice;

    if (position.side === 'buy') {
      // 多头：价格跌破开仓价的threshold倍
      const lossPercentage = (entryPrice - currentPrice) / entryPrice;
      if (lossPercentage > (1 - threshold)) {
        return true;
      }
    } else {
      // 空头：价格涨破开仓价的(1-threshold)倍
      const lossPercentage = (currentPrice - entryPrice) / entryPrice;
      if (lossPercentage > (1 - threshold)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 检查是否触发AI止损
   */
  shouldAiStopLoss(position, currentPrice) {
    // 使用数据库字段名：ai_stop_loss
    const aiStopLoss = position.ai_stop_loss;
    if (!aiStopLoss) {
      return false;
    }

    if (position.side === 'buy' && currentPrice <= aiStopLoss) {
      return true;
    }
    if (position.side === 'sell' && currentPrice >= aiStopLoss) {
      return true;
    }

    return false;
  }

  /**
   * 获取监控状态
   */
  getStatus() {
    return {
      running: this.isRunning,
      interval: this.interval ? this.interval._repeat : null
    };
  }
}

module.exports = new RiskMonitor();
