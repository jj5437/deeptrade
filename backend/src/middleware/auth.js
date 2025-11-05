const { systemLogger } = require('../controllers/logger/Logger');
const { env } = require('../config');

/**
 * 认证中间件 - 检查用户是否已登录
 */
const requireAuth = (req, res, next) => {
  if (req.session && req.session.authenticated) {
    return next();
  }

  systemLogger.warn(`未授权访问尝试: ${req.ip} - ${req.path}`);
  return res.status(401).json({
    success: false,
    error: '未授权访问，请先登录'
  });
};

/**
 * 可选认证中间件 - 如果已登录则设置用户信息，否则继续
 */
const optionalAuth = (req, res, next) => {
  if (req.session && req.session.authenticated) {
    req.user = {
      username: req.session.username
    };
  }
  return next();
};

module.exports = {
  requireAuth,
  optionalAuth
};
