const express = require('express');
const router = express.Router();

let db = null;

function setDatabase(database) {
  db = database;
}

router.get('/', (req, res) => {
  try {
    const { limit = 100, offset = 0 } = req.query;

    if (!db) {
      return res.status(503).json({
        success: false,
        error: '数据库未初始化'
      });
    }

    const logs = db.getTradeLogs(parseInt(limit), parseInt(offset));
    res.json({
      success: true,
      data: logs
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post('/', (req, res) => {
  try {
    const logData = req.body;

    if (!db) {
      return res.status(503).json({
        success: false,
        error: '数据库未初始化'
      });
    }

    const logId = db.addTradeLog(logData);

    res.json({
      success: true,
      data: { id: logId }
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
