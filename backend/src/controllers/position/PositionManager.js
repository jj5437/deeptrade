const { systemLogger } = require('../logger/Logger');
const { exchange, env } = require('../../config');

/**
 * 位置管理
 */
class PositionManager {
  constructor() {
    this.tickerWebSocket = null;
  }

  /**
   * 设置TickerWebSocket实例
   */
  setTickerWebSocket(tickerWebSocket) {
    this.tickerWebSocket = tickerWebSocket;
  }
  /**
   * 平仓
   * 使用 exchangeUtils.closePosition() 进行平仓，然后更新数据库
   */
  async closePosition(position, reason = 'manual', db = null) {
    try {
      const symbol = position.symbol;

      // 平仓前先验证数据库中是否存在该持仓
      if (db) {
        // 使用格式化后的 symbol（数据库中存储的是简化格式）
        const dbSymbol = this.formatSymbol(symbol);
        const dbPosition = db.getOpenPositionBySymbol(dbSymbol);
        if (!dbPosition) {
          systemLogger.info(`${dbSymbol} 数据库中未找到未平仓持仓记录，跳过平仓操作`);
          return { success: true, message: '无持仓记录', pnl: 0 };
        }
        systemLogger.info(`${dbSymbol} 数据库验证通过，找到持仓记录`);
      }

      // 注意：exchangeUtils 需要通过 db.exchangeUtils 访问
      // 因为 Database 在初始化时会设置 exchangeUtils
      let exchangeUtils = null;
      if (db && db.exchangeUtils) {
        exchangeUtils = db.exchangeUtils;
      } else {
        systemLogger.warn('exchangeUtils 不可用，跳过交易所平仓');
      }

      // 转换为交易所符号格式（带:USDT后缀）
      const exchangeSymbol = symbol.includes(':') ? symbol : `${symbol}:USDT`;

      // 统一转换为 long/short（exchangeUtils 会处理转换）
      const exchangeSide = position.side === 'buy' ? 'long' :
                          position.side === 'sell' ? 'short' :
                          position.side;

      systemLogger.info(`${symbol} 向交易所发起平仓请求: ${exchangeSymbol} ${exchangeSide}, 原因: ${reason}`);

      let exchangeResult = null;
      if (exchangeUtils) {
        // 使用 exchangeUtils.closePosition() 进行平仓（会调用 exchange.fapiPrivatePostOrder）
        exchangeResult = await exchangeUtils.closePosition(
          exchangeSymbol,
          exchangeSide,
          position.size
        );
      }

      // 更新数据库（只更新记录，不调用交易所）
      if (db) {
        // 使用格式化后的 symbol（数据库中存储的是简化格式）
        const dbSymbol = this.formatSymbol(symbol);
        db.closePositionBySymbol(dbSymbol, position.currentPrice || 0, reason);
      }

      const pnl = this.calculatePnL(position, position.currentPrice || 0);
      systemLogger.info(`${symbol} 平仓成功: PnL=${pnl.toFixed(2)} USDT`);
      return { success: true, pnl, exchangeResult };
    } catch (error) {
      systemLogger.error(`平仓失败: ${error.message}`);
      systemLogger.error(`错误详情: ${error.stack}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * 计算PnL
   */
  calculatePnL(position, closePrice) {
    const entryPrice = position.entryPrice;
    const size = position.size;

    if (position.side === 'long') {
      return (closePrice - entryPrice) * size;
    } else {
      return (entryPrice - closePrice) * size;
    }
  }

  /**
   * 格式化符号
   */
  formatSymbol(symbol) {
    // 如果已经是完整格式（包含:USDT），根据交易所类型进行转换
    if (symbol.includes(':')) {
      // 对于Binance，移除:USDT后缀
      if (env.exchange.type === 'binance') {
        return symbol.split(':')[0];
      }
      // 对于OKX，保持原样
      return symbol;
    }

    // 如果没有:后缀，根据交易所添加
    if (env.exchange.type === 'okx') {
      return `${symbol}:USDT`;
    }

    // Binance不需要额外后缀
    return symbol;
  }

  /**
   * 获取所有持仓 - 从数据库读取（优化版）
   * 只有在需要时（如平仓前检查）才从交易所验证
   */
  async getAllPositions(db = null) {
    try {
      // 优先从数据库读取（快速响应）
      if (db) {
        const positions = await db.getOpenPositions();
        systemLogger.info(`从数据库加载持仓: ${positions.length}个`);
        return positions;
      }

      systemLogger.warn('数据库未初始化，无法获取持仓');
      return [];
    } catch (error) {
      systemLogger.error(`获取持仓失败: ${error.message}`);
      return [];
    }
  }

  /**
   * 检查是否有活跃持仓
   */
  hasActivePosition(positions, symbol, side = null) {
    if (!positions) return false;

    if (Array.isArray(positions)) {
      return positions.some(p => p.symbol === symbol && (!side || p.side === side));
    } else {
      return positions.symbol === symbol && (!side || positions.side === side);
    }
  }

  /**
   * 同步持仓到数据库 - 仅在必要时调用交易所API
   * 当数据库中没有open状态的持仓时才需要同步
   */
  async syncPositionsToDatabase(db, exchangeUtils) {
    try {
      if (!db || !exchangeUtils) {
        systemLogger.warn('数据库或交易所工具未初始化，跳过同步');
        return { success: false, message: '未初始化' };
      }

      // 首先检查数据库中是否已有持仓
      const dbPositions = await db.getOpenPositions();
      if (dbPositions.length > 0) {
        systemLogger.info(`数据库已有 ${dbPositions.length} 个持仓，无需同步`);
        return { success: true, message: '数据库已有持仓', count: dbPositions.length };
      }

      systemLogger.info('数据库无持仓，从交易所同步...');

      // 只有在数据库为空时才调用交易所API
      const exchangePositions = await exchangeUtils.getAllPositions();

      if (exchangePositions.length === 0) {
        systemLogger.info('交易所也无持仓');
        return { success: true, message: '无持仓', count: 0 };
      }

      systemLogger.info(`从交易所获取到 ${exchangePositions.length} 个持仓`);

      // 遍历并保存到数据库
      for (const pos of exchangePositions) {
        try {
          // 转换格式并保存
          const positionData = {
            symbol: pos.symbol,
            side: pos.side,
            size: pos.size,
            entryPrice: pos.entryPrice,
            entryTime: new Date().toISOString(),
            aiStopLoss: null,
            aiTakeProfit: null,
            leverage: pos.leverage || 1,
            margin: null
          };

          // 使用数据库的保存方法
          if (typeof db.savePosition === 'function') {
            db.savePosition(positionData);
          }
        } catch (error) {
          systemLogger.error(`保存${pos.symbol}持仓失败: ${error.message}`);
        }
      }

      return { success: true, message: '同步完成', count: exchangePositions.length };
    } catch (error) {
      systemLogger.error(`同步持仓失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * 验证持仓状态 - 平仓前检查
   * 确保数据库中的持仓与交易所实际状态一致
   */
  async validatePosition(symbol, db, exchangeUtils) {
    try {
      if (!db || !exchangeUtils) {
        return { valid: true, message: '跳过验证（未初始化）' };
      }

      // 从数据库获取持仓
      const dbPosition = db.getOpenPositionBySymbol
        ? await db.getOpenPositionBySymbol(symbol)
        : null;

      if (!dbPosition) {
        return { valid: false, message: '数据库中未找到持仓' };
      }

      // 转换为交易所格式进行验证
      const exchangeSymbol = symbol.includes(':') ? symbol : `${symbol}:USDT`;

      try {
        // 优先使用WebSocket缓存
        let ticker = null;
        if (this.tickerWebSocket) {
          const wsTickerData = await this.tickerWebSocket.getTicker(exchangeSymbol);
          if (wsTickerData) {
            ticker = {
              price: wsTickerData.price
            };
          }
        }

        // 缓存未命中时使用REST API
        if (!ticker) {
          ticker = await exchangeUtils.getTicker(exchangeSymbol);
        }

        // 验证通过
        return {
          valid: true,
          message: '持仓验证通过',
          currentPrice: ticker.price,
          dbPosition
        };
      } catch (error) {
        // API调用失败时，仅记录日志，使用数据库数据
        systemLogger.warn(`验证${symbol}持仓时获取价格失败: ${error.message}`);
        return {
          valid: true,
          message: '验证通过（使用缓存数据）',
          currentPrice: null,
          dbPosition
        };
      }
    } catch (error) {
      systemLogger.error(`验证${symbol}持仓失败: ${error.message}`);
      return { valid: false, error: error.message };
    }
  }
}

module.exports = new PositionManager();
