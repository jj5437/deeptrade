/**
 * DeepTrade Backend 入口文件
 * 启动API服务器和交易引擎
 */

// 清除 require 缓存以确保使用最新代码
Object.keys(require.cache).forEach(key => {
  if (key.includes('/src/controllers/')) {
    delete require.cache[key];
  }
});

const APIServer = require('./server');
const TradingEngine = require('./services/TradingEngine');
const TradingDatabase = require('./controllers/database/Database');
const exchangeUtils = require('./controllers/exchange/ExchangeUtils');
const aiAnalysis = require('./controllers/ai/AIAnalysis');
const { systemLogger } = require('./controllers/logger/Logger');
const { env } = require('./config');

// 导入路由模块以设置数据库
const positionsRoutes = require('./routes/api/positions');
const tradesRoutes = require('./routes/api/trades');
const analysisRoutes = require('./routes/api/analysis');
const statsRoutes = require('./routes/api/stats');
const configRoutes = require('./routes/api/config');
const marketRoutes = require('./routes/api/market');
const accountRoutes = require('./routes/api/account');

// 设置控制台输出编码
if (process.platform === 'win32') {
  const util = require('util');
  const originalStdout = process.stdout;
  const originalStderr = process.stderr;

  process.stdout.write = function(string, encoding, fd) {
    originalStdout.write(string, encoding || 'utf8');
  };

  process.stderr.write = function(string, encoding, fd) {
    originalStderr.write(string, encoding || 'utf8');
  };
}

async function main() {
  try {
    systemLogger.info('===========================================');
    systemLogger.info('  DeepTrade Backend 启动中...');
    systemLogger.info('===========================================');

    // 初始化数据库
    const db = new TradingDatabase();
    systemLogger.info('✓ 数据库初始化完成');

    // 将交易所工具注入数据库
    db.setExchangeUtils(exchangeUtils);
    systemLogger.info('✓ 交易所工具已注入数据库');

    // 将数据库注入交易所工具
    exchangeUtils.setDatabase(db);
    systemLogger.info('✓ 数据库已注入交易所工具');

    // 初始化交易引擎
    const tradingEngine = new TradingEngine();
    await tradingEngine.init();
    systemLogger.info('✓ 交易引擎初始化完成');

    // 启动API服务器
    systemLogger.info('正在初始化API服务器...');
    const apiServer = new APIServer();
    systemLogger.info('✓ API服务器实例创建成功');

    systemLogger.info('正在启动API服务器...');
    await apiServer.start();
    systemLogger.info('✓ API服务器启动完成');

    // 连接路由和数据库
    const routes = apiServer.getApp()._router;
    routes.stack.forEach(layer => {
      if (layer.route && layer.route.path && layer.route.path.includes('/api')) {
        const routeModule = layer.route.stack[0].handle;
        if (routeModule && typeof routeModule.setDatabase === 'function') {
          routeModule.setDatabase(db);
        }
      }
    });

    // 直接设置路由模块的数据库实例（备用方法）
    if (positionsRoutes && positionsRoutes.setDatabase) positionsRoutes.setDatabase(db);
    if (tradesRoutes && tradesRoutes.setDatabase) tradesRoutes.setDatabase(db);
    if (analysisRoutes && analysisRoutes.setDatabase) analysisRoutes.setDatabase(db);
    if (statsRoutes && statsRoutes.setDatabase) statsRoutes.setDatabase(db);
    if (configRoutes && configRoutes.setDatabase) configRoutes.setDatabase(db);
    if (marketRoutes && marketRoutes.setDatabase) marketRoutes.setDatabase(db);

    // 设置账户路由的exchangeUtils实例
    if (accountRoutes && accountRoutes.setExchangeUtils) {
      accountRoutes.setExchangeUtils(exchangeUtils);
    }

    // 设置市场路由的tradingEngine实例
    if (marketRoutes && marketRoutes.setTradingEngine) {
      marketRoutes.setTradingEngine(tradingEngine);
    }

    // 设置数据库的tickerWebSocket实例
    db.setTickerWebSocket(tradingEngine.tickerWebSocket);
    systemLogger.info('✓ TickerWebSocket实例已传递给数据库');

    // 传递WebSocket管理器到交易引擎和数据库
    const wsManager = apiServer.getWebSocketManager();
    if (typeof tradingEngine.setWebSocketManager === 'function') {
      tradingEngine.setWebSocketManager(wsManager);
    }
    db.setWebSocketManager(wsManager);

    // 也为AIAnalysis的数据库实例设置WebSocketManager
    if (aiAnalysis && aiAnalysis.db) {
      aiAnalysis.db.setWebSocketManager(wsManager);
      systemLogger.info('✓ WebSocket管理器已传递给AI分析模块数据库');
    }

    systemLogger.info('✓ WebSocket管理器已传递给交易引擎和数据库');

    // 启动交易引擎
    tradingEngine.start();
    systemLogger.info('✓ 交易引擎已启动');

    systemLogger.info('===========================================');
    systemLogger.info('  DeepTrade Backend 运行正常');
    systemLogger.info(`  API: http://localhost:${env.web.port}`);
    systemLogger.info('===========================================');

    // 优雅关闭
    const gracefulShutdown = async (signal) => {
      systemLogger.info(`收到${signal}信号，开始优雅关闭...`);

      try {
        tradingEngine.close();
        apiServer.close();
        db.close();

        systemLogger.info('所有资源已释放，关闭完成');
        process.exit(0);
      } catch (error) {
        systemLogger.error(`关闭时发生错误: ${error.message}`);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  } catch (error) {
    systemLogger.error(`启动失败: ${error.message}`, { stack: error.stack });

    // 即使启动失败也要退出，但这里不应该发生，因为交易引擎已经不会抛错了
    process.exit(1);
  }
}

// 启动应用
main();
