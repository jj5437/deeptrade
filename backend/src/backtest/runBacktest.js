#!/usr/bin/env node

/**
 * 回测运行脚本
 * 独立运行回测系统
 */

require('dotenv').config();
const HistoricalDataLoader = require('./HistoricalDataLoader');
const BacktestEngine = require('./BacktestEngine');
const { systemLogger } = require('../controllers/logger/Logger');

/**
 * 将1分钟K线合并为2分钟K线
 * @param {Array} klines1m - 1分钟K线数组 [timestamp, open, high, low, close, volume]
 * @returns {Array} 合并后的2分钟K线数组
 */
function merge1mTo2m(klines1m) {
  if (!klines1m || klines1m.length === 0) {
    return [];
  }

  const klines2m = [];
  
  // 每2根1分钟K线合并成1根2分钟K线
  for (let i = 0; i < klines1m.length - 1; i += 2) {
    const k1 = klines1m[i];
    const k2 = klines1m[i + 1];
    
    if (!k1 || !k2) {
      break; // 如果最后一根K线没有配对，跳过
    }

    // 合并逻辑：
    // timestamp: 第一根K线的时间戳
    // open: 第一根K线的开盘价
    // high: 两根K线的最高价
    // low: 两根K线的最低价
    // close: 第二根K线的收盘价
    // volume: 两根K线的成交量之和
    const mergedKline = [
      k1[0],                    // timestamp (第一根的时间)
      k1[1],                    // open (第一根的开盘价)
      Math.max(k1[2], k2[2]),  // high (最高价)
      Math.min(k1[3], k2[3]),  // low (最低价)
      k2[4],                    // close (第二根的收盘价)
      k1[5] + k2[5]            // volume (成交量之和)
    ];
    
    klines2m.push(mergedKline);
  }

  return klines2m;
}

/**
 * 从环境变量或使用默认值
 */
function getConfig() {
  return {
    // 基础参数
    symbol: process.env.BACKTEST_SYMBOL || 'BTC/USDT',
    timeframe: process.env.BACKTEST_TIMEFRAME || '2m', // 新策略需要2分钟K线
    startTime: new Date(process.env.BACKTEST_START || '2024-01-01T00:00:00Z'),
    endTime: new Date(process.env.BACKTEST_END || '2025-06-30T23:59:00Z'),
    
    // 资金参数
    initialCapital: parseFloat(process.env.BACKTEST_INITIAL_CAPITAL || process.env.INITIAL_CAPITAL || '10000'),
    positionUsd: parseFloat(process.env.BACKTEST_POSITION_USD || '1000'),
    leverage: parseInt(process.env.BACKTEST_LEVERAGE || process.env.LEVERAGE || '10'),
    feeRate: parseFloat(process.env.BACKTEST_FEE_RATE || '0.0004'),
    
    // 止损止盈（优化：放宽以提高震荡市胜率）
    stopLossPct: parseFloat(process.env.BACKTEST_STOP_LOSS_PCT || '0.010'),  // 1.0%（原0.6%）
    takeProfitPct: parseFloat(process.env.BACKTEST_TAKE_PROFIT_PCT || '0.020'),  // 2.0%（原1.2%）
    
    // 滑点配置
    slippageMode: process.env.BACKTEST_SLIPPAGE_MODE || 'fixed',
    fixedSlippage: parseFloat(process.env.BACKTEST_FIXED_SLIPPAGE || '0.0005'),
    atrPeriod: parseInt(process.env.BACKTEST_ATR_PERIOD || '14'),
    atrFactor: parseFloat(process.env.BACKTEST_ATR_FACTOR || '0.1'),
    
    // 分市场状态
    regimeSegments: [
      {
        name: 'bull_2024',
        start: '2024-01-01T00:00:00Z',
        end: '2024-12-31T23:59:00Z'
      },
      {
        name: 'bear_2025',
        start: '2025-01-01T00:00:00Z',
        end: '2025-12-31T23:59:00Z'
      }
    ],
    
    // 参数网格（用于参数敏感性测试）
    paramGrid: null
  };
}

