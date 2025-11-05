const axios = require('axios');
const { systemLogger } = require('../logger/Logger');

/**
 * 网络工具类
 */
class NetworkUtils {
  constructor() {
    this.retryConfig = {
      maxRetries: 3,
      retryDelay: 1000,
      backoffFactor: 2
    };

    // 创建带重试的HTTP会话
    this.http = axios.create({
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'DeepTrade-Backend/1.0'
      }
    });

    // 添加响应拦截器
    this.http.interceptors.response.use(
      response => response,
      error => {
        systemLogger.error(`HTTP请求失败: ${error.message}`);
        return Promise.reject(error);
      }
    );
  }

  /**
   * 创建带重试的HTTP会话
   */
  async createRetrySession(url, method = 'GET', data = null, headers = {}) {
    const maxRetries = this.retryConfig.maxRetries;
    let retryCount = 0;

    while (retryCount < maxRetries) {
      try {
        const config = {
          method,
          url,
          headers,
          timeout: 30000
        };

        if (data && (method === 'POST' || method === 'PUT')) {
          config.data = data;
        }

        const response = await this.http(config);
        return response.data;
      } catch (error) {
        retryCount++;
        systemLogger.warn(`HTTP请求失败 (尝试 ${retryCount}/${maxRetries}): ${error.message}`);

        if (retryCount >= maxRetries) {
          throw error;
        }

        // 等待后重试
        await this.sleep(this.retryConfig.retryDelay * Math.pow(this.retryConfig.backoffFactor, retryCount));
      }
    }
  }

  /**
   * 发送日志到Web UI
   */
  async sendLogToWebUI(level, symbol, action, message, success = true, details = {}) {
    try {
      // 从环境配置导入web设置
      const { env } = require('../../config');
      const web = env.web;

      // 如果未配置Web UI URL，跳过
      if (!web || !web.baseUrl || web.baseUrl === 'http://localhost:5437') {
        return;
      }

      const logData = {
        level,
        symbol,
        action,
        message,
        success,
        details,
        timestamp: new Date().toISOString()
      };

      systemLogger.warn(`发送日志到Web UI: ${web.baseUrl}/api/log_from_strategy`);

      await this.createRetrySession(
        `${web.baseUrl}/api/log_from_strategy`,
        'POST',
        logData
      );

      systemLogger.warn(`日志已发送到Web UI: ${action}`);
    } catch (error) {
      // 日志发送失败不抛出异常，避免影响主流程
      systemLogger.warn(`发送日志到Web UI失败: ${error.message}`);
    }
  }

  /**
   * 检查URL是否可访问
   */
  async checkUrl(url) {
    try {
      await this.createRetrySession(url, 'GET');
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * 获取网络状态
   */
  async getNetworkStatus() {
    const tests = [
      { name: '百度', url: 'https://www.baidu.com' },
      { name: 'Google', url: 'https://www.google.com' }
    ];

    const results = [];

    for (const test of tests) {
      const start = Date.now();
      try {
        await this.createRetrySession(test.url, 'GET');
        const latency = Date.now() - start;
        results.push({ name: test.name, status: 'success', latency });
      } catch (error) {
        results.push({ name: test.name, status: 'failed', error: error.message });
      }
    }

    return {
      timestamp: new Date().toISOString(),
      results
    };
  }

  /**
   * 等待
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new NetworkUtils();
