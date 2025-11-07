const cron = require('node-cron');
const { systemLogger } = require('../controllers/logger/Logger');
const { exchange, env } = require('../config');
const exchangeUtils = require('../controllers/exchange/ExchangeUtils');
const technicalAnalysis = require('../controllers/technical/TechnicalAnalysis');
const aiAnalysis = require('../controllers/ai/AIAnalysis');
const riskManagement = require('../controllers/risk/RiskManagement');
const positionCache = require('../controllers/position/PositionCache');
const positionManager = require('../controllers/position/PositionManager');
const networkUtils = require('../controllers/network/NetworkUtils');
const riskMonitor = require('../controllers/position/RiskMonitor');
const TradingDatabase = require('../controllers/database/Database');
const TickerWebSocket = require('../controllers/exchange/TickerWebSocket');

/**
 * 交易引擎 - 替代deepseek.py的主要逻辑
 */
class TradingEngine {
  constructor() {
    this.db = null;
    this.isRunning = false;
    this.exchangeConnected = false;
    this.connectionRetryCount = 0;
    this.maxRetries = 30; // 最多重试30次（约15分钟）
    this.jobs = [];
    this.priceHistory = {};
    this.signalHistory = {};
    this.positions = {};
    this.tradePerformance = {};
    this.portfolioReturns = {};
    this.trendAnalysis = {};
    this.webSocketManager = null;
    this.lastPriceUpdate = 0;
    this.riskMonitorEnabled = env.trading.riskMonitorEnabled;
    this.analysisInProgress = false;  // 防止并发分析
    this.tickerWebSocket = new TickerWebSocket(); // 初始化Ticker WebSocket
    this.marketDataCache = new Map(); // 缓存所有交易对的市场数据
  }

  /**
   * 初始化
   */
  async init() {
    try {
      // 初始化数据库
      this.db = new TradingDatabase();

      // 注入 exchangeUtils（修复：TradingEngine 创建数据库后需要注入 exchangeUtils）
      this.db.setExchangeUtils(exchangeUtils);

      // 初始化并注入风险监控
      riskMonitor.init(this.db, exchangeUtils, positionManager, this.tickerWebSocket);
      systemLogger.info('风险监控模块初始化完成');

      // 设置PositionManager的tickerWebSocket实例
      if (positionManager && typeof positionManager.setTickerWebSocket === 'function') {
        positionManager.setTickerWebSocket(this.tickerWebSocket);
        systemLogger.info('✓ TickerWebSocket实例已传递给PositionManager');
      }

      // 启动 Ticker WebSocket（用于替代 fetchTicker REST API 调用）
      systemLogger.info('正在启动Ticker WebSocket...');
      // 启动前先清理旧缓存
      this.marketDataCache.clear();
      systemLogger.info('✓ 已清理marketDataCache');

      env.trading.symbols.forEach(symbol => {
        this.tickerWebSocket.subscribe(symbol);

        // 注册ticker更新回调，缓存市场数据
        this.tickerWebSocket.onTickerUpdate(symbol, (tickerData) => {
          // 验证数据有效性
          if (!tickerData || !tickerData.symbol) {
            systemLogger.warn('Ticker数据无效，跳过缓存');
            return;
          }

          // 将symbol从 "ETHUSDT" 转换为 "ETH/USDT" 格式
          let formattedSymbol = tickerData.symbol;
          if (tickerData.symbol && tickerData.symbol.endsWith('USDT')) {
            formattedSymbol = tickerData.symbol.replace('USDT', '/USDT');
          }

          // 验证转换后的symbol格式
          if (!formattedSymbol || !formattedSymbol.includes('/USDT')) {
            systemLogger.warn(`Symbol格式错误: ${formattedSymbol}，跳过缓存`);
            return;
          }

          // 验证价格数据
          if (typeof tickerData.price !== 'number' || isNaN(tickerData.price)) {
            systemLogger.error(`❌ 价格数据无效: ${formattedSymbol}, price=${tickerData.price}, 类型=${typeof tickerData.price}`);
            return;
          }

          const marketData = {
            symbol: formattedSymbol,  // 格式化为 "ETH/USDT"
            price: tickerData.price,
            change24h: tickerData.change24h,
            changePercent24h: tickerData.changePercent24h,
            high24h: tickerData.high24h,
            low24h: tickerData.low24h,
            volume24h: tickerData.volume24h,
            timestamp: tickerData.timestamp
          };

          // 使用formattedSymbol作为key，确保唯一性
          this.marketDataCache.set(formattedSymbol, marketData);
        });
      });
      this.tickerWebSocket.connectWithCombinedStreams();
      systemLogger.info('✓ Ticker WebSocket已启动');

      // 启动市场数据广播定时任务（每秒广播所有缓存的数据）
      this.marketBroadcastInterval = setInterval(() => {
        if (this.webSocketManager && this.marketDataCache.size > 0) {
          const allMarketData = Array.from(this.marketDataCache.values());
          this.webSocketManager.sendMarketUpdate(allMarketData);
        }
      }, 2000); // 每2秒广播一次

      // 检查交易所连接
      const connection = await exchangeUtils.checkConnection();
      if (!connection.connected) {
        systemLogger.error(`⚠️ 交易所连接失败: ${connection.message}`);
        systemLogger.warn('⚠️ 服务将在只读模式下运行，交易功能已临时禁用');
        systemLogger.info(`⚠️ 将每30秒自动重试连接 (已重试 ${this.connectionRetryCount}/${this.maxRetries})`);

        // 不抛出错误，继续初始化
      } else {
        this.exchangeConnected = true;
        systemLogger.info('✓ 交易所连接正常');
      }

      return true;
    } catch (error) {
      systemLogger.error(`交易引擎初始化失败: ${error.message}`);
      systemLogger.warn('⚠️ 服务将在只读模式下启动');

      // 即使初始化失败也不抛出，让服务能够启动
      return false;
    }
  }

