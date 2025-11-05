const WebSocket = require('ws');
const { systemLogger } = require('../logger/Logger');
const { env } = require('../../config');

/**
 * Binance Ticker WebSocket 管理器
 * 使用组合数据流（Combined Streams）订阅多个交易对的ticker数据，替代CCXT的REST API调用
 *
 * 参考: binance_websocket.txt
 * - 使用 /stream?streams=btcusdt@ticker/ethusdt@ticker/... 格式
 * - WebSocket服务器每20秒发送PING帧
 * - 单个连接最多可订阅1024个Streams
 * - 连接有效期不超过24小时
 */
class TickerWebSocket {
  constructor() {
    this.ws = null;
    this.isConnected = false;
    this.isConnecting = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 50;
    this.reconnectDelay = 5000; // 5秒
    this.subscribedSymbols = new Set();
    this.tickerCache = new Map(); // symbol -> ticker data
    this.lastUpdate = new Map(); // symbol -> timestamp
    this.callbacks = new Map(); // symbol -> [callbacks]
    this.heartbeatInterval = null;
    this.lastPingTime = null;
    this.pingTimeout = null; // PING超时定时器
    this.messageId = 1; // 用于订阅请求的自增ID
    this.baseUrl = this.getWebSocketUrl(); // 根据交易所选择URL
  }

  /**
   * 获取WebSocket URL（期货或现货）
   */
  getWebSocketUrl() {
    if (env.exchange.type === 'binance') {
      // 期货: wss://fstream.binance.com/stream?streams=...
      return 'wss://fstream.binance.com/stream';
    }
    // 现货: wss://stream.binance.com:9443/stream?streams=...
    return 'wss://stream.binance.com:9443/stream';
  }

