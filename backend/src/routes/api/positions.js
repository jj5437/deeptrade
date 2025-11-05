const express = require('express');
const router = express.Router();
const exchangeUtils = require('../../controllers/exchange/ExchangeUtils');
const { systemLogger } = require('../../controllers/logger/Logger');

let db = null;

// 设置数据库实例
function setDatabase(database) {
  db = database;
}

router.get('/', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({
        success: false,
        error: '数据库未初始化'
      });
    }

    // 使用快速模式：直接从数据库读取，不调用交易所API
    // 注意：不会更新 currentPrice 和 pnl，这些通过 WebSocket 异步更新
    const positions = await db.getOpenPositions(true);

    res.json({
      success: true,
      data: positions
    });
  } catch (error) {
    console.error('获取持仓失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.get('/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;

    if (!db) {
      return res.status(503).json({
        success: false,
        error: '数据库未初始化'
      });
    }

    // 使用快速模式：直接从数据库读取
    const position = await db.getOpenPositionBySymbol(symbol, true);
    res.json({
      success: true,
      data: position
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post('/close', async (req, res) => {
  try {
    const { symbol, reason = 'manual', price } = req.body;

    if (!symbol) {
      return res.status(400).json({
        success: false,
        error: '缺少symbol参数'
      });
    }

    if (!db) {
      return res.status(503).json({
        success: false,
        error: '数据库未初始化'
      });
    }

    // 第一步：从交易所平仓
    // 需要先获取数据库中的持仓信息以确定方向
    const dbPosition = await db.getOpenPositionBySymbol(symbol);
    if (!dbPosition) {
      return res.status(404).json({
        success: false,
        error: `未找到 ${symbol} 的未平仓持仓`
      });
    }

    // 转换为交易所符号格式（带:USDT后缀）
    const exchangeSymbol = symbol.includes(':') ? symbol : `${symbol}:USDT`;
    // 数据库的side可能是 'buy'/'sell' 或 'long'/'short'，统一转换为 'long'/'short'
    const exchangeSide = dbPosition.side === 'buy' ? 'long' :
                        dbPosition.side === 'sell' ? 'short' :
                        dbPosition.side;

    // 调用交易所API平仓
    systemLogger.info(`API路由发起平仓请求: ${exchangeSymbol} ${exchangeSide} ${dbPosition.size}`);
    const exchangeResult = await exchangeUtils.closePosition(
      exchangeSymbol,
      exchangeSide,
      dbPosition.size
    );

    // 第二步：更新数据库记录（PnL, status, performance_stats）
    // price参数现在可选，closePositionBySymbol会自动获取当前价格
    const pnl = await db.closePositionBySymbol(symbol, price, reason);

    res.json({
      success: true,
      data: { pnl, exchangeResult }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 导出设置数据库实例的方法
module.exports = router;
module.exports.setDatabase = setDatabase;