  /**
   * 启动交易引擎
   */
  start() {
    if (this.isRunning) {
      systemLogger.warn('交易引擎已在运行');
      return;
    }

    this.isRunning = true;

    // 启动前先执行一次同步（从数据库加载持仓）
    this.syncPositions().then(() => {
      systemLogger.info('✓ 初始持仓同步完成');
    }).catch(error => {
      systemLogger.error(`初始持仓同步失败: ${error.message}`);
    });

    // 启动定时任务 - 每3分钟执行一次分析
    const analysisJob = cron.schedule('*/3 * * * *', async () => {
      await this.performAnalysis();
    }, {
      scheduled: false
    });

    this.jobs.push(analysisJob);
    analysisJob.start();

    // 启动连接重试任务 - 每30秒检查一次连接
    const retryJob = cron.schedule('*/30 * * * * *', async () => {
      await this.checkAndReconnect();
    }, {
      scheduled: false
    });

    this.jobs.push(retryJob);
    retryJob.start();

    // 启动持仓同步任务 - 每5分钟检查一次数据库与交易所一致性
    const syncJob = cron.schedule('*/5 * * * *', async () => {
      await this.syncPositions();
    }, {
      scheduled: false
    });

    this.jobs.push(syncJob);
    syncJob.start();

    // 启动价格更新任务 - 每30秒更新一次持仓价格并推送给前端
    const priceUpdateJob = cron.schedule('*/30 * * * * *', async () => {
      await this.updatePositionPricesAndBroadcast();
    }, {
      scheduled: false
    });

    this.jobs.push(priceUpdateJob);
    priceUpdateJob.start();

    // 启动快速风险监控（每60秒检查止盈止损）
    if (this.riskMonitorEnabled) {
      const interval = env.trading.riskMonitorInterval || 60;
      riskMonitor.start(interval);
      systemLogger.info(`✓ 快速风险监控已启动 (每${interval}秒检查)`);
    } else {
      systemLogger.warn('⚠️ 快速风险监控已禁用');
    }

    systemLogger.info('交易引擎已启动');
  }

