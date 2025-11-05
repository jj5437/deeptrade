const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const env = require('./config/env');
const { systemLogger, apiLogger } = require('./controllers/logger/Logger');
const WebSocketManager = require('./controllers/websocket/WebSocketManager');

const indexRoutes = require('./routes/index');
const authRoutes = require('./routes/api/auth');
const positionsRoutes = require('./routes/api/positions');
const tradesRoutes = require('./routes/api/trades');
const analysisRoutes = require('./routes/api/analysis');
const statsRoutes = require('./routes/api/stats');
const configRoutes = require('./routes/api/config');
const marketRoutes = require('./routes/api/market');
const accountRoutes = require('./routes/api/account');
const { requireAuth } = require('./middleware/auth');

/**
 * Express服务器
 */
class APIServer {
  constructor() {
    try {
      this.app = express();
      this.webSocketManager = new WebSocketManager();
      this.setupMiddleware();
      this.setupRoutes();
      this.setupErrorHandling();
    } catch (error) {
      systemLogger.error(`APIServer构造函数失败: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  /**
   * 设置中间件
   */
  setupMiddleware() {
    // 安全头
    this.app.use(helmet());

    // 压缩
    this.app.use(compression());

    // CORS
    this.app.use(cors({
      origin: env.web.baseUrl,
      credentials: true
    }));

    // 统一日志 - 根据路径路由到不同日志文件
    this.app.use(morgan('combined', {
      stream: {
        write: (message) => {
          const logMessage = message.trim();
          // 如果当前请求是API请求，写入API日志；否则写入系统日志
          if (logMessage.match(/HTTP\/1\.1"/)) {
            // 提取引号之间的HTTP请求部分
            const httpMatch = logMessage.match(/"([^"]+)"/);
            if (httpMatch && httpMatch[1] && httpMatch[1].includes('/api/')) {
              apiLogger.info(logMessage);
            } else {
              systemLogger.info(logMessage);
            }
          } else {
            // 非HTTP请求日志写入系统日志
            systemLogger.info(logMessage);
          }
        }
      }
    }));

    // 解析JSON
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // 会话
    this.app.use(session({
      secret: env.web.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: false, // 开发环境设为false，生产环境设为true
        httpOnly: true,
        sameSite: 'lax', // 允许第三方Cookie
        maxAge: 24 * 60 * 60 * 1000 // 24小时
      }
    }));

    // 限流
    const limiter = rateLimit({
      windowMs: 60 * 1000, // 1分钟
      max: 60, // 最多60个请求
      message: {
        success: false,
        error: '请求过于频繁，请稍后再试'
      }
    });
    this.app.use('/api/', limiter);
  }

  /**
   * 设置路由
   */
  setupRoutes() {
    // 公开路由（不需要认证）
    this.app.use('/', indexRoutes);
    this.app.use('/api/auth', authRoutes);

    // 受保护的API路由（需要认证）
    this.app.use('/api/positions', requireAuth, positionsRoutes);
    this.app.use('/api/trades', requireAuth, tradesRoutes);
    this.app.use('/api/analysis', requireAuth, analysisRoutes);
    this.app.use('/api/stats', requireAuth, statsRoutes);
    this.app.use('/api/config', requireAuth, configRoutes);
    this.app.use('/api/market', requireAuth, marketRoutes);
    this.app.use('/api/account', requireAuth, accountRoutes);

    // 404处理
    this.app.use('*', (req, res) => {
      res.status(404).json({
        success: false,
        error: '接口不存在'
      });
    });
  }

  /**
   * 设置错误处理
   */
  setupErrorHandling() {
    this.app.use((err, req, res, next) => {
      systemLogger.error(`API错误: ${err.message}`, { stack: err.stack });
      res.status(500).json({
        success: false,
        error: '服务器内部错误'
      });
    });
  }

  /**
   * 启动服务器
   */
  async start() {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(env.web.port, (err) => {
          if (err) {
            systemLogger.error(`API服务器启动失败: ${err.message}`);
            reject(err);
          } else {
            systemLogger.info(`API服务器已启动: http://localhost:${env.web.port}`);
            // 初始化WebSocket服务器
            this.webSocketManager.init(this.server);
            systemLogger.info(`WebSocket服务器已启动: ws://localhost:${env.web.port}/ws`);
            resolve();
          }
        });
      } catch (error) {
        systemLogger.error(`启动服务器时发生错误: ${error.message}`);
        reject(error);
      }
    });
  }

  /**
   * 关闭服务器
   */
  async close() {
    return new Promise((resolve) => {
      if (this.server) {
        // 关闭WebSocket服务器
        this.webSocketManager.close();
        this.server.close(() => {
          systemLogger.info('API服务器已关闭');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * 获取Express应用实例
   */
  getApp() {
    return this.app;
  }

  /**
   * 获取WebSocket管理器
   */
  getWebSocketManager() {
    return this.webSocketManager;
  }
}

module.exports = APIServer;
