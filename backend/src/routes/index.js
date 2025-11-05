const express = require('express');
const router = express.Router();

/**
 * 首页路由
 */
router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'DeepTrade Backend API',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