  /**
   * 停止交易引擎
   */
  stop() {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    this.jobs.forEach(job => job.stop());
    this.jobs = [];

    // 停止风险监控
    riskMonitor.stop();

    systemLogger.info('交易引擎已停止');
  }

  /**
   * 检查并重连交易所
   */
  async checkAndReconnect() {
    if (this.exchangeConnected || this.connectionRetryCount >= this.maxRetries) {
      return;
    }

    try {
      this.connectionRetryCount++;
      systemLogger.info(`正在尝试重新连接交易所 (${this.connectionRetryCount}/${this.maxRetries})...`);

      const connection = await exchangeUtils.checkConnection();
      if (connection.connected) {
        this.exchangeConnected = true;
        this.connectionRetryCount = 0;
        systemLogger.info('✓ 交易所连接已恢复，交易功能已启用');
      } else {
        if (this.connectionRetryCount % 10 === 0) {
          systemLogger.warn(`⚠️ 重连失败: ${connection.message} (${this.connectionRetryCount}/${this.maxRetries})`);
        }
      }
    } catch (error) {
      if (this.connectionRetryCount % 10 === 0) {
        systemLogger.error(`重连时发生错误: ${error.message} (${this.connectionRetryCount}/${this.maxRetries})`);
      }
    }
  }

  /**
   * 同步持仓数据到数据库（优化版）
   * 只有在数据库为空时才从交易所API获取，节省API配额
   */
  async syncPositions() {
    try {
      if (!this.db || !exchangeUtils) {
        systemLogger.warn('数据库或交易所工具未初始化，跳过持仓同步');
        return;
      }

      const result = await positionManager.syncPositionsToDatabase(this.db, exchangeUtils);

      if (result.success) {
        if (result.count > 0) {
          systemLogger.info(`✓ 持仓同步完成: ${result.message}`);
        } else {
          systemLogger.warn(`✓ 持仓同步完成: ${result.message}`);
        }
      } else {
        systemLogger.warn(`⚠️ 持仓同步警告: ${result.message || result.error}`);
      }
    } catch (error) {
      systemLogger.error(`持仓同步失败: ${error.message}`);
    }
  }

  /**
   * 更新持仓价格并通过WebSocket推送给前端（完全依赖WebSocket缓存版）
   * 只在有持仓时更新，使用WebSocket缓存数据，避免REST API调用
   */
  async updatePositionPricesAndBroadcast() {
    try {
      if (!this.db) {
        systemLogger.warn('价格更新: 数据库未初始化，跳过');
        return;
      }
      if (!this.webSocketManager) {
        systemLogger.warn('价格更新: WebSocket未初始化，跳过');
        return;
      }
      if (!this.tickerWebSocket) {
        systemLogger.warn('价格更新: TickerWebSocket未初始化，跳过');
        return;
      }

      // 获取数据库中的所有持仓
      const positions = await this.db.getOpenPositions(true);

      if (positions.length === 0) {
        systemLogger.warn('价格更新: 无持仓，跳过');
        return; // 无持仓时跳过，避免无效API调用
      }

      // 记录更新时间
      this.lastPriceUpdate = Date.now();

      // 使用WebSocket缓存更新价格（避免REST API调用）
      const updatedPositions = [];

      for (const position of positions) {
        const wsTickerData = await this.tickerWebSocket.getTicker(position.symbol);
        if (wsTickerData) {
          const currentPrice = wsTickerData.price;

          // 计算盈亏
          const sideMultiplier = position.side === 'sell' ? -1 : 1;
          const priceDiff = (currentPrice - position.entryPrice) * sideMultiplier;
          const pnl = priceDiff * position.size;
          const pnlPercent = (priceDiff / position.entryPrice) * position.leverage * 100;

          updatedPositions.push({
            ...position,
            currentPrice,
            pnl,
            pnlPercent
          });
        } else {
          // 缓存未就绪，跳过该持仓
          systemLogger.warn(`${position.symbol} WebSocket缓存未就绪，跳过价格更新`);
        }
      }

      // 通过WebSocket推送给前端
      if (updatedPositions.length > 0) {
        this.webSocketManager.sendPositionUpdate(updatedPositions);
        systemLogger.warn(`已通过WebSocket更新 ${updatedPositions.length} 个持仓价格`);
      }

    } catch (error) {
      systemLogger.error(`价格更新失败: ${error.message}`);
      systemLogger.error(`错误堆栈: ${error.stack}`);
    }
  }