  /**
   * 连接Binance WebSocket
   * 使用组合数据流格式：wss://fstream.binance.com/stream?streams=btcusdt@ticker/ethusdt@ticker
   */
  connect() {
    if (this.isConnected || this.isConnecting) {
      return;
    }

    this.isConnecting = true;

    try {
      // 构建WebSocket URL - 使用组合数据流
      const wsUrl = this.baseUrl;
      systemLogger.info(`正在连接Binance WebSocket: ${wsUrl}`);

      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        systemLogger.info('✓ Binance WebSocket连接成功');
        this.isConnected = true;
        this.isConnecting = false;
        this.reconnectAttempts = 0;

        // 清除PING超时定时器
        this.clearPingTimeout();

        // 重连成功后，重新订阅所有symbols
        if (this.subscribedSymbols.size > 0) {
          this.resubscribeAll();
        }
      });

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());

          // 记录最后收到数据的时间
          this.lastPingTime = Date.now();
          this.clearPingTimeout();

          // 处理组合数据流格式: {"stream": "btcusdt@ticker", "data": {...}}
          if (message.stream && message.data) {
            // 处理ticker数据 - 组合数据流格式
            if (message.data.e === '24hrTicker') {
              this.handleTickerUpdate(message.data);
            }
            // 处理订阅确认响应
            else if (message.data.result === null) {
              systemLogger.warn(`订阅确认: ${message.stream}`);
            }
            return;
          }

          // 处理单独的PING消息（旧版格式）
          if (message.ping) {
            this.handlePing(message.ping);
            return;
          }

          // 处理PONG响应
          if (message.pong) {
            systemLogger.warn('收到PONG响应');
            return;
          }

          // 处理ticker数据（非组合流格式）
          if (message.e === '24hrTicker') {
            this.handleTickerUpdate(message);
          }

        } catch (error) {
          systemLogger.error(`WebSocket消息解析失败: ${error.message}`);
        }
      });

      this.ws.on('error', (error) => {
        systemLogger.error(`Binance WebSocket错误: ${error.message}`);
      });

      this.ws.on('close', (code, reason) => {
        systemLogger.warn(`Binance WebSocket连接已关闭 (code: ${code}, reason: ${reason})`);
        this.isConnected = false;
        this.clearPingTimeout();
        this.ws = null;

        // 尝试重连
        this.scheduleReconnect();
      });

    } catch (error) {
      systemLogger.error(`连接Binance WebSocket失败: ${error.message}`);
      this.isConnecting = false;
      this.scheduleReconnect();
    }
  }

  /**
   * 处理PING帧 - 必须立即回复PONG
   * 根据文档：WebSocket服务器每20秒发送PING帧
   * 客户端必须在1分钟内回复PONG，否则连接会被断开
   */
  handlePing(pingTimestamp) {
    try {
      // 立即回复PONG，payload需要和PING消息一致
      const pongMessage = JSON.stringify({ pong: pingTimestamp });
      this.ws.send(pongMessage);
      systemLogger.warn('PING已回复PONG');

      // 重置PING超时定时器
      this.setPingTimeout();
    } catch (error) {
      systemLogger.error(`发送PONG失败: ${error.message}`);
    }
  }

  /**
   * 设置PING超时定时器（60秒未收到PING则认为断线）
   */
  setPingTimeout() {
    this.clearPingTimeout();
    this.pingTimeout = setTimeout(() => {
      systemLogger.warn('60秒内未收到WebSocket数据，判定连接已断开');
      this.reconnect();
    }, 60000);
  }

  /**
   * 清除PING超时定时器
   */
  clearPingTimeout() {
    if (this.pingTimeout) {
      clearTimeout(this.pingTimeout);
      this.pingTimeout = null;
    }
  }

  /**
   * 处理ticker更新
   */
  handleTickerUpdate(ticker) {
    const symbol = ticker.s; // e.g., 'BTCUSDT'

    // 验证关键价格字段
    const price = parseFloat(ticker.c);
    if (isNaN(price)) {
      systemLogger.error(`❌ 收到无效价格数据，跳过处理: symbol=${symbol}, price=${ticker.c}, ticker.c类型=${typeof ticker.c}`);
      return;
    }

    const data = {
      symbol,
      price: price, // last price
      change24h: parseFloat(ticker.p) || 0, // price change
      changePercent24h: parseFloat(ticker.P) || 0, // price change percent
      high24h: parseFloat(ticker.h) || 0, // high price
      low24h: parseFloat(ticker.l) || 0, // low price
      volume24h: parseFloat(ticker.v) || 0, // volume
      quoteVolume24h: parseFloat(ticker.q) || 0, // quote volume
      timestamp: ticker.E || Date.now(), // event time
      // 兼容性字段
      price_change: parseFloat(ticker.P) || 0 // 同 changePercent24h
    };

    // 更新缓存
    this.tickerCache.set(symbol, data);
    this.lastUpdate.set(symbol, Date.now());

    // 触发回调
    const callbacks = this.callbacks.get(symbol) || [];
    callbacks.forEach(cb => {
      try {
        cb(data);
      } catch (error) {
        systemLogger.error(`执行ticker回调失败: ${error.message}`);
      }
    });
  }

  /**
   * 订阅单个symbol的ticker（记录到列表，使用组合流订阅）
   * 组合数据流格式: /stream?streams=btcusdt@ticker/ethusdt@ticker
   * 注意：单个连接最多可以订阅1024个Streams
   */
  subscribe(symbol) {
    const cleanSymbol = symbol.replace('/', '').replace(':USDT', '');
    this.subscribedSymbols.add(cleanSymbol);

    systemLogger.warn(`已添加 ${cleanSymbol} 到订阅列表`);

    // 如果已连接，重新建立连接以使用组合流
    if (this.isConnected) {
      this.reconnect();
    }
  }

  /**
   * 批量订阅多个symbols
   */
  subscribeMultiple(symbols) {
    symbols.forEach(symbol => this.subscribe(symbol));
  }

  /**
   * 建立组合数据流连接
   * 使用URL格式: /stream?streams=btcusdt@ticker/ethusdt@ticker
   */
  connectWithCombinedStreams() {
    if (this.subscribedSymbols.size === 0) return;

    // 构建组合流URL
    const streams = Array.from(this.subscribedSymbols)
      .map(s => s.toLowerCase() + '@ticker')
      .join('/');

    const wsUrl = `${this.baseUrl}?streams=${streams}`;

    this.ws = new WebSocket(wsUrl);

    this.ws.on('open', () => {
      systemLogger.info(`✓ 已订阅 ${this.subscribedSymbols.size} 个交易对的ticker实时更新`);
      this.isConnected = true;
      this.isConnecting = false;
      this.reconnectAttempts = 0;
      this.setPingTimeout();
    });

    this.ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        this.lastPingTime = Date.now();
        this.clearPingTimeout();

        if (message.stream && message.data && message.data.e === '24hrTicker') {
          this.handleTickerUpdate(message.data);
        }
      } catch (error) {
        systemLogger.error(`组合流消息解析失败: ${error.message}`);
      }
    });

    this.ws.on('error', (error) => {
      systemLogger.error(`组合流WebSocket错误: ${error.message}`);
    });

    this.ws.on('close', (code, reason) => {
      systemLogger.warn(`组合流WebSocket连接已关闭 (code: ${code})`);
      this.isConnected = false;
      this.clearPingTimeout();
      this.ws = null;
      this.scheduleReconnect();
    });
  }

  /**
   * 获取ticker数据（优先使用缓存，失败时从REST API获取）
   */
  async getTicker(symbol) {
    const cleanSymbol = symbol.replace('/', '').replace(':USDT', '');
    const cachedData = this.tickerCache.get(cleanSymbol);

    // 添加详细调试日志
    if (!cachedData) {
      systemLogger.warn(`[getTicker] ${symbol}: 缓存中无数据`);
      return null;
    }

    const lastUpdateTime = this.lastUpdate.get(cleanSymbol);
    const age = Date.now() - lastUpdateTime;

    // 如果缓存中有数据且在30秒内，返回缓存数据
    if (age < 30000) {
      return cachedData;
    }

    // 缓存已过期
    systemLogger.warn(`[getTicker] ${symbol}: 缓存已过期 (age=${age}ms)`);
    return null;
  }

  /**
   * 注册ticker更新回调
   */
  onTickerUpdate(symbol, callback) {
    const cleanSymbol = symbol.replace('/', '').replace(':USDT', '');

    if (!this.callbacks.has(cleanSymbol)) {
      this.callbacks.set(cleanSymbol, []);
    }
    this.callbacks.get(cleanSymbol).push(callback);
  }

  /**
   * 调度重连（指数退避策略）
   */
  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      systemLogger.error('达到最大重连次数，停止重连');
      return;
    }

    this.reconnectAttempts++;
    // 指数退避：5s, 10s, 20s, 40s, 80s...
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 120000);
    systemLogger.info(`${delay / 1000}秒后尝试重连 (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

    setTimeout(() => {
      if (this.subscribedSymbols.size > 0) {
        this.connectWithCombinedStreams();
      }
    }, delay);
  }

  /**
   * 强制重连（关闭现有连接并重新建立）
   */
  reconnect() {
    if (this.ws) {
      this.ws.close();
    }
    this.ws = null;

    // 重连时清理旧缓存，避免脏数据
    this.tickerCache.clear();
    this.lastUpdate.clear();
    systemLogger.info('✓ 重连时已清理TickerWebSocket缓存');

    if (this.subscribedSymbols.size > 0) {
      this.connectWithCombinedStreams();
    }
  }

  /**
   * 关闭WebSocket
   */
  close() {
    this.clearPingTimeout();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.isConnected = false;
    this.isConnecting = false;
    this.subscribedSymbols.clear();

    // 清理所有缓存和回调
    this.tickerCache.clear();
    this.lastUpdate.clear();
    this.callbacks.clear();

    systemLogger.info('✓ Binance WebSocket已关闭，缓存已清理');
  }

  /**
   * 获取连接状态
   */
  getStatus() {
    return {
      connected: this.isConnected,
      subscribedCount: this.subscribedSymbols.size,
      cacheSize: this.tickerCache.size,
      reconnectAttempts: this.reconnectAttempts
    };
  }
}

module.exports = TickerWebSocket;
