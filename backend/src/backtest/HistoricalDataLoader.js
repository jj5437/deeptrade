const ccxt = require('ccxt');
const fs = require('fs');
const path = require('path');
const { systemLogger } = require('../controllers/logger/Logger');

/**
 * 历史数据加载器
 * 从币安获取历史K线数据并保存到本地
 */
class HistoricalDataLoader {
  constructor() {
    this.exchange = new ccxt.binance({
      enableRateLimit: true,
      options: {
        defaultType: 'future', // 使用合约市场
      }
    });
    
    this.dataDir = path.join(__dirname, '../../data/klines');
    this.ensureDataDirectory();
  }

  /**
   * 确保数据目录存在
   */
  ensureDataDirectory() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
      systemLogger.info(`📁 创建数据目录: ${this.dataDir}`);
    }
  }

  /**
   * 获取历史K线数据
   * @param {string} symbol - 交易对 (e.g., 'BTC/USDT')
   * @param {string} timeframe - 时间周期 (e.g., '1m', '3m', '1h')
   * @param {Date} startTime - 开始时间
   * @param {Date} endTime - 结束时间
   * @returns {Promise<Array>} K线数据数组
   */
  async fetchHistoricalData(symbol, timeframe, startTime, endTime) {
    systemLogger.info(`📊 开始获取历史数据: ${symbol} ${timeframe}`);
    systemLogger.info(`   时间范围: ${startTime.toISOString()} -> ${endTime.toISOString()}`);

    const allKlines = [];
    let currentTime = startTime.getTime();
    const endTimestamp = endTime.getTime();
    
    // 计算时间周期的毫秒数
    const timeframeMs = this.getTimeframeMilliseconds(timeframe);
    const limit = 1500; // 币安API单次最多返回1500根K线
    
    let batchCount = 0;
    const totalBatches = Math.ceil((endTimestamp - currentTime) / (timeframeMs * limit));

    while (currentTime < endTimestamp) {
      try {
        batchCount++;
        systemLogger.info(`   批次 ${batchCount}/${totalBatches}: 获取从 ${new Date(currentTime).toISOString()} 开始的数据...`);

        // 获取K线数据
        const klines = await this.exchange.fetchOHLCV(
          symbol,
          timeframe,
          currentTime,
          limit
        );

        if (!klines || klines.length === 0) {
          systemLogger.warn(`   批次 ${batchCount}: 未获取到数据，结束`);
          break;
        }

        // 过滤掉超出结束时间的K线
        const filteredKlines = klines.filter(k => k[0] <= endTimestamp);
        allKlines.push(...filteredKlines);

        // 更新当前时间为最后一根K线的时间 + 1个周期
        const lastKlineTime = klines[klines.length - 1][0];
        currentTime = lastKlineTime + timeframeMs;

        // 如果返回的K线少于limit，说明已经到达最新数据
        if (klines.length < limit) {
          systemLogger.info(`   批次 ${batchCount}: 已获取到所有可用数据`);
          break;
        }

        // 防止API限流，稍作延迟
        await this.sleep(500);

      } catch (error) {
        systemLogger.error(`   批次 ${batchCount} 获取失败: ${error.message}`);
        
        // 如果是限流错误，等待更长时间后重试
        if (error.message.includes('rate limit') || error.message.includes('429')) {
          systemLogger.warn('   触发API限流，等待60秒后重试...');
          await this.sleep(60000);
          continue;
        }
        
        throw error;
      }
    }

    systemLogger.info(`✅ 历史数据获取完成: 共 ${allKlines.length} 根K线`);
    return allKlines;
  }

  /**
   * 保存K线数据到CSV文件
   * @param {Array} klines - K线数据
   * @param {string} symbol - 交易对
   * @param {string} timeframe - 时间周期
   * @param {Date} startTime - 开始时间
   * @param {Date} endTime - 结束时间
   * @returns {string} 保存的文件路径
   */
  saveToCSV(klines, symbol, timeframe, startTime, endTime) {
    const filename = this.generateFilename(symbol, timeframe, startTime, endTime);
    const filepath = path.join(this.dataDir, filename);

    // CSV头部
    const headers = 'timestamp,datetime,open,high,low,close,volume\n';
    
    // 转换K线数据为CSV行
    const rows = klines.map(k => {
      const [timestamp, open, high, low, close, volume] = k;
      const datetime = new Date(timestamp).toISOString();
      return `${timestamp},${datetime},${open},${high},${low},${close},${volume}`;
    }).join('\n');

    // 写入文件
    fs.writeFileSync(filepath, headers + rows, 'utf-8');
    
    const fileSizeMB = (fs.statSync(filepath).size / 1024 / 1024).toFixed(2);
    systemLogger.info(`💾 数据已保存: ${filename} (${fileSizeMB} MB)`);
    
    return filepath;
  }

  /**
   * 从CSV文件加载K线数据
   * @param {string} filepath - 文件路径
   * @returns {Array} K线数据数组
   */
  loadFromCSV(filepath) {
    if (!fs.existsSync(filepath)) {
      throw new Error(`文件不存在: ${filepath}`);
    }

    const content = fs.readFileSync(filepath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim() !== '');
    
    // 跳过头部
    const dataLines = lines.slice(1);
    
    const klines = dataLines.map(line => {
      const [timestamp, datetime, open, high, low, close, volume] = line.split(',');
      return [
        parseInt(timestamp),
        parseFloat(open),
        parseFloat(high),
        parseFloat(low),
        parseFloat(close),
        parseFloat(volume)
      ];
    });

    systemLogger.info(`📂 从文件加载数据: ${path.basename(filepath)} (${klines.length} 根K线)`);
    return klines;
  }

  /**
   * 检查本地是否已有数据文件
   * @param {string} symbol - 交易对
   * @param {string} timeframe - 时间周期
   * @param {Date} startTime - 开始时间
   * @param {Date} endTime - 结束时间
   * @returns {string|null} 文件路径或null
   */
  checkLocalData(symbol, timeframe, startTime, endTime) {
    const filename = this.generateFilename(symbol, timeframe, startTime, endTime);
    const filepath = path.join(this.dataDir, filename);
    
    if (fs.existsSync(filepath)) {
      const stats = fs.statSync(filepath);
      const fileSizeMB = (stats.size / 1024 / 1024).toFixed(2);
      systemLogger.info(`📂 发现本地数据文件: ${filename} (${fileSizeMB} MB)`);
      return filepath;
    }
    
    return null;
  }

  /**
   * 获取或下载历史数据
   * @param {string} symbol - 交易对
   * @param {string} timeframe - 时间周期
   * @param {Date} startTime - 开始时间
   * @param {Date} endTime - 结束时间
   * @param {boolean} forceDownload - 是否强制重新下载
   * @returns {Promise<Array>} K线数据
   */
  async getHistoricalData(symbol, timeframe, startTime, endTime, forceDownload = false) {
    // 检查本地是否已有数据
    if (!forceDownload) {
      const localFile = this.checkLocalData(symbol, timeframe, startTime, endTime);
      if (localFile) {
        return this.loadFromCSV(localFile);
      }
    }

    // 从交易所获取数据
    const klines = await this.fetchHistoricalData(symbol, timeframe, startTime, endTime);
    
    // 保存到本地
    this.saveToCSV(klines, symbol, timeframe, startTime, endTime);
    
    return klines;
  }

  /**
   * 生成文件名
   * @private
   */
  generateFilename(symbol, timeframe, startTime, endTime) {
    const symbolClean = symbol.replace('/', '_');
    const start = startTime.toISOString().split('T')[0];
    const end = endTime.toISOString().split('T')[0];
    return `${symbolClean}_${timeframe}_${start}_${end}.csv`;
  }

  /**
   * 获取时间周期的毫秒数
   * @private
   */
  getTimeframeMilliseconds(timeframe) {
    const units = {
      's': 1000,
      'm': 60 * 1000,
      'h': 60 * 60 * 1000,
      'd': 24 * 60 * 60 * 1000,
      'w': 7 * 24 * 60 * 60 * 1000,
      'M': 30 * 24 * 60 * 60 * 1000
    };

    const value = parseInt(timeframe.slice(0, -1)) || 1;
    const unit = timeframe.slice(-1);
    
    return value * (units[unit] || units['m']);
  }

  /**
   * 等待指定毫秒数
   * @private
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 计算ATR指标（用于动态滑点）
   * @param {Array} klines - K线数据
   * @param {number} period - ATR周期
   * @returns {Array} ATR值数组
   */
  calculateATR(klines, period = 14) {
    const atrValues = [];
    const trueRanges = [];

    for (let i = 0; i < klines.length; i++) {
      const [, , high, low, close] = klines[i];
      
      if (i === 0) {
        // 第一根K线，TR = high - low
        trueRanges.push(high - low);
      } else {
        const prevClose = klines[i - 1][4];
        const tr = Math.max(
          high - low,
          Math.abs(high - prevClose),
          Math.abs(low - prevClose)
        );
        trueRanges.push(tr);
      }

      // 计算ATR（简单移动平均）
      if (i >= period - 1) {
        const atr = trueRanges.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
        atrValues.push(atr);
      } else {
        atrValues.push(null);
      }
    }

    return atrValues;
  }

  /**
   * 数据完整性检查
   * @param {Array} klines - K线数据
   * @param {string} timeframe - 时间周期
   * @returns {Object} 检查结果
   */
  checkDataIntegrity(klines, timeframe) {
    const timeframeMs = this.getTimeframeMilliseconds(timeframe);
    let missingCount = 0;
    const missingPeriods = [];

    for (let i = 1; i < klines.length; i++) {
      const timeDiff = klines[i][0] - klines[i - 1][0];
      if (timeDiff > timeframeMs) {
        missingCount++;
        const expectedBars = Math.floor(timeDiff / timeframeMs) - 1;
        missingPeriods.push({
          from: new Date(klines[i - 1][0]).toISOString(),
          to: new Date(klines[i][0]).toISOString(),
          missingBars: expectedBars
        });
      }
    }

    const result = {
      totalBars: klines.length,
      missingPeriods: missingCount,
      completeness: ((klines.length / (klines.length + missingCount)) * 100).toFixed(2) + '%',
      details: missingPeriods.slice(0, 10) // 只显示前10个缺失周期
    };

    if (missingCount > 0) {
      systemLogger.warn(`⚠️ 数据完整性检查: 发现 ${missingCount} 个缺失周期`);
      if (missingPeriods.length > 10) {
        systemLogger.warn(`   (仅显示前10个，共 ${missingPeriods.length} 个)`);
      }
    } else {
      systemLogger.info(`✅ 数据完整性检查: 数据连续完整`);
    }

    return result;
  }

  /**
   * 获取数据统计信息
   * @param {Array} klines - K线数据
   * @returns {Object} 统计信息
   */
  getDataStatistics(klines) {
    if (!klines || klines.length === 0) {
      return null;
    }

    // 使用循环而非展开运算符，避免大数据量时栈溢出
    let minPrice = Infinity;
    let maxPrice = -Infinity;
    let minVolume = Infinity;
    let maxVolume = -Infinity;
    let sumPrice = 0;
    let sumVolume = 0;

    for (let i = 0; i < klines.length; i++) {
      const price = klines[i][4];  // close price
      const volume = klines[i][5];
      
      if (price < minPrice) minPrice = price;
      if (price > maxPrice) maxPrice = price;
      if (volume < minVolume) minVolume = volume;
      if (volume > maxVolume) maxVolume = volume;
      
      sumPrice += price;
      sumVolume += volume;
    }

    const firstPrice = klines[0][4];
    const lastPrice = klines[klines.length - 1][4];

    const stats = {
      bars: klines.length,
      startTime: new Date(klines[0][0]).toISOString(),
      endTime: new Date(klines[klines.length - 1][0]).toISOString(),
      duration: {
        days: ((klines[klines.length - 1][0] - klines[0][0]) / (1000 * 60 * 60 * 24)).toFixed(2),
        hours: ((klines[klines.length - 1][0] - klines[0][0]) / (1000 * 60 * 60)).toFixed(2)
      },
      price: {
        min: minPrice,
        max: maxPrice,
        mean: (sumPrice / klines.length).toFixed(2),
        start: firstPrice,
        end: lastPrice,
        change: (((lastPrice - firstPrice) / firstPrice) * 100).toFixed(2) + '%'
      },
      volume: {
        min: minVolume,
        max: maxVolume,
        mean: (sumVolume / klines.length).toFixed(2),
        total: sumVolume.toFixed(2)
      }
    };

    return stats;
  }
}

module.exports = HistoricalDataLoader;

