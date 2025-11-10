const WebSocket = require('ws');
const { systemLogger } = require('../logger/Logger');

/**
 * WebSocket管理器
 * 负责管理所有WebSocket客户端连接和广播消息
 */
class WebSocketManager {
  constructor() {
    this.wss = null;
    this.clients = new Set();
  }

  /**
   * 初始化WebSocket服务器
   */
  init(server) {
    this.wss = new WebSocket.Server({ server, path: '/ws' });

    this.wss.on('connection', (ws) => {
      systemLogger.info('新的WebSocket客户端已连接');
      this.clients.add(ws);

      // 发送欢迎消息
      ws.send(JSON.stringify({
        type: 'connection',
        message: '已连接到DeepTrade WebSocket服务器'
      }));

      // 处理客户端消息
      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message);
          systemLogger.info(`收到WebSocket消息: ${JSON.stringify(data)}`);
        } catch (error) {
          systemLogger.error(`WebSocket消息解析错误: ${error.message}`);
        }
      });

      // 处理客户端断开
      ws.on('close', () => {
        systemLogger.info('WebSocket客户端已断开连接');
        this.clients.delete(ws);
      });

      // 处理错误
      ws.on('error', (error) => {
        systemLogger.error(`WebSocket错误: ${error.message}`);
        this.clients.delete(ws);
      });
    });

    systemLogger.info('✓ WebSocket服务器初始化完成');
  }

  /**
   * 广播消息到所有客户端
   */
  broadcast(type, data) {
    const message = JSON.stringify({ type, data, timestamp: Date.now() });
    let successCount = 0;
    let failCount = 0;

    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(message);
          successCount++;
        } catch (error) {
          systemLogger.error(`WebSocket广播错误: ${error.message}`);
          failCount++;
          this.clients.delete(client);
        }
      } else {
        failCount++;
        this.clients.delete(client);
      }
    });
  }

  /**
   * 发送位置更新
   */
  sendPositionUpdate(positions) {
    // 确保 positions 是数组格式
    const positionsArray = Array.isArray(positions) ? positions : [positions];

    // 记录要推送的数据（最多5条，避免日志过多）
    const logData = positionsArray.slice(0, 5).map(pos => ({
      symbol: pos.symbol,
      currentPrice: pos.currentPrice,
      pnl: pos.pnl,
      pnlPercent: pos.pnlPercent
    }));

    this.broadcast('position_update', positions);
  }

  /**
   * 发送交易更新
   */
  sendTradeUpdate(trades) {
    this.broadcast('trade_update', trades);
  }

  /**
   * 发送AI信号
   */
  sendAiSignal(signals) {
    this.broadcast('ai_signal', signals);
  }

  /**
   * 发送市场数据更新（支持单个或数组）
   */
  sendMarketUpdate(marketData) {
    // 确保数据是数组格式
    const data = Array.isArray(marketData) ? marketData : [marketData];
    this.broadcast('market_update', data);
  }

  /**
   * 发送错误信息
   */
  sendError(error) {
    this.broadcast('error', { message: error });
  }

  /**
   * 获取活跃客户端数量
   */
  getClientCount() {
    return this.clients.size;
  }

  /**
   * 关闭WebSocket服务器
   */
  close() {
    if (this.wss) {
      this.clients.forEach((client) => {
        client.close();
      });
      this.clients.clear();
      this.wss.close(() => {
        systemLogger.info('WebSocket服务器已关闭');
      });
    }
  }
}

module.exports = WebSocketManager;
