const express = require('express');
const router = express.Router();

let db = null;

function setDatabase(database) {
  db = database;
}

router.get('/signals/:symbol', (req, res) => {
  try {
    const { symbol } = req.params;
    const { limit = 10 } = req.query;

    if (!db) {
      return res.status(503).json({
        success: false,
        error: '数据库未初始化'
      });
    }

    const signals = db.getRecentAiSignals(symbol, parseInt(limit));
    res.json({
      success: true,
      data: signals
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 获取所有币种的最新AI信号（最多50条）
 */
router.get('/signals', (req, res) => {
  try {
    const { limit = 50 } = req.query;

    if (!db) {
      return res.status(503).json({
        success: false,
        error: '数据库未初始化'
      });
    }

    const stmt = db.db.prepare(`
      SELECT * FROM ai_signals ORDER BY timestamp DESC LIMIT ?
    `);
    const signals = stmt.all(parseInt(limit));

    const formattedSignals = signals.map(signal => ({
      id: signal.id.toString(),
      symbol: signal.symbol,
      signal: signal.signal,
      confidence: signal.confidence,
      reason: signal.reason,
      timestamp: new Date(signal.timestamp).getTime()
    }));

    res.json({
      success: true,
      data: formattedSignals
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 获取总决策数统计
 */
router.get('/stats', (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({
        success: false,
        error: '数据库未初始化'
      });
    }

    const totalStmt = db.db.prepare(`SELECT COUNT(*) as count FROM ai_signals`);
    const totalResult = totalStmt.get();
    const totalDecisions = totalResult.count;

    // 从performance_stats表获取统计信息
    const statsStmt = db.db.prepare(`
      SELECT
        SUM(total_trades) as total_trades,
        SUM(winning_trades) as winning_trades,
        SUM(total_pnl) as total_pnl
      FROM performance_stats
    `);
    const statsResult = statsStmt.get();
    const totalTrades = statsResult.total_trades || 0;
    const winningTrades = statsResult.winning_trades || 0;
    const totalPnl = statsResult.total_pnl || 0;

    // 如果performance_stats中没有数据，尝试从ai_signals表计算
    const finalStats = {
      totalDecisions: totalTrades > 0 ? totalTrades : totalDecisions,
      successfulDecisions: winningTrades,
      accuracy: totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0,
      totalProfit: totalPnl
    };

    res.json({
      success: true,
      data: finalStats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post('/signals', (req, res) => {
  try {
    const signalData = req.body;

    if (!db) {
      return res.status(503).json({
        success: false,
        error: '数据库未初始化'
      });
    }

    const signalId = db.saveAiSignal(signalData);

    res.json({
      success: true,
      data: { id: signalId }
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
