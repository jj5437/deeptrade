const TradingDatabase = require('../database/Database');
const encryptUtil = require('../../utils/encrypt');
const { systemLogger } = require('../logger/Logger');

/**
 * 配置管理控制器
 * 使用单例模式，确保只有一个数据库实例
 */
class ConfigController {
  constructor(database = null) {
    // 使用传入的数据库实例，而不是创建新的
    this.db = database;
    this.defaultConfig = this.getDefaultConfig();
    this.configCache = null;
    this.cacheTimestamp = null;
    this.CACHE_TTL = 5000; // 5秒缓存
  }

  /**
   * 获取默认配置
   */
  getDefaultConfig() {
    return {
      exchange: {
        type: 'binance', // 默认交易所
        binance: {
          apiKey: '',
          secretKey: ''
        },
        okx: {
          apiKey: '',
          secretKey: '',
          passphrase: ''
        }
      },
      trading: {
        amount: 10, // 交易金额
        leverage: 10, // 杠杆倍数
        timeframe: '3m', // 时间周期
        autoTrade: true, // 自动交易
        holdThreshold: 0.99, // 止损阈值
        takeProfit: {
          enabled: true, // 是否启用止盈
          percentage: 2 // 止盈百分比
        },
        stopLoss: {
          enabled: true, // 是否启用止损
          percentage: 5 // 止损百分比
        },
        riskMonitor: {
          enabled: true,
          interval: 30,
          autoClose: true
        },
        invalidation: {
          BTC: 105000,
          ETH: 3700,
          SOL: 175,
          XRP: 2.30,
          DOGE: 0.180,
          BNB: 1060
        }
      },
      ai: {
        model: 'deepseek', // AI模型
        modelName: 'deepseek-reasoner',
        baseUrl: 'https://api.deepseek.com',
        deepseekApiKey: ''
      },
      system: {
        port: 8080,
        adminUsername: 'admin'
      }
    };
  }