  /**
   * 执行市场分析
   */
  async performAnalysis() {
    // 防止并发分析
    if (this.analysisInProgress) {
      systemLogger.warn('⚠️ 分析正在进行中，跳过本次触发');
      return;
    }

    this.analysisInProgress = true;

    try {
      for (const symbol of env.trading.symbols) {
        try {
          await this.analyzeSymbol(symbol);
        } catch (error) {
          systemLogger.error(`${symbol} 分析失败: ${error.message}`);
        }
      }
    } finally {
      // 确保总是重置标志
      this.analysisInProgress = false;
    }
  }

  /**
   * 分析单个符号
   */
  async analyzeSymbol(symbol) {
    let kline3m, kline15m, kline4h;

    try {
      // 1. 获取K线数据 - 如果失败会直接抛出异常
      systemLogger.warn(`${symbol} 开始获取K线数据...`);
      kline3m = await exchangeUtils.getOHLCVWithRetry(symbol, '3m', 50);
      kline15m = await exchangeUtils.getOHLCVWithRetry(symbol, '15m', 100);
      kline4h = await exchangeUtils.getOHLCVWithRetry(symbol, '4h', 100);

      // 2. 获取当前价格（优先使用WebSocket缓存）
      const wsTickerData = await this.tickerWebSocket.getTicker(symbol);
      if (!wsTickerData) {
        // 缓存未就绪，静默跳过分析
        systemLogger.warn(`${symbol} WebSocket缓存未就绪，跳过分析`);
        return;
      }

      // 检查价格数据是否有效
      if (!wsTickerData.price || isNaN(wsTickerData.price)) {
        systemLogger.error(`${symbol} 价格数据无效: ${wsTickerData.price}，跳过分析`);
        return;
      }

      const ticker = {
        symbol: wsTickerData.symbol,
        last: wsTickerData.price,
        change: wsTickerData.change24h,
        percentage: wsTickerData.changePercent24h,
        high: wsTickerData.high24h,
        low: wsTickerData.low24h,
        volume: wsTickerData.volume24h,
        baseVolume: wsTickerData.volume24h,
        timestamp: wsTickerData.timestamp
      };
      systemLogger.warn(`${symbol} 使用WebSocket缓存价格，转换后 ticker.last=${ticker.last}`);

      // 3. 准备完整的价格数据
      const priceData = {
        symbol,
        price: ticker.last,
        timestamp: ticker.timestamp,
        high: ticker.high,
        low: ticker.low,
        volume: ticker.volume,
        price_change: ticker.percentage,
        klineData: kline3m.slice(-5).map(k => ({
          timestamp: k[0],
          open: k[1],
          high: k[2],
          low: k[3],
          close: k[4],
          volume: k[5]
        }))
      };

      // 4. 执行技术分析
      const multiTimeframeAnalysis = technicalAnalysis.getMultiTimeframeAnalysis(
        symbol,
        this.trendAnalysis,
        kline15m,
        kline4h
      );

      // 5. 执行AI分析 - 如果失败会直接抛出异常
      systemLogger.warn(`${symbol} 开始AI分析...`);
      const signalData = await aiAnalysis.analyzeWithAI(
        priceData,
        this.priceHistory,
        this.signalHistory,
        this.tradePerformance,
        this.portfolioReturns
      );

      if (signalData) {
        // 记录AI信号
        this.signalHistory[symbol] = this.signalHistory[symbol] || [];
        this.signalHistory[symbol].push(signalData);

        if (this.signalHistory[symbol].length > 50) {
          this.signalHistory[symbol].shift();
        }

        // 注意：AI信号已经由AIAnalysis模块保存到数据库，无需重复保存

        // 执行交易
        await this.executeTrade(signalData, priceData);

        // 发送详细日志到Web UI
        await networkUtils.sendLogToWebUI(
          'info',
          symbol,
          'ai_analysis',
          `${symbol} 交易分析\n交易信号: ${signalData.signal}\n信心程度: ${signalData.confidence}\n理由: ${signalData.reason}`,
          true,
          signalData
        );
      }
    } catch (error) {
      // 区分不同类型的错误：
      // - 如果错误有isDataFetchError标记，说明是数据获取失败（已在ExchangeUtils中记录）
      // - 如果错误信息包含"AI"或"analyze"，说明是AI分析失败
      // - 其他情况统称为数据获取或处理失败

      if (error.isDataFetchError) {
        // 数据获取失败已在ExchangeUtils中记录，无需重复记录
        // 静默处理，避免重复错误信息
      } else if (error.message.toLowerCase().includes('ai') || error.message.toLowerCase().includes('analyze')) {
        systemLogger.error(`${symbol} AI分析失败: ${error.message}`);
      } else {
        systemLogger.error(`${symbol} 数据处理失败: ${error.message}`);
      }
    }
  }

