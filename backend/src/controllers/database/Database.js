const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { env } = require('../../config');
const { systemLogger } = require('../logger/Logger');

/**
 * 交易数据库管理类
 */
class TradingDatabase {
  constructor(dbPath = env.paths.db) {
    this.dbPath = dbPath;
    this.ensureDataDirectory();
    this.db = new Database(dbPath);
    this.initDatabase();

    // 设置数据库 busy timeout 为 30 秒（默认是 5 秒）
    // 这可以防止长事务被意外终止
    this.db.pragma('busy_timeout = 30000');

    this.webSocketManager = null;
    this.exchangeUtils = null;
    this.tickerWebSocket = null;
  }

  /**
   * 设置WebSocket管理器
   */
  setWebSocketManager(wsManager) {
    this.webSocketManager = wsManager;
  }

  /**
   * 设置交易所工具实例
   */
  setExchangeUtils(exchangeUtils) {
    this.exchangeUtils = exchangeUtils;
  }

  /**
   * 设置Ticker WebSocket实例
   */
  setTickerWebSocket(tickerWebSocket) {
    this.tickerWebSocket = tickerWebSocket;
  }

  /**
   * 确保数据目录存在
   */
  ensureDataDirectory() {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * 初始化数据库表结构
   */
  initDatabase() {
    try {
      const createPositionsTable = `
        CREATE TABLE IF NOT EXISTS positions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          symbol TEXT NOT NULL,
          side TEXT NOT NULL,
          size REAL NOT NULL,
          entry_price REAL NOT NULL,
          entry_time TEXT NOT NULL,
          ai_stop_loss REAL,
          ai_take_profit REAL,
          leverage INTEGER DEFAULT 1,
          margin REAL,
          status TEXT DEFAULT 'open',
          close_price REAL,
          close_time TEXT,
          close_reason TEXT,
          realized_pnl REAL DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        )
      `;

      const createTradeLogsTable = `
        CREATE TABLE IF NOT EXISTS trade_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          symbol TEXT NOT NULL,
          action TEXT NOT NULL,
          side TEXT,
          size REAL,
          price REAL,
          pnl REAL,
          entry_price REAL,
          leverage INTEGER,
          message TEXT,
          details TEXT,
          success BOOLEAN DEFAULT 1,
          timestamp TEXT DEFAULT (datetime('now'))
        )
      `;

      const createAiSignalsTable = `
        CREATE TABLE IF NOT EXISTS ai_signals (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          symbol TEXT NOT NULL,
          signal TEXT NOT NULL,
          confidence TEXT NOT NULL,
          reason TEXT,
          current_price REAL,
          stop_loss REAL,
          take_profit REAL,
          timestamp TEXT DEFAULT (datetime('now'))
        )
      `;

      const createPerformanceStatsTable = `
        CREATE TABLE IF NOT EXISTS performance_stats (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          symbol TEXT NOT NULL UNIQUE,
          total_trades INTEGER DEFAULT 0,
          winning_trades INTEGER DEFAULT 0,
          losing_trades INTEGER DEFAULT 0,
          total_pnl REAL DEFAULT 0,
          max_consecutive_losses INTEGER DEFAULT 0,
          current_consecutive_losses INTEGER DEFAULT 0,
          win_rate REAL DEFAULT 0,
          last_updated TEXT DEFAULT (datetime('now'))
        )
      `;

      const createSettingsTable = `
        CREATE TABLE IF NOT EXISTS settings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          key TEXT NOT NULL UNIQUE,
          value TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        )
      `;

      this.db.exec(`
        ${createPositionsTable};

        ${createTradeLogsTable};

        ${createAiSignalsTable};

        ${createPerformanceStatsTable};

        ${createSettingsTable};
      `);

      systemLogger.info('数据库初始化完成');
    } catch (error) {
      systemLogger.error(`数据库初始化失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 将数据库字段映射为API格式
   */
  mapDbPositionToApi(dbPosition) {
    if (!dbPosition) return null;

    return {
      id: dbPosition.id.toString(),
      symbol: dbPosition.symbol,
      exchange: 'binance', // 默认交易所
      side: dbPosition.side,
      size: dbPosition.size,
      entryPrice: dbPosition.entry_price,
      currentPrice: 0, // 将通过updatePositionPrices更新
      pnl: 0,
      pnlPercent: 0,
      leverage: dbPosition.leverage || 1,
      timestamp: new Date(dbPosition.created_at).getTime(),
      // 添加AI止盈止损字段
      ai_take_profit: dbPosition.ai_take_profit,
      ai_stop_loss: dbPosition.ai_stop_loss
    };
  }

  /**
   * 更新持仓的当前价格和盈亏（并发优化版）
   */
  async updatePositionPrices(positions) {
    if (!positions || positions.length === 0) return positions;

    const updatedPositions = [];

    // 如果没有exchangeUtils，直接返回默认价格
    if (!this.exchangeUtils) {
      positions.forEach(position => {
        position.currentPrice = position.entryPrice;
        position.pnl = 0;
        position.pnlPercent = 0;
        updatedPositions.push(position);
      });
      return updatedPositions;
    }

    // 使用Promise.allSettled进行并发请求，完全依赖WebSocket缓存
    const pricePromises = positions.map(async (position) => {
      try {
        // 优先使用WebSocket缓存
        let ticker = null;
        if (this.tickerWebSocket) {
          const wsTickerData = await this.tickerWebSocket.getTicker(position.symbol);
          if (wsTickerData) {
            ticker = {
              symbol: wsTickerData.symbol,
              price: wsTickerData.price,
              change: wsTickerData.change24h,
              percentage: wsTickerData.changePercent24h,
              high: wsTickerData.high24h,
              low: wsTickerData.low24h,
              volume: wsTickerData.volume24h,
              timestamp: wsTickerData.timestamp
            };
          }
        }

        // 如果WebSocket缓存未就绪，使用开仓价格（不记录错误）
        if (!ticker) {
          systemLogger.warn(`${position.symbol} WebSocket缓存未就绪，使用开仓价格`);
          position.currentPrice = position.entryPrice;
          position.pnl = 0;
          position.pnlPercent = 0;
          return position;
        }

        const currentPrice = ticker.price;

        // 计算盈亏（考虑做多做空方向）
        const sideMultiplier = position.side === 'sell' ? -1 : 1;
        const priceDiff = (currentPrice - position.entryPrice) * sideMultiplier;

        // 计算绝对盈亏金额
        const pnl = priceDiff * position.size;

        // 计算收益率（考虑杠杆倍数）
        const pnlPercent = (priceDiff / position.entryPrice) * position.leverage * 100;

        // 更新对象
        position.currentPrice = currentPrice;
        position.pnl = pnl;
        position.pnlPercent = pnlPercent;

        return position;
      } catch (error) {
        // 静默处理错误，使用开仓价格
        systemLogger.warn(`获取${position.symbol}价格失败，使用开仓价格: ${error.message}`);
        position.currentPrice = position.entryPrice;
        position.pnl = 0;
        position.pnlPercent = 0;
        return position;
      }
    });

    // 并发执行所有价格获取请求
    const results = await Promise.allSettled(pricePromises);

    // 收集结果
    results.forEach((result) => {
      if (result.status === 'fulfilled') {
        updatedPositions.push(result.value);
      }
    });

    return updatedPositions;
  }

  /**
   * 获取所有未平仓持仓（优化版：快速读取 + 异步价格更新）
   * @param {boolean} fastMode - 快速模式：只从数据库读取，price/pnl设为0或使用缓存
   * @param {boolean} updatePrices - 是否更新价格（会调用交易所API）
   */
  async getOpenPositions(fastMode = false, updatePrices = false) {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM positions WHERE status = 'open' ORDER BY created_at DESC
      `);
      const positions = stmt.all();
      const apiPositions = positions.map(pos => this.mapDbPositionToApi(pos));

      // 快速模式：直接返回数据库数据，不调用API
      if (fastMode) {
        // 保留entryPrice作为currentPrice，pnl为0（客户端可通过WebSocket异步更新）
        apiPositions.forEach(pos => {
          pos.currentPrice = pos.currentPrice || pos.entryPrice;
          pos.pnl = 0;
          pos.pnlPercent = 0;
        });
        return apiPositions;
      }

      // 需要更新价格时调用（注意：这会调用交易所API）
      if (updatePrices) {
        return await this.updatePositionPrices(apiPositions);
      }

      // 兼容旧版本：默认不更新价格，直接返回数据库数据
      apiPositions.forEach(pos => {
        pos.currentPrice = pos.currentPrice || pos.entryPrice;
        pos.pnl = 0;
        pos.pnlPercent = 0;
      });
      return apiPositions;
    } catch (error) {
      systemLogger.error(`获取未平仓持仓失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 根据币种获取未平仓持仓（优化版）
   * @param {boolean} fastMode - 快速模式
   * @param {boolean} updatePrices - 是否更新价格
   */
  async getOpenPositionBySymbol(symbol, fastMode = false, updatePrices = false) {
    try {
      // 标准化 symbol 格式（移除 :USDT 或其他交易所后缀）
      const cleanSymbol = symbol.includes(':') ? symbol.split(':')[0] : symbol;

      const stmt = this.db.prepare(`
        SELECT * FROM positions WHERE symbol = ? AND status = 'open' LIMIT 1
      `);
      const position = stmt.get(cleanSymbol);
      if (!position) return null;

      const apiPosition = this.mapDbPositionToApi(position);

      // 快速模式：直接返回数据库数据
      if (fastMode) {
        apiPosition.currentPrice = apiPosition.currentPrice || apiPosition.entryPrice;
        apiPosition.pnl = 0;
        apiPosition.pnlPercent = 0;
        return apiPosition;
      }

      // 需要更新价格时调用
      if (updatePrices) {
        const updatedPositions = await this.updatePositionPrices([apiPosition]);
        return updatedPositions[0] || null;
      }

      // 兼容旧版本
      apiPosition.currentPrice = apiPosition.currentPrice || apiPosition.entryPrice;
      apiPosition.pnl = 0;
      apiPosition.pnlPercent = 0;
      return apiPosition;
    } catch (error) {
      systemLogger.error(`获取持仓失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 保存新持仓
   */
  savePosition(position) {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO positions (
          symbol, side, size, entry_price, entry_time,
          ai_stop_loss, ai_take_profit, leverage, margin
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const result = stmt.run(
        position.symbol,
        position.side,
        position.size,
        position.entryPrice,
        position.entryTime,
        position.aiStopLoss,
        position.aiTakeProfit,
        position.leverage,
        position.margin
      );

      systemLogger.info(`持仓已保存: ${position.symbol} ${position.side} #${result.lastInsertRowid}`);
      return result.lastInsertRowid;
    } catch (error) {
      systemLogger.error(`保存持仓失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 更新持仓
   */
  updatePosition(positionId, updates) {
    try {
      const fields = Object.keys(updates);
      const values = Object.values(updates);
      const setClause = fields.map(field => `${field} = ?`).join(', ');

      const stmt = this.db.prepare(`
        UPDATE positions
        SET ${setClause}, updated_at = datetime('now')
        WHERE id = ?
      `);

      values.push(positionId);
      const result = stmt.run(...values);

      systemLogger.info(`持仓已更新: #${positionId}, 影响行数: ${result.changes}`);
      return result.changes;
    } catch (error) {
      systemLogger.error(`更新持仓失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 根据币种关闭持仓
   * 注意：这个方法现在只更新数据库记录，交易所平仓由 exchangeUtils.closePosition() 处理
   */
  async closePositionBySymbol(symbol, closePrice, closeReason = 'manual') {
    try {
      // 标准化 symbol 格式（移除 :USDT 或其他交易所后缀）
      // 数据库中存储的是简化格式如 "ETH/USDT"，而不是 "ETH/USDT:USDT"
      const cleanSymbol = symbol.includes(':') ? symbol.split(':')[0] : symbol;

      // 先从数据库获取原始数据（不是API格式）
      const stmt = this.db.prepare(`
        SELECT * FROM positions WHERE symbol = ? AND status = 'open' LIMIT 1
      `);
      const dbPosition = stmt.get(cleanSymbol);

      if (!dbPosition) {
        throw new Error(`未找到 ${cleanSymbol} 的未平仓持仓`);
      }

      // 如果没有传入价格，尝试获取当前价格（用于数据库记录）
      if (!closePrice) {
        try {
          // 优先使用WebSocket缓存
          if (this.tickerWebSocket) {
            const wsTickerData = await this.tickerWebSocket.getTicker(symbol);
            if (wsTickerData) {
              closePrice = wsTickerData.price;
            }
          }

          // 如果WebSocket缓存未就绪，使用开仓价格（不记录错误）
          if (!closePrice) {
            systemLogger.warn(`${symbol} WebSocket缓存未就绪，使用开仓价格作为平仓价格`);
            closePrice = dbPosition.entry_price;
          }
        } catch (error) {
          // 静默处理错误，使用开仓价格
          systemLogger.warn(`获取${symbol}平仓价格失败，使用开仓价格: ${error.message}`);
          closePrice = dbPosition.entry_price;
        }
      }

      // 如果仍未获取到价格，使用开仓价格
      if (!closePrice) {
        closePrice = dbPosition.entry_price;
      }

      const pnl = (closePrice - dbPosition.entry_price) * dbPosition.size;
      const sideMultiplier = dbPosition.side === 'sell' ? -1 : 1;
      const realizedPnl = pnl * sideMultiplier;

      // 使用数据库ID（数字）更新数据库
      this.updatePosition(dbPosition.id, {
        status: 'closed',
        close_price: closePrice,
        close_time: new Date().toISOString(),
        close_reason: closeReason,
        realized_pnl: realizedPnl
      });

      // 更新交易日志（包含盈亏信息）
      // 计算平仓动作的方向：平多单=SELL，平空单=BUY
      // 注意：positions表中存储的是'buy'/'sell'，不是'long'/'short'
      const closeSide = dbPosition.side === 'buy' ? 'sell' : 'buy';

      this.addTradeLog({
        symbol,
        action: 'close_position',
        side: closeSide,
        size: dbPosition.size,
        price: closePrice,
        pnl: realizedPnl,
        entry_price: dbPosition.entry_price,
        leverage: dbPosition.leverage,
        message: `平仓: ${closeReason}`,
        success: true,
        details: {
          realized_pnl: realizedPnl,
          entry_price: dbPosition.entry_price,
          leverage: dbPosition.leverage
        }
      });

      // 推送WebSocket通知前端
      if (this.webSocketManager) {
        this.webSocketManager.sendPositionUpdate({
          action: 'closed',
          symbol,
          pnl: realizedPnl,
          closePrice,
          closeReason
        });
      }

      // 更新性能统计数据
      await this.updatePerformanceStatsForSymbol(symbol);

      systemLogger.info(`${symbol} 持仓数据库记录已更新, PnL: ${realizedPnl.toFixed(2)}`);
      return realizedPnl;
    } catch (error) {
      systemLogger.error(`关闭持仓失败: ${error.message}`);

      // 添加错误日志
      this.addTradeLog({
        symbol,
        action: 'close_position',
        message: `平仓失败: ${error.message}`,
        success: false,
        details: {
          error: error.message,
          closeReason
        }
      });

      throw error;
    }
  }


  /**
   * 添加交易日志
   */
  addTradeLog(log) {
    try {
      // 确保所有值都是可安全绑定的类型
      const safeLog = {
        symbol: String(log.symbol || ''),
        action: String(log.action || ''),
        side: log.side ? String(log.side) : null,
        size: typeof log.size === 'number' ? log.size : null,
        price: typeof log.price === 'number' ? log.price : null,
        pnl: typeof log.pnl === 'number' ? log.pnl : null,
        entryPrice: typeof log.entryPrice === 'number' ? log.entryPrice : null,
        leverage: typeof log.leverage === 'number' ? log.leverage : null,
        message: log.message ? String(log.message).substring(0, 500) : null,
        details: log.details ? this.sanitizeDetails(log.details) : null,
        success: log.success !== false ? 1 : 0  // SQLite布尔值必须用0或1
      };

      const stmt = this.db.prepare(`
        INSERT INTO trade_logs (
          symbol, action, side, size, price, pnl, entry_price, leverage, message, details, success
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const result = stmt.run(
        safeLog.symbol,
        safeLog.action,
        safeLog.side,
        safeLog.size,
        safeLog.price,
        safeLog.pnl,
        safeLog.entryPrice,
        safeLog.leverage,
        safeLog.message,
        safeLog.details,
        safeLog.success
      );

      return result.lastInsertRowid;
    } catch (error) {
      systemLogger.error(`添加交易日志失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 清理details对象，确保所有值都可序列化
   */
  sanitizeDetails(details) {
    try {
      if (typeof details === 'object' && details !== null) {
        const sanitized = {};
        for (const [key, value] of Object.entries(details)) {
          if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean' || value === null) {
            sanitized[key] = value;
          } else if (value instanceof Date) {
            sanitized[key] = value.toISOString();
          } else {
            // 对于复杂对象，只保留字符串表示
            sanitized[key] = String(value).substring(0, 100);
          }
        }
        return JSON.stringify(sanitized);
      }
      return String(details).substring(0, 500);
    } catch (error) {
      return `无法序列化的对象: ${error.message}`;
    }
  }

  /**
   * 获取交易日志
   */
  getTradeLogs(limit = 100, offset = 0) {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM trade_logs ORDER BY timestamp DESC LIMIT ? OFFSET ?
      `);
      const logs = stmt.all(limit, offset);
      return logs.map(log => {
        // 解析details JSON字段
        let parsedDetails = {};
        if (log.details) {
          try {
            parsedDetails = JSON.parse(log.details);
          } catch (e) {
            parsedDetails = {};
          }
        }

        return {
          id: log.id.toString(),
          symbol: log.symbol,
          exchange: 'binance',
          side: log.side,
          action: log.action === 'open_position' ? 'open' : log.action === 'close_position' ? 'close' : log.action,
          size: log.size,
          price: log.price,
          total: (log.price || 0) * (log.size || 0),
          pnl: parsedDetails.realized_pnl || null,
          entryPrice: parsedDetails.entry_price || null,
          leverage: parsedDetails.leverage || null,
          stopLoss: parsedDetails.stop_loss_price || null,
          takeProfit: parsedDetails.take_profit_price || null,
          status: log.success ? 'completed' : 'failed',
          message: log.message,
          timestamp: new Date(log.timestamp).getTime()
        };
      });
    } catch (error) {
      systemLogger.error(`获取交易日志失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 保存AI信号
   */
  saveAiSignal(signal) {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO ai_signals (
          symbol, signal, confidence, reason, current_price, stop_loss, take_profit
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      const result = stmt.run(
        signal.symbol,
        signal.signal,
        signal.confidence,
        signal.reason,
        signal.currentPrice,
        signal.stopLoss,
        signal.takeProfit
      );

      const signalId = result.lastInsertRowid;

      // 获取完整的信号数据
      const fullSignal = this.getAiSignalById(signalId);

      // 通过WebSocket推送给前端
      if (this.webSocketManager) {
        this.webSocketManager.sendAiSignal(fullSignal);
        systemLogger.info(`AI信号已保存并推送: ${signal.symbol} ${signal.signal} #${signalId}`);
      } else {
        systemLogger.warn(`AI信号已保存但未推送 (WebSocket未初始化): ${signal.symbol} ${signal.signal} #${signalId}`);
      }

      return signalId;
    } catch (error) {
      systemLogger.error(`保存AI信号失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 获取指定符号最近的AI分析时间
   */
  getLastAnalysisTime(symbol) {
    try {
      const stmt = this.db.prepare(`
        SELECT timestamp FROM ai_signals
        WHERE symbol = ?
        ORDER BY timestamp DESC
        LIMIT 1
      `);

      const result = stmt.get(symbol);
      return result ? result.timestamp : null;
    } catch (error) {
      systemLogger.error(`获取${symbol}最近分析时间失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 根据ID获取AI信号
   */
  getAiSignalById(id) {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM ai_signals WHERE id = ? LIMIT 1
      `);
      const signal = stmt.get(id);
      if (!signal) return null;

      return {
        id: signal.id.toString(),
        symbol: signal.symbol,
        signal: signal.signal,
        confidence: signal.confidence,
        reason: signal.reason,
        timestamp: new Date(signal.timestamp).getTime()
      };
    } catch (error) {
      systemLogger.error(`获取AI信号失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 获取最近的AI信号
   */
  getRecentAiSignals(symbol, limit = 10) {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM ai_signals WHERE symbol = ? ORDER BY timestamp DESC LIMIT ?
      `);
      const signals = stmt.all(symbol, limit);
      return signals.map(signal => ({
        id: signal.id.toString(),
        symbol: signal.symbol,
        signal: signal.signal,
        confidence: signal.confidence,
        reason: signal.reason,
        timestamp: new Date(signal.timestamp).getTime()
      }));
    } catch (error) {
      systemLogger.error(`获取AI信号失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 获取性能统计
   */
  getPerformanceStats(symbol) {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM performance_stats WHERE symbol = ?
      `);
      return stmt.get(symbol);
    } catch (error) {
      systemLogger.error(`获取性能统计失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 获取今日已实现盈亏（从trade_logs表计算）
   */
  getTodayRealizedPnl() {
    try {
      // 获取今日00:00:00的时间戳
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayTimestamp = today.getTime();

      const stmt = this.db.prepare(`
        SELECT details FROM trade_logs
        WHERE action = 'close_position' AND timestamp >= ?
      `);

      const logs = stmt.all(todayTimestamp);
      let totalPnl = 0;

      for (const log of logs) {
        try {
          const details = JSON.parse(log.details);
          if (details.realized_pnl) {
            totalPnl += parseFloat(details.realized_pnl);
          }
        } catch (e) {
          // 忽略解析错误
        }
      }

      return totalPnl;
    } catch (error) {
      systemLogger.error(`获取今日盈亏失败: ${error.message}`);
      return 0;
    }
  }

  /**
   * 更新性能统计
   */
  updatePerformanceStats(symbol, stats) {
    try {
      const existing = this.getPerformanceStats(symbol);

      if (existing) {
        const stmt = this.db.prepare(`
          UPDATE performance_stats
          SET total_trades = ?, winning_trades = ?, losing_trades = ?,
              total_pnl = ?, max_consecutive_losses = ?,
              current_consecutive_losses = ?, win_rate = ?,
              last_updated = datetime('now')
          WHERE symbol = ?
        `);

        stmt.run(
          stats.totalTrades,
          stats.winningTrades,
          stats.losingTrades,
          stats.totalPnl,
          stats.maxConsecutiveLosses,
          stats.currentConsecutiveLosses,
          stats.winRate,
          symbol
        );
      } else {
        const stmt = this.db.prepare(`
          INSERT INTO performance_stats (
            symbol, total_trades, winning_trades, losing_trades,
            total_pnl, max_consecutive_losses, current_consecutive_losses, win_rate
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(
          symbol,
          stats.totalTrades,
          stats.winningTrades,
          stats.losingTrades,
          stats.totalPnl,
          stats.maxConsecutiveLosses,
          stats.currentConsecutiveLosses,
          stats.winRate
        );
      }

      systemLogger.info(`${symbol} 性能统计已更新`);
    } catch (error) {
      systemLogger.error(`更新性能统计失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 根据已平仓交易更新指定币种的性能统计
   */
  async updatePerformanceStatsForSymbol(symbol) {
    try {
      // 获取该币种的所有已平仓交易
      const stmt = this.db.prepare(`
        SELECT * FROM positions
        WHERE symbol = ? AND status = 'closed' AND realized_pnl IS NOT NULL
        ORDER BY close_time ASC
      `);
      const closedPositions = stmt.all(symbol);

      if (!closedPositions || closedPositions.length === 0) {
        // 如果没有已平仓交易，重置统计
        this.updatePerformanceStats(symbol, {
          totalTrades: 0,
          winningTrades: 0,
          losingTrades: 0,
          totalPnl: 0,
          maxConsecutiveLosses: 0,
          currentConsecutiveLosses: 0,
          winRate: 0
        });
        return;
      }

      // 计算统计数据
      const totalTrades = closedPositions.length;
      const winningTrades = closedPositions.filter(p => p.realized_pnl > 0).length;
      const losingTrades = closedPositions.filter(p => p.realized_pnl < 0).length;
      const totalPnl = closedPositions.reduce((sum, p) => sum + (p.realized_pnl || 0), 0);
      const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

      // 计算连续亏损次数
      let currentConsecutiveLosses = 0;
      let maxConsecutiveLosses = 0;

      for (const position of closedPositions) {
        if (position.realized_pnl < 0) {
          currentConsecutiveLosses++;
          maxConsecutiveLosses = Math.max(maxConsecutiveLosses, currentConsecutiveLosses);
        } else {
          currentConsecutiveLosses = 0;
        }
      }

      // 更新数据库
      this.updatePerformanceStats(symbol, {
        totalTrades,
        winningTrades,
        losingTrades,
        totalPnl,
        maxConsecutiveLosses,
        currentConsecutiveLosses,
        winRate
      });

      systemLogger.warn(`${symbol} 性能统计已更新 - 总交易: ${totalTrades}, 胜率: ${winRate.toFixed(2)}%, 净盈亏: ${totalPnl.toFixed(2)}`);
    } catch (error) {
      systemLogger.error(`更新${symbol}性能统计失败: ${error.message}`);
      // 不抛出错误，避免影响平仓流程
    }
  }

  /**
   * 获取单个设置值
   */
  getSetting(key) {
    try {
      const stmt = this.db.prepare(`
        SELECT value FROM settings WHERE key = ? LIMIT 1
      `);
      const result = stmt.get(key);
      return result ? result.value : null;
    } catch (error) {
      systemLogger.error(`获取设置失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 获取所有设置
   */
  getAllSettings() {
    try {
      const stmt = this.db.prepare(`
        SELECT key, value FROM settings ORDER BY key
      `);
      const results = stmt.all();
      const settings = {};
      results.forEach(row => {
        try {
          settings[row.key] = JSON.parse(row.value);
        } catch (e) {
          settings[row.key] = row.value;
        }
      });
      return settings;
    } catch (error) {
      systemLogger.error(`获取所有设置失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 设置单个值
   */
  setSetting(key, value) {
    try {
      const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
      const existing = this.getSetting(key);

      if (existing) {
        const stmt = this.db.prepare(`
          UPDATE settings SET value = ?, updated_at = datetime('now') WHERE key = ?
        `);
        stmt.run(valueStr, key);
      } else {
        const stmt = this.db.prepare(`
          INSERT INTO settings (key, value) VALUES (?, ?)
        `);
        stmt.run(key, valueStr);
      }

      systemLogger.info(`设置已保存: ${key}`);
      return true;
    } catch (error) {
      systemLogger.error(`设置保存失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 批量设置
   */
  setSettings(settings) {
    try {
      const transaction = this.db.transaction((settingsObj) => {
        for (const [key, value] of Object.entries(settingsObj)) {
          const valueStr = typeof value === 'string' ? value : JSON.stringify(value);

          // 检查设置是否存在
          const stmt = this.db.prepare('SELECT id FROM settings WHERE key = ? LIMIT 1');
          const existing = stmt.get(key);

          if (existing) {
            // 更新现有设置
            const updateStmt = this.db.prepare(`
              UPDATE settings SET value = ?, updated_at = datetime('now') WHERE key = ?
            `);
            updateStmt.run(valueStr, key);
          } else {
            // 插入新设置
            const insertStmt = this.db.prepare(`
              INSERT INTO settings (key, value) VALUES (?, ?)
            `);
            insertStmt.run(key, valueStr);
          }
        }
      });

      transaction(settings);
      systemLogger.info(`批量设置已保存，共${Object.keys(settings).length}项`);
      return true;
    } catch (error) {
      systemLogger.error(`批量设置保存失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 删除设置
   */
  deleteSetting(key) {
    try {
      const stmt = this.db.prepare(`
        DELETE FROM settings WHERE key = ?
      `);
      const result = stmt.run(key);
      systemLogger.info(`设置已删除: ${key}, 影响行数: ${result.changes}`);
      return result.changes > 0;
    } catch (error) {
      systemLogger.error(`删除设置失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 关闭数据库连接
   */
  close() {
    try {
      this.db.close();
      systemLogger.info('数据库连接已关闭');
    } catch (error) {
      systemLogger.error(`关闭数据库连接失败: ${error.message}`);
    }
  }
}

module.exports = TradingDatabase;
