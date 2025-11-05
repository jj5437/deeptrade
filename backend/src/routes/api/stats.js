const express = require('express');
const router = express.Router();

let db = null;

function setDatabase(database) {
  db = database;
}

router.get('/:symbol', (req, res) => {
  try {
    const { symbol } = req.params;

    if (!db) {
      return res.status(503).json({
        success: false,
        error: '数据库未初始化'
      });
    }

    const stats = db.getPerformanceStats(symbol);

    if (!stats) {
      return res.status(404).json({
        success: false,
        error: '未找到统计数据'
      });
    }

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post('/:symbol', (req, res) => {
  try {
    const { symbol } = req.params;
    const stats = req.body;

    if (!db) {
      return res.status(503).json({
        success: false,
        error: '数据库未初始化'
      });
    }

    mockDb.updatePerformanceStats(symbol, stats);

    res.json({
      success: true,
      message: '统计数据已更新'
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
