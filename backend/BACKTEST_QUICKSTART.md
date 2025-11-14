# 回测系统快速开始 🚀

5分钟上手DeepTrade回测系统！

## 1️⃣ 第一步：运行默认回测

最简单的方式，一键运行：

```bash
cd backend
npm run backtest
```

这将：
- ✅ 自动从币安下载BTC/USDT 1分钟K线数据（2021-2023）
- ✅ 使用成交量策略进行回测
- ✅ 生成详细的性能报告和交易记录
- ✅ 数据保存到 `data/backtest/` 目录

**预计时间**: 
- 首次运行：5-10分钟（下载数据）
- 后续运行：1-2分钟（使用本地数据）

## 2️⃣ 第二步：查看结果

回测完成后，检查以下文件：

```bash
# 交易记录
cat data/backtest/BTC_USDT_default_trades.csv

# 性能报告
cat data/backtest/BTC_USDT_default_report.json
```

控制台会显示完整的性能摘要：

```
【基础统计】
总交易次数: 150
盈利交易: 90 (60.00%)
亏损交易: 60 (40.00%)

【收益指标】
总收益: $2,500.00 (25.00%)
年化收益率: 15.50%
平均每笔交易: $16.67

【风险指标】
最大回撤: $-800.00 (-8.00%)
夏普比率: 1.850
索提诺比率: 2.350

【交易质量】
利润因子: 2.500
盈亏比: 2.50
```

## 3️⃣ 第三步：自定义参数

### 快速测试以太坊

```bash
BACKTEST_SYMBOL=ETH/USDT npm run backtest
```

### 测试特定时间段（熊市）

```bash
BACKTEST_START=2022-01-01T00:00:00Z \
BACKTEST_END=2022-12-31T23:59:00Z \
npm run backtest
```

### 大资金回测

```bash
BACKTEST_INITIAL_CAPITAL=100000 \
BACKTEST_POSITION_USD=100 \
npm run backtest
```

### 保守模式（降低杠杆）

```bash
BACKTEST_LEVERAGE=5 \
BACKTEST_STOP_LOSS_PCT=0.01 \
BACKTEST_TAKE_PROFIT_PCT=0.02 \
npm run backtest
```

## 4️⃣ 第四步：参数优化

寻找最优参数组合：

```bash
PARAMGRID_B_ZLOCAL=2.1,2.3,2.5,2.7 \
PARAMGRID_C_DELTA=300,450,600 \
npm run backtest
```

系统会测试 4×3=12 种参数组合，并显示最佳配置。

## 📊 评估标准

### ✅ 优秀策略

- 夏普比率 > 1.5
- 年化收益率 > 20%
- 最大回撤 < 15%
- 胜率 > 45%
- 利润因子 > 2.0

### ⚠️ 需要优化

- 夏普比率 < 1.0
- 最大回撤 > 25%
- 利润因子 < 1.5

### ❌ 不可用

- 负收益
- 夏普比率 < 0
- 利润因子 < 1.0

## 🎯 实战流程

1. **基准测试**：运行默认配置，评估基准表现
   ```bash
   npm run backtest
   ```

2. **市场验证**：测试不同市场状态
   ```bash
   # 牛市（2021）
   BACKTEST_START=2021-01-01T00:00:00Z BACKTEST_END=2021-12-31T23:59:00Z npm run backtest
   
   # 熊市（2022）
   BACKTEST_START=2022-01-01T00:00:00Z BACKTEST_END=2022-12-31T23:59:00Z npm run backtest
   ```

3. **参数优化**：寻找最佳参数
   ```bash
   PARAMGRID_B_ZLOCAL=2.1,2.3,2.5,2.7 npm run backtest
   ```

4. **多币种验证**：测试其他交易对
   ```bash
   BACKTEST_SYMBOL=ETH/USDT npm run backtest
   BACKTEST_SYMBOL=SOL/USDT npm run backtest
   ```

5. **确认可行**：如果上述测试都通过，策略可以进入小额实盘测试

## 📝 快速参考

### 常用命令

```bash
# 默认回测
npm run backtest

# 以太坊回测
BACKTEST_SYMBOL=ETH/USDT npm run backtest

# 3分钟K线（策略设计周期）
BACKTEST_TIMEFRAME=3m npm run backtest

# 大资金测试
BACKTEST_INITIAL_CAPITAL=50000 BACKTEST_POSITION_USD=50 npm run backtest

# 保守杠杆
BACKTEST_LEVERAGE=5 npm run backtest

# 参数优化
PARAMGRID_B_ZLOCAL=2.1,2.3,2.5 npm run backtest
```

### 输出文件

```
backend/
├── data/
│   ├── klines/           # K线数据（CSV）
│   │   └── BTC_USDT_1m_2021-01-01_2023-06-30.csv
│   └── backtest/         # 回测结果
│       ├── BTC_USDT_default_trades.csv     # 交易记录
│       └── BTC_USDT_default_report.json    # 性能报告
└── logs/                 # 日志文件
```

## ⚡ 快速问题解决

### 问题1: 下载数据很慢

第一次需要从币安下载数据，请耐心等待。数据会缓存到本地，下次秒开。

### 问题2: K线数据不足

策略需要至少720根K线。如果时间范围太短，请扩大：

```bash
BACKTEST_START=2021-01-01T00:00:00Z \
BACKTEST_END=2023-12-31T23:59:00Z \
npm run backtest
```

### 问题3: 内存不足

如果回测非常长的时间段，可能需要大量内存。建议：
- 使用3分钟或更长的K线周期
- 缩短回测时间范围
- 增加系统内存

### 问题4: 策略一直HOLD

这是正常的！成交量策略只在特定条件下发出信号。如果交易太少：
- 尝试更长的时间范围
- 使用1分钟K线（信号更频繁）
- 检查日志看是否有错误

## 📚 详细文档

需要更多信息？查看：

- **完整文档**: `docs/BACKTEST_README.md`
- **策略说明**: `docs/volume_strategy_implementation.md`
- **回测需求**: `docs/backtest.txt`

## 🎉 开始回测！

现在就试试吧：

```bash
cd backend
npm run backtest
```

期待看到你的回测结果！📊✨