  /**
   * 执行交易
   */
  async executeTrade(signalData, priceData) {
    const symbol = priceData.symbol;
    const events = [];

    systemLogger.info(`${symbol} 交易分析`);
    systemLogger.info(`交易信号: ${signalData.signal}`);
    systemLogger.info(`信心程度: ${signalData.confidence}`);
    systemLogger.info(`理由: ${signalData.reason}`);

    // 如果交易所未连接，只记录分析结果，不执行交易
    if (!this.exchangeConnected) {
      systemLogger.warn(`⚠️ 交易所未连接，跳过${symbol}的实际交易执行`);
      return events;
    }

    // 如果禁用自动交易，只记录
    if (!env.trading.autoTrade) {
      systemLogger.warn('⚠️ 自动交易已禁用，未执行交易');
      return events;
    }

    // 获取当前持仓
    let currentPosition = positionCache.get(symbol);
    if (!currentPosition) {
      currentPosition = await exchangeUtils.getCurrentPosition(symbol);
      if (currentPosition) {
        positionCache.set(symbol, currentPosition);
      }
    }

    // DeepSeek多层次风险控制策略
    if (currentPosition) {
      const positions = Array.isArray(currentPosition) ? currentPosition : [currentPosition];

      for (const position of positions) {
        const currentPrice = priceData.price;
        // 设置当前价格到position对象
        position.currentPrice = currentPrice;

        // 多层风险控制检查
        const shouldClose = await this.checkRiskControls(position, priceData, signalData);

        if (shouldClose) {
          const result = await positionManager.closePosition(position, 'risk_control', this.db);
          if (result.success) {
            events.push({
              type: 'close',
              symbol,
              action: 'close_position',
              message: '风险控制平仓',
              success: true,
              pnl: result.pnl
            });

            // 更新交易性能
            riskManagement.updateTradePerformance(symbol, this.tradePerformance[symbol], {
              signal: signalData.signal,
              pnl: result.pnl
            });
          }
        }
      }
    } else {
      // 没有持仓时检查是否开仓
      if (signalData.signal === 'BUY' || signalData.signal === 'SELL') {
        const side = signalData.signal === 'BUY' ? 'long' : 'short';
        await this.openPosition(symbol, side, priceData, signalData);
      }
    }

    return events;
  }

