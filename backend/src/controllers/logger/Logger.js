const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const env = require('../../config/env');
const fs = require('fs');
const path = require('path');

/**
 * 日志系统 - 按小时轮转
 */

// 确保日志目录存在
if (!fs.existsSync(env.paths.logs)) {
  fs.mkdirSync(env.paths.logs, { recursive: true });
}

// 自定义日志格式
const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack }) => {
    return `${timestamp} [${level.toUpperCase()}]: ${stack || message}`;
  })
);

// 控制台格式
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({
    format: 'HH:mm:ss'
  }),
  winston.format.printf(({ timestamp, level, message }) => {
    return `${timestamp} [${level}]: ${message}`;
  })
);

/**
 * 创建按小时轮转的文件传输器
 */
const createHourlyRotateTransport = (filename) => {
  return new DailyRotateFile({
    filename: path.join(env.paths.logs, `${filename}_%DATE%.log`),
    datePattern: 'YYYYMMDD_HH',
    zippedArchive: true,
    maxSize: env.logging.maxSize,
    maxFiles: env.logging.maxFiles,
    format: logFormat
  });
};

// 创建传输器 - 分离system和api日志
const transports = [
  // 系统日志 - 所有级别的日志（info、error、warn、debug等）
  createHourlyRotateTransport('system'),
  // API日志 - 专门的API调用日志
  new DailyRotateFile({
    filename: path.join(env.paths.logs, 'api_%DATE%.log'),
    datePattern: 'YYYYMMDD_HH',
    zippedArchive: true,
    maxSize: env.logging.maxSize,
    maxFiles: '168h', // 保留168小时（7天）
    format: logFormat
  })
];

// 创建Winston日志器
const logger = winston.createLogger({
  level: env.logging.level,
  format: logFormat,
  transports: [
    transports[0] // 只将system日志作为主logger
  ],
  // 异常和拒绝也写入到system日志，不单独创建文件
  exceptionHandlers: [
    createHourlyRotateTransport('system')
  ],
  rejectionHandlers: [
    createHourlyRotateTransport('system')
  ]
});

// 添加控制台输出
if (process.env.NODE_ENV !== 'test') {
  logger.add(new winston.transports.Console({
    format: consoleFormat
  }));
}

// 监听轮转事件
transports.forEach(transport => {
  transport.on('rotate', (oldFilename, newFilename) => {
    logger.info(`日志文件已轮转: ${oldFilename} -> ${newFilename}`);
  });

  transport.on('archive', (zipFilename) => {
    logger.info(`日志文件已压缩: ${zipFilename}`);
  });

  transport.on('logRemoved', (removedFilename) => {
    logger.info(`旧日志文件已删除: ${removedFilename}`);
  });
});

/**
 * 系统日志记录器
 */
const systemLogger = {
  info: (message, meta = {}) => logger.info(message, meta),
  error: (message, meta = {}) => logger.error(message, meta),
  warn: (message, meta = {}) => logger.warn(message, meta),
  debug: (message, meta = {}) => logger.debug(message, meta)
};

/**
 * API日志记录器 - 独立的Winston logger实例
 */
const apiLogger = winston.createLogger({
  level: env.logging.level,
  format: logFormat,
  transports: [
    // 只输出到API日志文件
    new DailyRotateFile({
      filename: path.join(env.paths.logs, 'api_%DATE%.log'),
      datePattern: 'YYYYMMDD_HH',
      zippedArchive: true,
      maxSize: env.logging.maxSize,
      maxFiles: '168h' // 保留168小时（7天）
    })
  ]
});

module.exports = {
  logger,
  systemLogger,
  apiLogger
};
