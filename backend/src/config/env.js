const path = require('path');
require('dotenv').config();

/**
 * 环境变量配置
 */

const config = {
  // AI模型配置
  ai: {
    model: 'deepseek',
    modelName: 'deepseek-reasoner',
    baseUrl: 'https://api.deepseek.com',
    deepseekApiKey: process.env.DEEPSEEK_API_KEY
  },

  // 交易所配置
  exchange: {
    type: (process.env.EXCHANGE_TYPE || 'binance').toLowerCase(),
    okx: {
      apiKey: process.env.OKX_API_KEY,
      secret: process.env.OKX_SECRET,
      password: process.env.OKX_PASSWORD
    },
    binance: {
      apiKey: process.env.BINANCE_API_KEY,
      secret: process.env.BINANCE_SECRET
    }
  },

  // 交易配置
  trading: {
    symbols: [
      'BTC/USDT',
      'ETH/USDT',
      'SOL/USDT',
      'DOGE/USDT',
      'XRP/USDT',
      'BNB/USDT'
    ],
    amountUsd: parseFloat(process.env.TRADE_AMOUNT || '10'),
    leverage: parseInt(process.env.LEVERAGE || '10', 10),
    timeframe: process.env.TIMEFRAME || '3m',
    testMode: (process.env.TEST_MODE || 'false').toLowerCase() === 'true',
    autoTrade: (process.env.AUTO_TRADE || 'true').toLowerCase() === 'true',
    holdThreshold: parseFloat(process.env.HOLD_THRESHOLD || '0.95'),
    takeProfitEnabled: (process.env.TAKE_PROFIT_ENABLED || 'true').toLowerCase() === 'true',
    takeProfitPercentage: parseFloat(process.env.TAKE_PROFIT_PERCENTAGE || '0.05'),
    riskMonitorEnabled: (process.env.RISK_MONITOR_ENABLED || 'true').toLowerCase() === 'true',
    riskMonitorInterval: parseInt(process.env.RISK_MONITOR_INTERVAL || '30', 10),
    riskMonitorAutoClose: (process.env.RISK_MONITOR_AUTO_CLOSE || 'true').toLowerCase() === 'true',
    parallelAnalysisEnabled: (process.env.PARALLEL_ANALYSIS_ENABLED || 'true').toLowerCase() === 'true',
    maxAnalysisWorkers: parseInt(process.env.MAX_ANALYSIS_WORKERS || '6', 10),
    invalidationLevels: {
      'BTC/USDT': parseFloat(process.env.INVALIDATION_BTC || '105000'),
      'ETH/USDT': parseFloat(process.env.INVALIDATION_ETH || '3700'),
      'SOL/USDT': parseFloat(process.env.INVALIDATION_SOL || '175'),
      'XRP/USDT': parseFloat(process.env.INVALIDATION_XRP || '2.30'),
      'DOGE/USDT': parseFloat(process.env.INVALIDATION_DOGE || '0.180'),
      'BNB/USDT': parseFloat(process.env.INVALIDATION_BNB || '1060')
    }
  },

  // Web UI配置
  web: {
    baseUrl: process.env.WEB_BASE_URL || 'http://localhost:5437',
    port: parseInt(process.env.PORT || '8080', 10),
    adminUsername: process.env.ADMIN_USERNAME || 'admin',
    adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
    sessionSecret: process.env.SECRET_KEY || 'deeptrade-secret-key-2025'
  },

  // 路径配置
  paths: {
    root: path.resolve(__dirname, '../../'),
    logs: path.resolve(__dirname, '../../logs'),
    data: path.resolve(__dirname, '../../data'),
    db: path.resolve(__dirname, '../../data/trading_data.db')
  },

  // 日志配置
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    maxFiles: '7d',
    maxSize: '20m'
  }
};

module.exports = config;
