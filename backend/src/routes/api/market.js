const express = require('express');
const router = express.Router();
const exchangeUtils = require('../../controllers/exchange/ExchangeUtils');
const { systemLogger } = require('../../controllers/logger/Logger');

let db = null;
let tradingEngine = null;

function setDatabase(database) {
  db = database;
}

function setTradingEngine(engine) {
  tradingEngine = engine;
}

/**
 * 获取市场数据
 * 优先使用WebSocket缓存，失败时回退到REST API
 */
router.get('/', async (req, res) => {
  try {
    // 获取交易对列表 - 固定6个币种
    const symbols = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'DOGE/USDT', 'XRP/USDT', 'BNB/USDT'];

    // 优先使用WebSocket缓存
    const marketDataMap = new Map(); // 使用Map确保唯一性
    if (tradingEngine && tradingEngine.tickerWebSocket) {
      systemLogger.info('使用WebSocket缓存获取市场数据');
      for (const symbol of symbols) {
        try {
          const ticker = await tradingEngine.tickerWebSocket.getTicker(symbol);
         
          if (ticker) {
            // 验证数据有效性
            if (typeof ticker.price !== 'number' || isNaN(ticker.price)) {
              systemLogger.error(`❌ ${symbol} 价格数据无效: price=${ticker.price}, 类型=${typeof ticker.price}, ticker对象=${JSON.stringify(ticker)}`);
              continue;
            }

            // 将symbol从 "ETHUSDT" 转换为 "ETH/USDT" 格式
            let formattedSymbol = ticker.symbol;
            if (ticker.symbol && ticker.symbol.endsWith('USDT')) {
              formattedSymbol = ticker.symbol.replace('USDT', '/USDT');
            }

            // 验证转换后的symbol格式
            if (!formattedSymbol || !formattedSymbol.includes('/USDT')) {
              systemLogger.warn(`${symbol} Symbol格式错误: ${formattedSymbol}，跳过`);
              continue;
            }

            // 转换为市场数据格式
            const marketDataItem = {
              symbol: formattedSymbol,
              price: ticker.price,
              change24h: ticker.change24h,
              changePercent24h: ticker.changePercent24h,
              high24h: ticker.high24h,
              low24h: ticker.low24h,
              volume24h: ticker.volume24h,
              timestamp: ticker.timestamp
            };

            // 使用Map确保唯一性（以formattedSymbol为key）
            marketDataMap.set(formattedSymbol, marketDataItem);
          }
        } catch (error) {
          // 静默处理错误
          systemLogger.warn(`获取${symbol}市场数据失败: ${error.message}`);
        }
      }
    } else {
      // 没有WebSocket，静默返回空数据
      systemLogger.warn('WebSocket未就绪，跳过市场数据获取');
    }

    // 将Map转换为数组，并按固定顺序排序
    const marketData = symbols
      .map(symbol => marketDataMap.get(symbol))
      .filter(item => item !== undefined); // 过滤掉undefined的数据

    systemLogger.info(`返回市场数据: ${marketData.length} 个交易对`);

    res.json({
      success: true,
      data: marketData
    });
  } catch (error) {
    systemLogger.error(`获取市场数据失败: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 获取单个交易对的市场数据
 * 优先使用WebSocket缓存，失败时回退到REST API
 */
router.get('/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;

    // 优先使用WebSocket缓存
    if (tradingEngine && tradingEngine.tickerWebSocket) {
      const ticker = await tradingEngine.tickerWebSocket.getTicker(symbol);
      if (ticker) {
        // 将symbol从 "ETHUSDT" 转换为 "ETH/USDT" 格式
        let formattedSymbol = ticker.symbol;
        if (ticker.symbol && ticker.symbol.endsWith('USDT')) {
          formattedSymbol = ticker.symbol.replace('USDT', '/USDT');
        }

        res.json({
          success: true,
          data: {
            symbol: formattedSymbol,
            price: ticker.price,
            change24h: ticker.change24h,
            changePercent24h: ticker.changePercent24h,
            high24h: ticker.high24h,
            low24h: ticker.low24h,
            volume24h: ticker.volume24h,
            timestamp: ticker.timestamp
          }
        });
        return;
      }
    }

    // 缓存未就绪，静默返回空数据，不使用REST API
    return res.status(503).json({
      success: false,
      error: '市场数据暂未就绪，请稍后再试'
    });

    res.json({
      success: true,
      data: marketData
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
module.exports.setDatabase = setDatabase;
module.exports.setTradingEngine = setTradingEngine;
