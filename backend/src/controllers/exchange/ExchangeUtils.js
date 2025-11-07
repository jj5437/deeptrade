const axios = require('axios');
const { systemLogger } = require('../logger/Logger');
const { exchange, env } = require('../../config');
const { v4: uuidv4 } = require('uuid');

/**
 * 交易所工具类
 */
class ExchangeUtils {
  constructor() {
    this.retryConfig = {
      maxRetries: 3,
      retryDelay: 1000,
      backoffFactor: 2
    };
    this.db = null;
  }

  /**
   * 设置数据库实例
   */
  setDatabase(database) {
    this.db = database;
  }

  /**
   * 带重试的OHLCV数据获取
   */
  async getOHLCVWithRetry(symbol, timeframe = '3m', limit = 100) {
    const maxRetries = this.retryConfig.maxRetries;
    let retryCount = 0;

    while (retryCount < maxRetries) {
      try {
        const ohlcv = await exchange.fetchOHLCV(symbol, timeframe, undefined, limit);
        systemLogger.warn(`${symbol} OHLCV数据获取成功 (尝试 ${retryCount + 1}/${maxRetries})`);
        return ohlcv;
      } catch (error) {
        retryCount++;
        systemLogger.warn(`${symbol} OHLCV获取失败 (尝试 ${retryCount}/${maxRetries}): ${error.message}`);

        if (retryCount >= maxRetries) {
          systemLogger.error(`${symbol} OHLCV获取失败，已达最大重试次数`);
          // 标记错误来源为数据获取
          error.isDataFetchError = true;
          throw error;
        }

        // 等待后重试
        await this.sleep(this.retryConfig.retryDelay * Math.pow(this.retryConfig.backoffFactor, retryCount));
      }
    }
  }

  /**
   * 获取当前持仓
   */
  async getCurrentPosition(symbol) {
    try {
      const positions = await exchange.fetchPositions([symbol]);

      if (!positions || positions.length === 0) {
        return null;
      }

      // 筛选活跃持仓
      const activePositions = positions.filter(p =>
        p.contracts > 0 && p.contracts !== undefined
      );

      if (activePositions.length === 0) {
        return null;
      }

      if (activePositions.length === 1) {
        return this.formatPosition(activePositions[0]);
      }

      return activePositions.map(p => this.formatPosition(p));
    } catch (error) {
      systemLogger.error(`获取${symbol}持仓失败: ${error.message}`);
      return null;
    }
  }

  /**
   * 格式化持仓数据
   */
  formatPosition(position) {
    return {
      symbol: position.symbol,
      side: position.side, // 'long' or 'short'
      size: position.contracts,
      entryPrice: position.entryPrice,
      currentPrice: position.markPrice || position.currentPrice,
      unrealizedPnl: position.unrealizedPnl,
      leverage: position.leverage,
      margin: position.margin,
      percentage: position.percentage,
      contracts: position.contracts
    };
  }