/**
 * 解析参数网格
 */
function parseParamGrid() {
  const grid = {};
  
  // 模块B参数
  if (process.env.PARAMGRID_B_ZLOCAL) {
    grid.zLocal = process.env.PARAMGRID_B_ZLOCAL.split(',').map(v => parseFloat(v.trim()));
  }
  if (process.env.PARAMGRID_B_ZGLOBAL) {
    grid.zGlobal = process.env.PARAMGRID_B_ZGLOBAL.split(',').map(v => parseFloat(v.trim()));
  }
  if (process.env.PARAMGRID_B_GROWTHRATIO) {
    grid.growthRatio = process.env.PARAMGRID_B_GROWTHRATIO.split(',').map(v => parseFloat(v.trim()));
  }
  
  // 模块C参数
  if (process.env.PARAMGRID_C_DELTA) {
    grid.delta = process.env.PARAMGRID_C_DELTA.split(',').map(v => parseFloat(v.trim()));
  }
  
  return Object.keys(grid).length > 0 ? grid : null;
}

/**
 * 主函数
 */
async function main() {
  try {
    console.log('\n' + '='.repeat(80));
    console.log('DeepTrade 回测系统');
    console.log('='.repeat(80));
    console.log('');

    // 获取配置
    const config = getConfig();
    config.paramGrid = parseParamGrid();

    // 显示配置信息
    systemLogger.info('📋 回测配置:');
    systemLogger.info(`   交易对: ${config.symbol}`);
    systemLogger.info(`   时间周期: ${config.timeframe}`);
    systemLogger.info(`   开始时间: ${config.startTime.toISOString()}`);
    systemLogger.info(`   结束时间: ${config.endTime.toISOString()}`);
    systemLogger.info(`   初始资金: $${config.initialCapital}`);
    systemLogger.info(`   每笔金额: $${config.positionUsd}`);
    systemLogger.info(`   杠杆: ${config.leverage}x`);
    systemLogger.info(`   手续费率: ${(config.feeRate * 100).toFixed(3)}%`);
    systemLogger.info(`   止损: ${(config.stopLossPct * 100).toFixed(2)}%`);
    systemLogger.info(`   止盈: ${(config.takeProfitPct * 100).toFixed(2)}%`);
    systemLogger.info('');

    // 步骤1: 加载历史数据
    systemLogger.info('📥 步骤1: 加载历史数据...');
    const dataLoader = new HistoricalDataLoader();
    
    // 新策略需要2分钟K线，但币安只支持1分钟K线
    // 因此获取1分钟K线，然后合并成2分钟K线
    let klines;
    if (config.timeframe === '2m' || config.timeframe === '2') {
      systemLogger.info('   策略需要2分钟K线，将从1分钟K线合并...');
      // 获取1分钟K线（需要更多数据以合并）
      const klines1m = await dataLoader.getHistoricalData(
        config.symbol,
        '1m',
        config.startTime,
        config.endTime,
        false // 不强制重新下载
      );
      
      // 合并成2分钟K线
      klines = merge1mTo2m(klines1m);
      systemLogger.info(`   ✅ 获取${klines1m.length}根1分钟K线，合并为${klines.length}根2分钟K线`);
    } else {
      klines = await dataLoader.getHistoricalData(
        config.symbol,
        config.timeframe,
        config.startTime,
        config.endTime,
        false // 不强制重新下载
      );
    }

    // 数据完整性检查（使用实际的时间周期）
    const actualTimeframe = (config.timeframe === '2m' || config.timeframe === '2') ? '2m' : config.timeframe;
    const integrity = dataLoader.checkDataIntegrity(klines, actualTimeframe);
    
    // 数据统计
    const stats = dataLoader.getDataStatistics(klines);
    systemLogger.info('📊 数据统计:');
    systemLogger.info(`   K线数量: ${stats.bars}`);
    systemLogger.info(`   时间跨度: ${stats.duration.days} 天 (${stats.duration.hours} 小时)`);
    systemLogger.info(`   价格范围: $${stats.price.min} - $${stats.price.max}`);
    systemLogger.info(`   价格变化: ${stats.price.change}`);
    systemLogger.info(`   数据完整性: ${integrity.completeness}`);
    systemLogger.info('');

    // 步骤2: 初始化回测引擎
    systemLogger.info('🔧 步骤2: 初始化回测引擎...');
    const engine = new BacktestEngine({
      symbol: config.symbol,
      timeframe: config.timeframe,
      initialCapital: config.initialCapital,
      positionUsd: config.positionUsd,
      leverage: config.leverage,
      feeRate: config.feeRate,
      stopLossPct: config.stopLossPct,
      takeProfitPct: config.takeProfitPct,
      slippageMode: config.slippageMode,
      fixedSlippage: config.fixedSlippage,
      atrPeriod: config.atrPeriod,
      atrFactor: config.atrFactor
    });
    systemLogger.info('');

    // 步骤3: 选择回测模式
    if (config.paramGrid) {
      // 参数敏感性测试
      systemLogger.info('🧪 步骤3: 参数敏感性测试...');
      const results = await engine.runParameterSensitivity(klines, config.paramGrid);
      
      // 显示最佳参数组合
      const sorted = results.sort((a, b) => b.metrics.sharpe_ratio - a.metrics.sharpe_ratio);
      systemLogger.info('\n📊 最佳参数组合 (按夏普比率排序):');
      sorted.slice(0, 5).forEach((r, i) => {
        systemLogger.info(`   ${i + 1}. 夏普: ${r.metrics.sharpe_ratio.toFixed(3)}, 收益: ${r.metrics.total_return_pct.toFixed(2)}%, 参数: ${JSON.stringify(r.parameters)}`);
      });
      
    } else if (config.regimeSegments && config.regimeSegments.length > 0) {
      // 分市场状态回测
      systemLogger.info('📊 步骤3: 分市场状态回测...');
      const results = await engine.runSegmentedBacktest(klines, config.regimeSegments);
      
      // 汇总各市场状态的表现
      systemLogger.info('\n📈 各市场状态表现汇总:');
      Object.entries(results).forEach(([name, result]) => {
        systemLogger.info(`\n${name}:`);
        systemLogger.info(`   总收益: ${result.metrics.total_return_pct.toFixed(2)}%`);
        systemLogger.info(`   夏普比率: ${result.metrics.sharpe_ratio.toFixed(3)}`);
        systemLogger.info(`   最大回撤: ${result.metrics.max_drawdown_pct.toFixed(2)}%`);
        systemLogger.info(`   胜率: ${result.metrics.win_rate.toFixed(2)}%`);
        systemLogger.info(`   交易次数: ${result.metrics.total_trades}`);
      });
      
    } else {
      // 标准回测
      systemLogger.info('📊 步骤3: 标准回测...');
      const result = await engine.runBacktest(klines);
      
      // 保存结果
      engine.saveTradesCSV(result.trades);
      engine.saveReportJSON(result);
    }

    systemLogger.info('\n' + '='.repeat(80));
    systemLogger.info('✅ 回测完成！');
    systemLogger.info('='.repeat(80));
    systemLogger.info('');
    systemLogger.info('📁 输出文件位置: backend/data/backtest/');
    systemLogger.info('   - *_trades.csv: 交易记录');
    systemLogger.info('   - *_report.json: 性能报告');
    systemLogger.info('');

  } catch (error) {
    systemLogger.error('❌ 回测失败:', error);
    console.error(error);
    process.exit(1);
  }
}

// 运行主函数
if (require.main === module) {
  main().then(() => {
    process.exit(0);
  }).catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { main, getConfig };