  /**
   * 检查风险控制
   */
  async checkRiskControls(position, priceData, signalData) {
    const currentPrice = priceData.price;

    // 第一层：失效条件检查
    const invalidationLevel = env.trading.invalidationLevels[position.symbol] || 0;
    if (currentPrice < invalidationLevel && position.side === 'long') {
      systemLogger.info(`${position.symbol} 价格跌破失效阈值，平仓`);
      return true;
    }

    // 第二层：趋势冲突检测
    const trendData = this.trendAnalysis[position.symbol];
    if (trendData && trendData['15m']) {
      if (position.side === 'long' && trendData['15m'].trend === 'BEARISH') {
        systemLogger.info(`${position.symbol} 15分钟趋势转空，平仓`);
        return true;
      }
      if (position.side === 'short' && trendData['15m'].trend === 'BULLISH') {
        systemLogger.info(`${position.symbol} 15分钟趋势转多，平仓`);
        return true;
      }
    }

    // 第三层：AI止损检查
    if (signalData.stopLoss) {
      if (position.side === 'long' && currentPrice <= signalData.stopLoss) {
        systemLogger.info(`${position.symbol} 触发AI止损，平仓`);
        return true;
      }
      if (position.side === 'short' && currentPrice >= signalData.stopLoss) {
        systemLogger.info(`${position.symbol} 触发AI止损，平仓`);
        return true;
      }
    }

    // 第四层：止盈检查（独立执行，任意满足即止盈）
    // AI动态止盈
    if (env.trading.takeProfitEnabled && signalData.takeProfit) {
      if (position.side === 'long' && currentPrice >= signalData.takeProfit) {
        systemLogger.info(`${position.symbol} 触发AI止盈，平仓`);
        return true;
      }
      if (position.side === 'short' && currentPrice <= signalData.takeProfit) {
        systemLogger.info(`${position.symbol} 触发AI止盈，平仓`);
        return true;
      }
    }

    // 固定百分比止盈（独立检查，即使AI提供了止盈也会检查）
    if (env.trading.takeProfitEnabled && env.trading.takeProfitPercentage > 0) {
      const fixedTakeProfit = position.side === 'long'
        ? position.entryPrice * (1 + env.trading.takeProfitPercentage)
        : position.entryPrice * (1 - env.trading.takeProfitPercentage);

      if (position.side === 'long' && currentPrice >= fixedTakeProfit) {
        systemLogger.info(`${position.symbol} 触发固定止盈（${(env.trading.takeProfitPercentage * 100).toFixed(2)}%），平仓`);
        return true;
      }
      if (position.side === 'short' && currentPrice <= fixedTakeProfit) {
        systemLogger.info(`${position.symbol} 触发固定止盈（${(env.trading.takeProfitPercentage * 100).toFixed(2)}%），平仓`);
        return true;
      }
    }

    // 第五层：传统止损检查
    const threshold = env.trading.holdThreshold;
    const entryPrice = position.entryPrice;
    const unrealizedPnl = position.unrealizedPnl;

    if (position.side === 'long') {
      const lossPercentage = (entryPrice - currentPrice) / entryPrice;
      if (lossPercentage > (1 - threshold)) {
        systemLogger.info(`${position.symbol} 触发传统止损，平仓`);
        return true;
      }
    } else {
      const lossPercentage = (currentPrice - entryPrice) / entryPrice;
      if (lossPercentage > (1 - threshold)) {
        systemLogger.info(`${position.symbol} 触发传统止损，平仓`);
        return true;
      }
    }

    return false;
  }

