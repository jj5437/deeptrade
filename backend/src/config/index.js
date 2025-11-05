const env = require('./env');
const ccxt = require('ccxt');
const { OpenAI } = require('openai');
const { systemLogger } = require('../controllers/logger/Logger');

/**
 * 初始化交易所实例
 */
function initExchange() {
  const { exchange } = env;

  if (exchange.type === 'okx') {
    return new ccxt.okx({
      options: {
        defaultType: 'swap',
        defaultSubType: 'swap',
        fetchPositions: ['swap']
      },
      apiKey: exchange.okx.apiKey,
      secret: exchange.okx.secret,
      password: exchange.okx.password,
      enableRateLimit: true,
      timeout: 60000,
      rateLimit: 800
    });
  } else if (exchange.type === 'binance') {
    return new ccxt.binance({
      options: {
        defaultType: 'future',
        defaultSubType: 'linear',
        recvWindow: 60000
      },
      apiKey: exchange.binance.apiKey,
      secret: exchange.binance.secret,
      enableRateLimit: true,
      sandbox: false,
      timeout: 60000,
      rateLimit: 600
    });
  } else {
    throw new Error(`不支持的交易所类型: ${exchange.type}`);
  }
}

/**
 * 初始化AI客户端
 */
function initAIClient() {
  const { ai } = env;

  const apiKey = ai.deepseekApiKey;
  const baseURL = ai.baseUrl;

  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY 未配置');
  }

  // 记录使用的配置用于调试
  systemLogger.warn(`初始化AI客户端: baseURL=${baseURL}, model=${env.ai.modelName}`);

  return new OpenAI({
    apiKey,
    baseURL
  });
}

const exchange = initExchange();
const aiClient = initAIClient();

module.exports = {
  env,
  exchange,
  aiClient
};