  /**
   * 获取配置（带缓存）
   */
  async getConfig() {
    try {
      // 检查缓存
      const now = Date.now();
      if (this.configCache && this.cacheTimestamp && (now - this.cacheTimestamp < this.CACHE_TTL)) {
        return this.configCache;
      }

      // 如果没有数据库实例，返回默认配置
      if (!this.db) {
        return this.defaultConfig;
      }

      const dbConfig = this.db.getAllSettings();

      // 如果数据库为空，返回默认配置
      if (Object.keys(dbConfig).length === 0) {
        this.configCache = this.defaultConfig;
        this.cacheTimestamp = now;
        return this.defaultConfig;
      }

      // 合并默认配置和数据库配置
      const config = this.mergeConfig(this.defaultConfig, dbConfig);

      // 解密API密钥
      const decryptedConfig = this.decryptSensitiveData(config);

      // 更新缓存
      this.configCache = decryptedConfig;
      this.cacheTimestamp = now;

      return decryptedConfig;
    } catch (error) {
      systemLogger.error(`获取配置失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 更新配置
   */
  async updateConfig(configUpdates) {
    try {
      // 获取当前配置
      const currentConfig = await this.getConfig();

      // 合并配置
      const mergedConfig = this.mergeConfig(currentConfig, configUpdates);

      // 加密敏感数据
      const encryptedConfig = this.encryptSensitiveData(mergedConfig);

      // 保存到数据库
      this.saveConfigToDatabase(encryptedConfig);

      // 清空缓存
      this.configCache = null;
      this.cacheTimestamp = null;

      systemLogger.info('配置已更新');
      return mergedConfig;
    } catch (error) {
      systemLogger.error(`更新配置失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 保存配置到数据库
   */
  saveConfigToDatabase(config) {
    const settingsToSave = {
      exchange: config.exchange,
      trading: config.trading,
      ai: config.ai,
      system: config.system
    };

    this.db.setSettings(settingsToSave);
  }

  /**
   * 深度合并配置对象
   */
  mergeConfig(defaultConfig, updates) {
    const result = { ...defaultConfig };

    for (const key in updates) {
      if (updates.hasOwnProperty(key)) {
        if (typeof updates[key] === 'object' && updates[key] !== null && !Array.isArray(updates[key])) {
          result[key] = this.mergeConfig(result[key] || {}, updates[key]);
        } else {
          result[key] = updates[key];
        }
      }
    }

    return result;
  }

  /**
   * 加密敏感数据
   */
  encryptSensitiveData(config) {
    const encrypted = JSON.parse(JSON.stringify(config));

    // 加密交易所API密钥
    if (encrypted.exchange?.binance?.apiKey) {
      encrypted.exchange.binance.apiKey = encryptUtil.encrypt(encrypted.exchange.binance.apiKey);
    }
    if (encrypted.exchange?.binance?.secretKey) {
      encrypted.exchange.binance.secretKey = encryptUtil.encrypt(encrypted.exchange.binance.secretKey);
    }
    if (encrypted.exchange?.okx?.apiKey) {
      encrypted.exchange.okx.apiKey = encryptUtil.encrypt(encrypted.exchange.okx.apiKey);
    }
    if (encrypted.exchange?.okx?.secretKey) {
      encrypted.exchange.okx.secretKey = encryptUtil.encrypt(encrypted.exchange.okx.secretKey);
    }
    if (encrypted.exchange?.okx?.passphrase) {
      encrypted.exchange.okx.passphrase = encryptUtil.encrypt(encrypted.exchange.okx.passphrase);
    }

    // 加密AI API密钥
    if (encrypted.ai?.deepseekApiKey) {
      encrypted.ai.deepseekApiKey = encryptUtil.encrypt(encrypted.ai.deepseekApiKey);
    }

    return encrypted;
  }

  /**
   * 解密敏感数据
   */
  decryptSensitiveData(config) {
    const decrypted = JSON.parse(JSON.stringify(config));

    // 解密交易所API密钥
    if (decrypted.exchange?.binance?.apiKey && encryptUtil.isEncrypted(decrypted.exchange.binance.apiKey)) {
      decrypted.exchange.binance.apiKey = encryptUtil.decrypt(decrypted.exchange.binance.apiKey);
    }
    if (decrypted.exchange?.binance?.secretKey && encryptUtil.isEncrypted(decrypted.exchange.binance.secretKey)) {
      decrypted.exchange.binance.secretKey = encryptUtil.decrypt(decrypted.exchange.binance.secretKey);
    }
    if (decrypted.exchange?.okx?.apiKey && encryptUtil.isEncrypted(decrypted.exchange.okx.apiKey)) {
      decrypted.exchange.okx.apiKey = encryptUtil.decrypt(decrypted.exchange.okx.apiKey);
    }
    if (decrypted.exchange?.okx?.secretKey && encryptUtil.isEncrypted(decrypted.exchange.okx.secretKey)) {
      decrypted.exchange.okx.secretKey = encryptUtil.decrypt(decrypted.exchange.okx.secretKey);
    }
    if (decrypted.exchange?.okx?.passphrase && encryptUtil.isEncrypted(decrypted.exchange.okx.passphrase)) {
      decrypted.exchange.okx.passphrase = encryptUtil.decrypt(decrypted.exchange.okx.passphrase);
    }

    // 解密AI API密钥
    if (decrypted.ai?.deepseekApiKey && encryptUtil.isEncrypted(decrypted.ai.deepseekApiKey)) {
      decrypted.ai.deepseekApiKey = encryptUtil.decrypt(decrypted.ai.deepseekApiKey);
    }

    return decrypted;
  }

  /**
   * 重置配置
   */
  async resetConfig() {
    try {
      // 删除所有设置
      this.db.db.exec('DELETE FROM settings');

      systemLogger.info('配置已重置为默认值');
      return this.defaultConfig;
    } catch (error) {
      systemLogger.error(`重置配置失败: ${error.message}`);
      throw error;
    }
  }
}

// 导出构造函数，允许传入数据库实例
module.exports = ConfigController;
