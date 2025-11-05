const express = require('express');
const router = express.Router();

let db = null;
let configController = null;

// 设置数据库实例和配置控制器
function setDatabase(database) {
  db = database;
  // 创建配置控制器实例，传入数据库实例
  const ConfigController = require('../../controllers/settings/ConfigController');
  configController = new ConfigController(database);
}

/**
 * GET /api/config - 获取配置
 */
router.get('/', async (req, res) => {
  try {
    if (!configController) {
      return res.status(503).json({
        success: false,
        error: '配置控制器未初始化'
      });
    }

    const config = await configController.getConfig();

    res.json({
      success: true,
      data: config
    });
  } catch (error) {
    console.error('获取配置失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/config - 更新配置
 */
router.post('/', async (req, res) => {
  try {
    if (!configController) {
      return res.status(503).json({
        success: false,
        error: '配置控制器未初始化'
      });
    }

    const updates = req.body;

    const updatedConfig = await configController.updateConfig(updates);

    res.json({
      success: true,
      message: '配置已更新',
      data: updatedConfig
    });
  } catch (error) {
    console.error('更新配置失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/config/reset - 重置配置
 */
router.post('/reset', async (req, res) => {
  try {
    if (!configController) {
      return res.status(503).json({
        success: false,
        error: '配置控制器未初始化'
      });
    }

    const defaultConfig = await configController.resetConfig();

    res.json({
      success: true,
      message: '配置已重置为默认值',
      data: defaultConfig
    });
  } catch (error) {
    console.error('重置配置失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
module.exports.setDatabase = setDatabase;
