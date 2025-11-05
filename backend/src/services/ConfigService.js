const configController = require('../controllers/settings/ConfigController');
const ccxt = require('ccxt');
const { OpenAI } = require('openai');

/**
 * 配置服务 - 从数据库读取配置并缓存
 * 用于替代直接读取环境变量
 */
class ConfigService {
  constructor() {
    this.config = null;
    this.exchange = null;
    this.aiClient = null;
    this.lastUpdate = null;
    this.cacheTimeout = 5 * 60 * 1000; // 5分钟缓存
  }

  /**
   * 获取配置（从数据库或缓存）
   */
  async getConfig(forceRefresh = false) {
    const now = Date.now();

    // 如果缓存存在且未过期，返回缓存的配置
    if (!forceRefresh && this.config && this.lastUpdate && (now - this.lastUpdate < this.cacheTimeout)) {
      return this.config;
    }

    // 从数据库获取最新配置
    try {
      const dbConfig = await configController.getConfig();
      this.config = dbConfig;
      this.lastUpdate = now;

      // 重新初始化交易所和AI客户端
      await this.initExchange();
      await this.initAIClient();

      return this.config;
    } catch (error) {
      console.error('获取配置失败:', error);

      // 如果获取失败，使用缓存的配置（如果有）
      if (this.config) {
        console.warn('使用缓存的配置');
        return this.config;
      }

      // 如果没有缓存，抛出错误
      throw error;
    }
  }

  /**
   * 初始化交易所实例
   */
  async initExchange() {
    const config = await this.getConfig();
    const { exchange } = config;

    if (exchange.type === 'okx') {
      this.exchange = new ccxt.okx({
        options: {
          defaultType: 'swap',
          defaultSubType: 'swap',
          fetchPositions: ['swap']
        },
        apiKey: exchange.okx.apiKey,
        secret: exchange.okx.secretKey,
        password: exchange.okx.passphrase,
        enableRateLimit: true,
        timeout: 60000,
        rateLimit: 800
      });
    } else if (exchange.type === 'binance') {
      this.exchange = new ccxt.binance({
        options: {
          defaultType: 'future',
          defaultSubType: 'linear',
          recvWindow: 60000
        },
        apiKey: exchange.binance.apiKey,
        secret: exchange.binance.secretKey,
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
  async initAIClient() {
    const config = await this.getConfig();
    const { ai } = config;

    const apiKey = ai.deepseekApiKey;
    const baseURL = ai.baseUrl;

    this.aiClient = new OpenAI({
      apiKey,
      baseURL
    });
  }

  /**
   * 获取交易所实例
   */
  async getExchange() {
    if (!this.exchange) {
      await this.initExchange();
    }
    return this.exchange;
  }

  /**
   * 获取AI客户端
   */
  async getAIClient() {
    if (!this.aiClient) {
      await this.initAIClient();
    }
    return this.aiClient;
  }

  /**
   * 更新配置
   */
  async updateConfig(configUpdates) {
    const updatedConfig = await configController.updateConfig(configUpdates);

    // 清除缓存，强制重新加载
    this.config = null;
    this.lastUpdate = null;
    this.exchange = null;
    this.aiClient = null;

    return updatedConfig;
  }

  /**
   * 重置配置
   */
  async resetConfig() {
    const defaultConfig = await configController.resetConfig();

    // 清除缓存
    this.config = null;
    this.lastUpdate = null;
    this.exchange = null;
    this.aiClient = null;

    return defaultConfig;
  }
}

module.exports = new ConfigService();
