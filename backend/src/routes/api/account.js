const express = require('express');
const router = express.Router();

let exchangeUtils = null;

// 设置exchangeUtils实例
function setExchangeUtils(utils) {
  exchangeUtils = utils;
}

router.get('/', async (req, res) => {
  try {
    if (!exchangeUtils) {
      return res.status(503).json({
        success: false,
        error: '交易所工具未初始化'
      });
    }

    const accountSummary = await exchangeUtils.getAccountSummary();

    res.json({
      success: true,
      data: accountSummary
    });
  } catch (error) {
    console.error('获取账户信息失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 导出设置exchangeUtils实例的方法
module.exports = router;
module.exports.setExchangeUtils = setExchangeUtils;