  /**
   * 创建订单
   */
  async createOrder(symbol, side, type, amount, price = null, params = {}) {
    try {
      const orderId = uuidv4();
      systemLogger.info(`创建订单: ${symbol} ${side} ${type} ${amount}${price ? ` @ ${price}` : ''}`);

      const order = await exchange.createOrder(symbol, type, side, amount, price, params);

      systemLogger.info(`订单创建成功: ${order.id}`);
      return order;
    } catch (error) {
      systemLogger.error(`订单创建失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 平仓
   */
  async closePosition(symbol, side, amount = null, price = null) {
    try {
      const positions = await exchange.fetchPositions([symbol]);
      systemLogger.warn(`${symbol} 交易所返回持仓: ${JSON.stringify(positions)}`);

      const position = positions.find(p => p.contracts > 0 && p.side === side);

      if (!position) {
        // 详细调试信息
        const allPositions = positions.filter(p => p.contracts > 0);
        systemLogger.warn(`未找到${symbol}的${side}持仓，可用持仓: ${JSON.stringify(allPositions)}`);
        throw new Error(`未找到${symbol}的${side}持仓`);
      }

      const closeAmount = amount || position.contracts;

      // Binance需要特殊处理：Symbol需要是 BTCUSDT 格式（不带/和:）
      let binanceSymbol = symbol;
      if (env.exchange.type === 'binance' || symbol.includes('/')) {
        binanceSymbol = symbol.replace('/', '').replace(':USDT', '');
      }

      // Binance平仓需要使用 SELL/BUY 而不是 short/long
      const orderSide = side === 'long' ? 'SELL' : 'BUY';

      systemLogger.warn(`平仓参数: symbol=${binanceSymbol}, side=${orderSide}, type=MARKET, size=${closeAmount}`);

      // 使用原生API调用（参考Python代码中的fapiPrivatePostOrder）
      const orderParams = {
        symbol: binanceSymbol,
        side: orderSide,
        type: 'MARKET',
        quantity: closeAmount.toString()
      };

      try {
        // 先尝试双向持仓模式（带positionSide，参考Python代码）
        const dualSideParams = {
          ...orderParams,
          positionSide: side.toUpperCase() // LONG 或 SHORT
        };
        systemLogger.info(`📋 尝试双向持仓平仓参数: ${JSON.stringify(dualSideParams)}`);

        // 使用ccxt的私有API方法直接调用
        const result1 = await exchange.fapiPrivatePostOrder(dualSideParams);
        systemLogger.info(`✅ 双向持仓平仓成功: ${symbol} ${side} ${closeAmount}`);

        return {
          success: true,
          id: result1.orderId,
          symbol: symbol,
          side: side,
          amount: closeAmount,
          type: 'market',
          price: null,
          timestamp: result1.transactTime || Date.now(),
          exchange_result: result1
        };
      } catch (error1) {
        // 如果双向持仓失败，尝试单向持仓模式（只带reduceOnly）
        systemLogger.warn(`⚠️ 双向持仓平仓失败，尝试单向持仓: ${error1.message}`);

        const singleSideParams = {
          ...orderParams,
          reduceOnly: 'true'
        };
        systemLogger.info(`📋 尝试单向持仓平仓参数: ${JSON.stringify(singleSideParams)}`);

        const result2 = await exchange.fapiPrivatePostOrder(singleSideParams);
        systemLogger.info(`✅ 单向持仓平仓成功: ${symbol} ${side} ${closeAmount}`);

        return {
          success: true,
          id: result2.orderId,
          symbol: symbol,
          side: side,
          amount: closeAmount,
          type: 'market',
          price: null,
          timestamp: result2.transactTime || Date.now(),
          exchange_result: result2
        };
      }
    } catch (error) {
      systemLogger.error(`平仓失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 获取账户余额
   */
  async getBalance() {
    try {
      const balance = await exchange.fetchBalance();
      return {
        total: balance.total,
        free: balance.free,
        used: balance.used
      };
    } catch (error) {
      systemLogger.error(`获取余额失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 设置杠杆
   */
  async setLeverage(symbol, leverage) {
    try {
      if (env.exchange.type === 'okx') {
        // OKX需要分别设置多空杠杆
        await exchange.setLeverage(leverage, `${symbol}:USDT`, 'long');
        await exchange.setLeverage(leverage, `${symbol}:USDT`, 'short');
      } else {
        // Binance设置统一杠杆
        await exchange.setLeverage(leverage, symbol);
      }

      systemLogger.info(`${symbol} 杠杆设置成功: ${leverage}x`);
    } catch (error) {
      systemLogger.error(`设置杠杆失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 获取市场数据
   */
  async getTicker(symbol) {
    try {
      const ticker = await exchange.fetchTicker(symbol);

      // 对于期货市场，优先使用baseVolume，如果没有则使用quoteVolume，最后fallback到volume
      const volume = ticker.baseVolume || ticker.quoteVolume || ticker.volume || 0;

      return {
        symbol,
        price: ticker.last,
        change24h: ticker.change || 0,
        changePercent24h: ticker.percentage || 0,
        volume24h: volume,
        high24h: ticker.high || 0,
        low24h: ticker.low || 0,
        timestamp: ticker.timestamp
      };
    } catch (error) {
      systemLogger.error(`获取${symbol}市场数据失败: ${error.message}`);
      // 标记错误来源为数据获取
      error.isDataFetchError = true;
      throw error;
    }
  }

  /**
   * 获取所有市场数据
   */
  async getAllTickers() {
    try {
      const tickers = await exchange.fetchTickers();
      return Object.keys(tickers).map(symbol => this.getTicker(tickers[symbol].symbol));
    } catch (error) {
      systemLogger.error(`获取市场数据失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 检查交易所连接
   */
  async checkConnection() {
    try {
      await exchange.fetchStatus();
      return { connected: true, message: '连接正常' };
    } catch (error) {
      return { connected: false, message: error.message };
    }
  }

  /**
   * 获取交易所信息
   */
  async getExchangeInfo() {
    try {
      const markets = await exchange.loadMarkets();
      const balance = await this.getBalance();

      return {
        name: exchange.name,
        type: env.exchange.type,
        symbols: Object.keys(markets),
        balance: {
          total: Object.keys(balance.total).reduce((sum, cur) => sum + (balance.total[cur] || 0), 0),
          free: Object.keys(balance.free).reduce((sum, cur) => sum + (balance.free[cur] || 0), 0),
          used: Object.keys(balance.used).reduce((sum, cur) => sum + (balance.used[cur] || 0), 0)
        }
      };
    } catch (error) {
      systemLogger.error(`获取交易所信息失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 格式化符号（OKX需要:USDT后缀）
   */
  formatSymbol(symbol) {
    // 如果已经是完整格式（包含:USDT），根据交易所类型进行转换
    if (symbol.includes(':')) {
      // 对于Binance，移除:USDT后缀
      if (env.exchange.type === 'binance') {
        return symbol.split(':')[0];
      }
      // 对于OKX，保持原样
      return symbol;
    }

    // 如果没有:后缀，根据交易所添加
    if (env.exchange.type === 'okx') {
      return `${symbol}:USDT`;
    }

    // Binance不需要额外后缀
    return symbol;
  }


  /**
   * 获取资金费率
   */
  async getFundingRate(symbol) {
    try {
      // CCXT提供资金费率 - 需要使用正确的符号格式
      const formattedSymbol = this.formatSymbol(symbol);
      const fundingRateData = await exchange.fetchFundingRate(formattedSymbol);

      // 从对象中提取 fundingRate 字段
      const rate = fundingRateData.fundingRate || fundingRateData.current || 0;

      return rate;
    } catch (error) {
      systemLogger.warn(`获取${symbol}资金费率失败: ${error.message}`);
      return 0;
    }
  }

  /**
   * 获取持仓量（Open Interest）
   */
  async getOpenInterest(symbol) {
    try {
      // CCXT提供持仓量数据（如果交易所支持）- 需要使用正确的符号格式
      const formattedSymbol = this.formatSymbol(symbol);
      const openInterest = await exchange.fetchOpenInterest(formattedSymbol);

      if (!openInterest) {
        return null;
      }

      // 从对象中提取 openInterestAmount 字段
      const result = {
        latest: openInterest.openInterestAmount || openInterest.current || 0,
        average: openInterest.openInterestAmount || openInterest.value || 0  // 使用同一个值作为平均值
      };
      return result;
    } catch (error) {
      systemLogger.warn(`获取${symbol}持仓量失败: ${error.message}`);
      return null;
    }
  }

  /**
   * 获取所有持仓（从数据库）
   */
  async getAllPositions() {
    try {
      if (!this.db) {
        systemLogger.warn('数据库未初始化，返回空持仓列表');
        return [];
      }

      return await this.db.getOpenPositions();
    } catch (error) {
      systemLogger.error(`获取所有持仓失败: ${error.message}`);
      return [];
    }
  }

  /**
   * 获取账户摘要
   */
  async getAccountSummary() {
    try {
      const balance = await this.getBalance();
      let positions = [];
      try {
        if (this.getAllPositions) {
          positions = await this.getAllPositions();
        }
      } catch (posError) {
        systemLogger.warn(`获取持仓列表失败: ${posError.message}`);
      }

      const totalValue = Object.keys(balance.total).reduce((sum, cur) => {
        const value = balance.total[cur] || 0;
        return sum + (cur === 'USDT' ? value : 0);
      }, 0);

      const activePositions = positions.map(pos => ({
        symbol: pos.symbol,
        quantity: pos.size,
        entryPrice: pos.entryPrice,
        currentPrice: pos.currentPrice || pos.markPrice,
        unrealizedPnl: pos.pnl,
        leverage: pos.leverage
      }));

      // 计算总未实现盈亏
      const totalUnrealizedPnl = activePositions.reduce((sum, pos) => sum + pos.unrealizedPnl, 0);

      // 计算已实现盈亏（从交易日志中汇总）
      let totalRealizedPnl = 0;
      try {
        if (this.db) {
          const tradeLogs = this.db.getTradeLogs(1000, 0);
          totalRealizedPnl = tradeLogs
            .filter(log => log.pnl !== null && log.pnl !== undefined)
            .reduce((sum, log) => sum + (log.pnl || 0), 0);
        }
      } catch (error) {
        systemLogger.warn(`计算已实现盈亏失败: ${error.message}`);
      }

      // 估算初始账户价值（当前总价值 - 未实现盈亏 - 已实现盈亏）
      const estimatedInitialValue = totalValue - totalUnrealizedPnl - totalRealizedPnl;

      // 计算收益率
      const totalReturnPercent = estimatedInitialValue > 0
        ? ((totalValue - estimatedInitialValue) / estimatedInitialValue) * 100
        : 0;

      return {
        availableCash: balance.free.USDT || 0,
        accountValue: totalValue,
        totalReturnPercent,
        activePositions
      };
    } catch (error) {
      systemLogger.error(`获取账户摘要失败: ${error.message}`);
      return {
        availableCash: 0,
        accountValue: 0,
        totalReturnPercent: 0,
        activePositions: []
      };
    }
  }

  /**
   * 获取交易对的精度信息
   */
  async getSymbolPrecision(symbol) {
    try {
      // 加载市场信息（如果尚未加载）
      await exchange.loadMarkets();

      // 获取格式化后的symbol
      const formattedSymbol = this.formatSymbol(symbol);

      // 从市场中获取精度信息
      const market = exchange.markets[formattedSymbol];

      if (!market) {
        systemLogger.error(`未找到${symbol}的市场信息，可用市场: ${Object.keys(exchange.markets).slice(0, 10).join(', ')}...`);
        return { amount: 5, price: 5 };
      }

      systemLogger.info(`${symbol} 市场信息: ${JSON.stringify({ id: market.id, symbol: market.symbol, precision: market.precision, limits: market.limits })}`);

      // CCXT在market.precision中提供精度信息
      const precision = market.precision || {};
      const limits = market.limits || {};

      // precision.amount/price 是步长（如 0.001），不是小数位数
      // 我们需要获取实际的小数位数或使用limits
      const stepSize = precision.amount || 0.00001;
      const minAmount = limits.amount && limits.amount.min ? limits.amount.min : null;

      systemLogger.info(`${symbol} 步长=${stepSize}, 最小数量=${minAmount}`);

      // 对于格式化数量，我们直接使用步长作为最小单位
      const amountPrecision = stepSize;
      const pricePrecision = precision.price || 0.01;

      systemLogger.info(`${symbol} 精度: amount=${amountPrecision}, price=${pricePrecision}`);

      return {
        amount: amountPrecision,
        price: pricePrecision,
      };
    } catch (error) {
      systemLogger.warn(`获取${symbol}精度信息失败: ${error.message}，使用默认精度`);
      return { amount: 5, price: 5 };
    }
  }

  /**
   * 根据交易对精度格式化数量
   * 优化版本 - 专门修复Binance精度问题
   */
  async formatAmountWithPrecision(symbol, amount) {
    try {
      // 加载市场信息
      await exchange.loadMarkets();
      const formattedSymbol = this.formatSymbol(symbol);
      const market = exchange.markets[formattedSymbol];

      if (!market) {
        systemLogger.error(`未找到${symbol}的市场信息`);
        return amount.toString();
      }

      // 打印详细的市场信息用于调试
      systemLogger.info(`${symbol} 完整市场信息: ${JSON.stringify({
        symbol: market.symbol,
        precision: market.precision,
        limits: market.limits
      })}`);

      // 优先使用CCXT原生的amount方法进行格式化（最准确）
      if (market.amount && typeof market.amount === 'function') {
        const result = market.amount(amount);
        systemLogger.info(`${symbol} 使用market.amount()格式化: ${amount} -> ${result}`);
        return result.toString();
      }

      // 使用自定义逻辑进行精确格式化
      let stepSize = market.precision.amount;

      // 处理字符串类型的步长
      if (typeof stepSize === 'string') {
        stepSize = parseFloat(stepSize);
      }

      // 如果没有precision.amount，尝试从limits.amount计算
      if (!stepSize || stepSize === 0) {
        if (market.limits.amount && market.limits.amount.step) {
          stepSize = market.limits.amount.step;
        } else {
          stepSize = 0.00001;
          systemLogger.warn(`${symbol} 未找到步长，使用默认: ${stepSize}`);
        }
      }

      // 计算步长的小数位数
      let decimalPlaces = 0;
      const stepSizeStr = stepSize.toString();
      if (stepSizeStr.includes('.')) {
        decimalPlaces = stepSizeStr.split('.')[1].length;
      }

      // 计算步数 - 使用Math.floor确保不超出目标数量
      let steps = Math.floor(amount / stepSize);

      // 确保至少有一个步长
      if (steps === 0) {
        steps = 1;
      }

      // 计算最终数量
      let finalAmount = steps * stepSize;

      // 特殊处理：使用toFixed确保严格的小数位数限制
      // 这对Binance等交易所特别重要
      if (decimalPlaces > 0) {
        finalAmount = parseFloat(finalAmount.toFixed(decimalPlaces));
      }

      // 确保不低于最小数量
      if (market.limits.amount && market.limits.amount.min) {
        const minAmount = market.limits.amount.min;
        if (finalAmount < minAmount) {
          // 如果低于最小值，设置为最小值
          finalAmount = minAmount;
          // 确保小数位数足够表示最小值
          const minDecimalPlaces = minAmount.toString().includes('.')
            ? minAmount.toString().split('.')[1].length
            : 0;
          decimalPlaces = Math.max(decimalPlaces, minDecimalPlaces);
        }
      }

      // 最终格式化：使用toFixed严格限制小数位数
      let result;
      if (decimalPlaces > 0) {
        result = finalAmount.toFixed(decimalPlaces);
      } else {
        result = finalAmount.toString();
      }

      // 移除尾部多余的零
      if (result.includes('.')) {
        result = result.replace(/\.?0+$/, '');
      }

      systemLogger.info(`${symbol} 数量格式化: ${amount} -> ${result} (步长: ${stepSize}, 步数: ${steps}, 小数位数: ${decimalPlaces})`);

      // 验证格式化后的数量是否有效
      const verifyAmount = parseFloat(result);
      if (isNaN(verifyAmount) || verifyAmount <= 0) {
        systemLogger.error(`${symbol} 格式化后的数量无效: ${result}，使用原始值`);
        return amount.toString();
      }

      return result;
    } catch (error) {
      // 如果格式化失败，回退到简单的方法
      systemLogger.warn(`格式化失败，使用简单方法: ${error.message}`);

      // 简单取整到4位小数
      const result = (Math.floor(amount * 10000) / 10000).toFixed(4);

      return result;
    }
  }

  /**
   * 等待
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new ExchangeUtils();