  /**
   * 开仓 - 完全参照ExchangeUtils.closePosition()的逻辑
   * 优化版本 - 添加精度错误重试机制
   */
  async openPosition(symbol, side, priceData, signalData) {
    // 先转换symbol格式
    // Binance需要特殊处理：Symbol需要是 BTCUSDT 格式（不带/和:）
    let binanceSymbol = symbol;
    if (env.exchange.type === 'binance' || symbol.includes('/')) {
      binanceSymbol = symbol.replace('/', '').replace(':USDT', '');
    }

    // Binance创建订单需要使用 BUY/SELL 而不是 long/short
    const orderSide = side === 'long' ? 'BUY' : 'SELL';
    const orderSideLower = orderSide.toLowerCase();

    // 计算开仓数量
    const amount = env.trading.amountUsd * env.trading.leverage / priceData.price;

    // 币种特定精度配置 - 调整ETH/USDT为更安全的精度
    const symbolPrecisionMap = {
      'BTC/USDT': { decimals: 5, minAmount: 0.001 },
      'ETH/USDT': { decimals: 3, minAmount: 0.001 }, // 从4位调整为3位，更安全
      'SOL/USDT': { decimals: 2, minAmount: 0.01 },
      'XRP/USDT': { decimals: 1, minAmount: 1 },
      'BNB/USDT': { decimals: 4, minAmount: 0.01 },
      'ADA/USDT': { decimals: 1, minAmount: 1 },
      'DOGE/USDT': { decimals: 0, minAmount: 100 },
      'MATIC/USDT': { decimals: 1, minAmount: 1 },
      'DOT/USDT': { decimals: 2, minAmount: 0.1 },
      'AVAX/USDT': { decimals: 3, minAmount: 0.01 },
      'LINK/USDT': { decimals: 2, minAmount: 0.1 },
      'UNI/USDT': { decimals: 2, minAmount: 0.1 },
      'LTC/USDT': { decimals: 4, minAmount: 0.01 },
      'BCH/USDT': { decimals: 4, minAmount: 0.01 },
      'XLM/USDT': { decimals: 1, minAmount: 1 },
      'VET/USDT': { decimals: 1, minAmount: 1 },
      'FIL/USDT': { decimals: 3, minAmount: 0.01 },
      'TRX/USDT': { decimals: 1, minAmount: 1 },
      'EOS/USDT': { decimals: 2, minAmount: 0.1 },
      'XMR/USDT': { decimals: 4, minAmount: 0.01 },
      'ALGO/USDT': { decimals: 2, minAmount: 0.1 },
      'ATOM/USDT': { decimals: 3, minAmount: 0.01 },
      'FTM/USDT': { decimals: 1, minAmount: 1 },
      'NEAR/USDT': { decimals: 2, minAmount: 0.1 },
      'SUI/USDT': { decimals: 2, minAmount: 0.1 },
      'APT/USDT': { decimals: 3, minAmount: 0.01 },
      'ARB/USDT': { decimals: 2, minAmount: 0.1 },
      'OP/USDT': { decimals: 2, minAmount: 0.1 },
      'WIF/USDT': { decimals: 3, minAmount: 0.01 },
      'PEPE/USDT': { decimals: 0, minAmount: 1000000 },
      'SHIB/USDT': { decimals: 0, minAmount: 1000000 },
      'FLOKI/USDT': { decimals: 0, minAmount: 100000 }
    };

    let formattedAmount;
    const precision = symbolPrecisionMap[symbol] || { decimals: 4, minAmount: 0.01 };

    // 最简单直接的方法：使用币种特定精度
    const multiplier = Math.pow(10, precision.decimals);
    const flooredAmount = Math.floor(amount * multiplier) / multiplier;

    // 确保不低于最小交易量
    const finalAmount = Math.max(flooredAmount, precision.minAmount);
    formattedAmount = finalAmount.toFixed(precision.decimals);

    // 移除尾部零
    if (formattedAmount.includes('.')) {
      formattedAmount = formattedAmount.replace(/\.?0+$/, '');
    }

    systemLogger.info(`${symbol} 使用币种特定精度: ${amount} -> ${formattedAmount} (精度:${precision.decimals}, 最小:${precision.minAmount})`);

    const numericAmount = parseFloat(formattedAmount);
    systemLogger.info(`📋 尝试开仓: symbol=${binanceSymbol}, side=${orderSide}, quantity=${numericAmount}, leverage=${env.trading.leverage}`);

    // 完全参照closePosition的下单逻辑
    const orderParams = {
      symbol: binanceSymbol,
      side: orderSide,
      type: 'MARKET',
      quantity: numericAmount,
      leverage: env.trading.leverage.toString(),
      marginMode: 'ISOLATED',
      positionSide: side.toUpperCase() // LONG 或 SHORT
    };

    try {
      // 使用ccxt的私有API方法直接调用（参照closePosition）
      const order = await exchange.fapiPrivatePostOrder(orderParams);

      // 保存到数据库
      const amountForDb = parseFloat(formattedAmount);
      this.db.savePosition({
        symbol,
        side: orderSideLower,
        size: amountForDb,
        entryPrice: priceData.price,
        entryTime: new Date().toISOString(),
        aiStopLoss: signalData.stopLoss,
        aiTakeProfit: signalData.takeProfit,
        leverage: env.trading.leverage,
        margin: amountForDb / env.trading.leverage
      });

      this.db.addTradeLog({
        symbol,
        action: 'open_position',
        side: orderSideLower,
        size: amountForDb,
        price: priceData.price,
        details: {
          leverage: env.trading.leverage,
          take_profit_price: signalData.takeProfit,
          stop_loss_price: signalData.stopLoss
        },
        message: `开仓: ${signalData.reason}`,
        success: true
      });

      systemLogger.info(`${symbol} 开仓成功: ${side} ${amountForDb}`);

      // 清除缓存
      positionCache.clear(symbol);

      return {
        success: true,
        id: order.orderId,
        symbol: symbol,
        side: side,
        amount: amountForDb,
        type: 'market',
        price: priceData.price,
        timestamp: order.transactTime || Date.now(),
        exchange_result: order
      };
    } catch (error) {
      systemLogger.error(`${symbol} 开仓失败: ${error.message}`);

      // 如果是精度错误，记录详细日志
      if (error.message && (error.message.includes('Precision is over the maximum') || error.code === -1111)) {
        systemLogger.error(`${symbol} 币种特定精度也失败，请检查配置！`);
        systemLogger.error(`错误详情: ${error.message}`);
        systemLogger.error(`尝试的数量: ${numericAmount} (${formattedAmount})`);
        systemLogger.error(`建议: 在symbolPrecisionMap中调整${symbol}的精度配置（当前:${precision.decimals}位, 最小:${precision.minAmount}）`);
        systemLogger.error(`参考: ETH/USDT精度已从4位调整为3位，如果仍失败可继续降低到2位`);
      }

      this.db.addTradeLog({
        symbol,
        action: 'open_position',
        side: orderSideLower,
        message: `开仓失败: ${error.message}`,
        success: false
      });
      throw error;
    }
  }

