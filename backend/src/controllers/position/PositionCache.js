const { systemLogger } = require('../logger/Logger');

/**
 * 位置缓存
 */
class PositionCache {
  constructor() {
    this.cache = new Map();
    this.lastUpdate = new Map();
    this.cacheTimeout = 30000; // 30秒缓存
  }

  /**
   * 获取缓存的持仓
   */
  get(symbol) {
    const data = this.cache.get(symbol);
    const lastUpdateTime = this.lastUpdate.get(symbol);

    if (!data) {
      return null;
    }

    // 检查缓存是否过期
    if (Date.now() - lastUpdateTime > this.cacheTimeout) {
      systemLogger.warn(`${symbol} 持仓缓存已过期`);
      this.cache.delete(symbol);
      this.lastUpdate.delete(symbol);
      return null;
    }

    return data;
  }

  /**
   * 设置持仓缓存
   */
  set(symbol, position) {
    this.cache.set(symbol, position);
    this.lastUpdate.set(symbol, Date.now());
    systemLogger.warn(`${symbol} 持仓缓存已更新`);
  }

  /**
   * 清除缓存
   */
  clear(symbol = null) {
    if (symbol) {
      this.cache.delete(symbol);
      this.lastUpdate.delete(symbol);
      systemLogger.warn(`${symbol} 持仓缓存已清除`);
    } else {
      this.cache.clear();
      this.lastUpdate.clear();
      systemLogger.warn('所有持仓缓存已清除');
    }
  }

  /**
   * 获取所有缓存的持仓
   */
  getAll() {
    const result = {};
    const now = Date.now();

    for (const [symbol, data] of this.cache.entries()) {
      const lastUpdateTime = this.lastUpdate.get(symbol);

      // 过滤过期的缓存
      if (now - lastUpdateTime <= this.cacheTimeout) {
        result[symbol] = data;
      } else {
        this.cache.delete(symbol);
        this.lastUpdate.delete(symbol);
      }
    }

    return result;
  }

  /**
   * 检查缓存是否有效
   */
  isValid(symbol) {
    const data = this.cache.get(symbol);
    const lastUpdateTime = this.lastUpdate.get(symbol);

    if (!data || !lastUpdateTime) {
      return false;
    }

    return Date.now() - lastUpdateTime <= this.cacheTimeout;
  }
}

module.exports = new PositionCache();
