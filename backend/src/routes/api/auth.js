const express = require('express');
const router = express.Router();
const { systemLogger } = require('../../controllers/logger/Logger');
const { env } = require('../../config');

/**
 * POST /api/auth/login
 * 用户登录
 */
router.post('/login', (req, res) => {
  try {
    const { username, password } = req.body;

    // 检查用户名和密码
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: '请输入用户名和密码'
      });
    }

    // 验证凭据
    if (username === env.web.adminUsername && password === env.web.adminPassword) {
      // 设置会话
      req.session.authenticated = true;
      req.session.username = username;
      req.session.loginTime = new Date().toISOString();

      systemLogger.info(`用户登录成功: ${username} from ${req.ip}`);

      return res.json({
        success: true,
        message: '登录成功',
        user: {
          username: username,
          loginTime: req.session.loginTime
        }
      });
    } else {
      systemLogger.warn(`登录失败: 用户名或密码错误 from ${req.ip}`, { username });

      return res.status(401).json({
        success: false,
        error: '用户名或密码错误'
      });
    }
  } catch (error) {
    systemLogger.error(`登录过程中发生错误: ${error.message}`, { stack: error.stack });
    return res.status(500).json({
      success: false,
      error: '登录过程中发生错误'
    });
  }
});

/**
 * POST /api/auth/logout
 * 用户登出
 */
router.post('/logout', (req, res) => {
  try {
    const username = req.session?.username || '未知用户';

    // 销毁会话
    req.session.destroy((err) => {
      if (err) {
        systemLogger.error(`登出过程中发生错误: ${error.message}`, { stack: error.stack });
        return res.status(500).json({
          success: false,
          error: '登出失败'
        });
      }

      systemLogger.info(`用户登出成功: ${username} from ${req.ip}`);

      return res.json({
        success: true,
        message: '登出成功'
      });
    });
  } catch (error) {
    systemLogger.error(`登出过程中发生错误: ${error.message}`, { stack: error.stack });
    return res.status(500).json({
      success: false,
      error: '登出过程中发生错误'
    });
  }
});

/**
 * GET /api/auth/status
 * 获取当前登录状态
 */
router.get('/status', (req, res) => {
  try {
    if (req.session && req.session.authenticated) {
      return res.json({
        success: true,
        authenticated: true,
        user: {
          username: req.session.username,
          loginTime: req.session.loginTime
        }
      });
    } else {
      return res.json({
        success: true,
        authenticated: false
      });
    }
  } catch (error) {
    systemLogger.error(`获取登录状态时发生错误: ${error.message}`, { stack: error.stack });
    return res.status(500).json({
      success: false,
      error: '获取登录状态失败'
    });
  }
});

/**
 * GET /api/auth/ping
 * Session活跃性检查 - 用于保持session活跃
 */
router.get('/ping', (req, res) => {
  try {
    if (req.session && req.session.authenticated) {
      // 更新session的最后访问时间
      req.session.lastPing = new Date().toISOString();

      return res.json({
        success: true,
        authenticated: true,
        message: 'session活跃',
        lastPing: req.session.lastPing
      });
    } else {
      return res.json({
        success: true,
        authenticated: false,
        message: 'session已过期'
      });
    }
  } catch (error) {
    systemLogger.error(`Session ping失败: ${error.message}`, { stack: error.stack });
    return res.status(500).json({
      success: false,
      error: 'Session ping失败'
    });
  }
});

module.exports = router;