  /**
   * 获取引擎状态
   */
  getStatus() {
    const tickerStatus = this.tickerWebSocket ? this.tickerWebSocket.getStatus() : null;

    return {
      running: this.isRunning,
      exchangeConnected: this.exchangeConnected,
      connectionRetryCount: this.connectionRetryCount,
      maxRetries: this.maxRetries,
      symbols: env.trading.symbols,
      autoTrade: env.trading.autoTrade,
      tickerWebSocket: tickerStatus,
      priceHistoryCount: Object.keys(this.priceHistory).length,
      signalHistoryCount: Object.keys(this.signalHistory).length
    };
  }

  /**
   * 关闭
   */
  async close() {
    this.stop();
    if (this.marketBroadcastInterval) {
      clearInterval(this.marketBroadcastInterval);
    }
    if (this.tickerWebSocket) {
      this.tickerWebSocket.close();
    }
    if (this.db) {
      this.db.close();
    }
    systemLogger.info('交易引擎已关闭');
  }

  /**
   * 设置WebSocket管理器
   */
  setWebSocketManager(manager) {
    this.webSocketManager = manager;
  }

  /**
   * 广播位置更新
   */
  broadcastPositionUpdate() {
    if (this.webSocketManager) {
      this.webSocketManager.sendPositionUpdate(this.positions);
    }
  }

  /**
   * 广播交易更新
   */
  broadcastTradeUpdate() {
    if (this.webSocketManager) {
      this.webSocketManager.sendTradeUpdate(this.tradePerformance);
    }
  }

  /**
   * 广播AI信号
   */
  broadcastAiSignal(symbol, signalData) {
    if (this.webSocketManager && symbol && this.signalHistory[symbol]) {
      this.webSocketManager.sendAiSignal(this.signalHistory[symbol]);
    }
  }
}

module.exports = TradingEngine;
