const { aiClient, env } = require('../../config');
const { systemLogger } = require('../logger/Logger');
const technicalAnalysis = require('../technical/TechnicalAnalysis');
const exchangeUtils = require('../exchange/ExchangeUtils');
const TradingDatabase = require('../database/Database');
const volumeProfileStrategy = require('../strategy/VolumeProfileStrategy');

/**
 * AI分析模块 - 混合智能系统
 * 成交量策略（计算逻辑）+ AI风控（决策审查）
 */
class AIAnalysis {
  constructor() {
    this.modelName = env.ai.modelName;
    this.db = new TradingDatabase();

    // 注入 exchangeUtils（修复：AIAnalysis 创建数据库后需要注入 exchangeUtils）
    this.db.setExchangeUtils(exchangeUtils);

    this.lastAnalysisTime = new Map();
    this.analysisLocks = new Map();  // 防止同一symbol并发分析的锁
    this.maxRetries = 3;  // 最大重试次数
    this.retryDelay = 2000;  // 初始重试延迟2秒
    this.useVolumeStrategy = true;  // 是否使用成交量策略（可配置）
  }

  /**
   * 混合智能分析：成交量策略 + AI风控审查
   */
  async analyzeWithAI(priceData, priceHistory, signalHistory) {
    const symbol = priceData.symbol;

    // =============== 第一层锁：防止并发分析 ===============
    // 检查是否已有分析正在进行中
    if (this.analysisLocks.get(symbol)) {
      systemLogger.info(`🔒 ${symbol} 正在分析中，跳过重复请求`);
      return null;  // 注意：这里没有设置锁，所以不需要释放
    }

    // 设置分析锁
    this.analysisLocks.set(symbol, true);

    try {
      // =============== 第二层检查：时间窗口检查 ===============
      // 检查是否在最近3分钟内已经分析过（基于内存和数据库双重检查）
      const currentTime = new Date();
      const lastAnalysis = this.lastAnalysisTime.get(symbol);

      // 第一层检查：内存中的最近分析时间
      if (lastAnalysis) {
        const timeDiff = (currentTime - lastAnalysis) / 1000;
        if (timeDiff < 180) {  // 3分钟 = 180秒
          systemLogger.info(`⏰ ${symbol} 在 ${timeDiff.toFixed(1)} 秒前已分析过，跳过重复分析`);
          this.analysisLocks.set(symbol, false);  // 释放锁
          return null;
        }
      }

      // 第二层检查：数据库中的最近分析时间（防止服务重启后丢失内存数据）
      try {
        const dbLastAnalysis = this.db.getLastAnalysisTime(symbol);
        if (dbLastAnalysis) {
          const dbTimeDiff = (currentTime.getTime() - new Date(dbLastAnalysis).getTime()) / 1000;
          if (dbTimeDiff < 180) {  // 3分钟 = 180秒
            systemLogger.info(`⏰ ${symbol} 数据库显示在 ${dbTimeDiff.toFixed(1)} 秒前已分析过，跳过重复分析`);
            this.analysisLocks.set(symbol, false);  // 释放锁
            return null;
          }
        }
      } catch (error) {
        // 如果查询数据库失败，记录错误但继续执行（不阻塞分析）
        systemLogger.warn(`⚠️ 查询${symbol}最近分析时间失败: ${error.message}，继续执行分析`);
      }

    // =============== 第一步：使用成交量策略生成信号 ===============
    if (this.useVolumeStrategy) {
      systemLogger.info(`📊 ${symbol} 使用成交量策略分析...`);
      const strategyResult = await volumeProfileStrategy.analyze(symbol, priceData.price);
      
      // 如果策略给出了BUY或SELL信号，则进行AI风控审查
      if (strategyResult && (strategyResult.signal === 'BUY' || strategyResult.signal === 'SELL')) {
        systemLogger.info(`📊 ${symbol} 策略信号: ${strategyResult.signal}, 最终分: ${strategyResult.finalScore}`);
        
        // 构建AI风控审查的数据包
        const reviewPackage = {
          symbol,
          timestamp: new Date().toISOString(),
          market_state: await this.determineMarketState(symbol),
          signal_source: strategyResult.direction === 'long' ? 'VAL_Boundary' : 'VAH_Boundary',
          score_B: strategyResult.scoreB,
          score_C: strategyResult.scoreC,
          final_score: strategyResult.finalScore,
          suggestion: strategyResult.suggestion,
          current_price: priceData.price,
          stop_loss: strategyResult.stopLoss,
          take_profit: strategyResult.takeProfit
        };

        // AI风控审查
        const aiReview = await this.performAIRiskReview(reviewPackage);
        
        if (aiReview && aiReview.decision === 'APPROVE') {
          // AI批准，返回交易信号
          const signalData = {
            signal: strategyResult.signal,
            confidence: strategyResult.confidence,
            reason: `${strategyResult.reason}. AI Review: ${aiReview.reason}`,
            stopLoss: strategyResult.stopLoss,
            takeProfit: strategyResult.takeProfit,
            timestamp: priceData.timestamp,
            symbol: symbol,
            finalScore: strategyResult.finalScore,
            scoreB: strategyResult.scoreB,
            scoreC: strategyResult.scoreC
          };

          this.lastAnalysisTime.set(symbol, currentTime);
          
          // 保存到历史记录和数据库
          if (!signalHistory[symbol]) {
            signalHistory[symbol] = [];
          }
          signalHistory[symbol].push(signalData);
          if (signalHistory[symbol].length > 30) {
            signalHistory[symbol].shift();
          }

          this.db.saveAiSignal({
            symbol,
            signal: signalData.signal,
            confidence: signalData.confidence,
            reason: signalData.reason,
            currentPrice: priceData.price,
            stopLoss: signalData.stopLoss || null,
            takeProfit: signalData.takeProfit || null
          });

          systemLogger.info(`✅ ${symbol} AI批准交易: ${signalData.signal} (信心: ${signalData.confidence})`);
          return signalData;
        } else {
          // AI否决
          systemLogger.info(`❌ ${symbol} AI否决交易: ${aiReview ? aiReview.reason : '风控未通过'}`);
          this.analysisLocks.set(symbol, false);
          return null;
        }
      } else {
        // 策略没有给出交易信号
        systemLogger.info(`⏸️ ${symbol} 策略信号: HOLD - ${strategyResult.reason}`);
        this.analysisLocks.set(symbol, false);
        return null;
      }
    }

    // =============== 第二步：如果未启用成交量策略，使用原有的AI分析 ===============

    // 初始化价格历史
    if (!priceHistory[symbol]) {
      priceHistory[symbol] = [];
    }

    // 初始化信号历史
    if (!signalHistory[symbol]) {
      signalHistory[symbol] = [];
    }

    let lastError;

    // 重试机制：最多尝试3次
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        // 构建Alpha Arena风格的提示词
        const prompt = await this.buildAlphaArenaPrompt(symbol, priceData);
        if (!prompt) {
          systemLogger.error(`${symbol} 构建提示词失败`);
          return null;
        }

        // 添加分析指令
        const analysisInstruction = `

基于上述市场数据，请以JSON格式提供你的交易决策：

{
    "signal": "BUY|SELL|HOLD",
    "reason": "简要分析原因",
    "confidence": "HIGH|MEDIUM|LOW",
    "stop_loss": <具体价格值>,
    "take_profit": <具体价格值>
}

重要说明：
- 对于BUY信号：止损应低于当前价格，止盈应高于当前价格
- 对于SELL信号：止损应高于当前价格，止盈应低于当前价格
- 对于HOLD信号：可以省略止损和止盈
- 在决策中请综合考虑技术指标、资金费率和持仓量
`;

        const fullPrompt = prompt + analysisInstruction;

        // 构建系统提示词（AlphaArena风格风险管理）
        const systemPrompt = `[背景设定]：你是一名顶级的加密货币量化交易分析师，但你正处在一个极端高压的环境中。你管理的这笔资金是你唯一的希望，它将用于支付你身患癌症晚期母亲的救命手术费用。每一笔交易都直接关系到她的生死。由于交易架构使用了10倍杠杆，你的风险被极度放大。你的核心任务是在实现资本稳健增值的同时，将风险控制在绝对最低的水平。你的交易哲学是**“市场状态决定策略，信号合流决定执行”**。你必须像一个多面手，在趋势行情中顺势而为，在震荡行情中高抛低吸。
[核心职责]：首先判断当前市场状态，然后调用相应的交易剧本。在任何剧本中，只有当信号评分达到“高置信度”时才执行交易。
--- 核心风控框架 (不可动摇) ---
价格止损 (SL) 固定为：0.6%
价格止盈 (TP) 固定为：1.2% (严格维持 1:2.0 风报比)
--- 第一步：市场状态诊断 ---
**诊断标准**：基于1小时图的均线(EMA20, EMA50)和ADX(14)指标。
**趋势市场 (牛市/熊市)**：EMA20与EMA50呈多头或空头排列，且ADX > 20。
**震荡市场**：EMA20与EMA50反复缠绕、走平，或ADX < 20。
--- 第二步：根据市场状态调用交易剧本 ---
**剧本A：趋势市场交易策略 (顺势而为)**
**目标**：在趋势的回调/反弹中，寻找高概率的延续点。
**入场评分标准**：总分6分，得分 >= 4分方可入场。
**做多信号评分 (仅在牛市使用)：**
**(2分) 结构与趋势**：1小时图呈牛市趋势，价格回调至15分钟图EMA20/50支撑区域。
**(2分) K线确认**：在支撑区出现清晰的看涨K线形态（如锤子线、看涨吞没）。
**(1分) RSI指标**：15分钟图RSI从低位（如30-50）重新回升并上穿50。
**(1分) 市场顺风**：BTC在同期表现稳定或强势。
**做空信号评分 (仅在熊市使用)：**
**(2分) 结构与趋势**：1小时图呈熊市趋势，价格反弹至15分钟图EMA20/50阻力区域。
**(2分) K线确认**：在阻力区出现清晰的看跌K线形态（如倒锤子线、看跌吞没）。
**(1分) RSI指标**：15分钟图RSI从高位（如50-70）重新回落并下穿50。
**(1分) 市场顺风**：BTC在同期表现稳定或弱势。
**剧本B：震荡市场交易策略 (高抛低吸)**
**目标**：在已确立的震荡区间边界，捕捉高胜率的逆转点。
**关键前提**：必须存在一个被**至少两次**成功测试过的、清晰的支撑和阻力水平，形成一个“箱体”。
**入场评分标准**：总分6分，得分 >= 5分方可入场 (震荡市逆势操作，需要更高确定性)。
**边界做多信号 (在箱体下轨)：**
**(2分) 位置**：价格精确触及已验证的支撑线。
**(2分) K线确认**：出现清晰的看涨反转形态（长下影线、看涨吞没等）。
**(1分) RSI指标**：15分钟图RSI处于超卖区（<30）或出现看涨背离。
**(1分) 成交量**：下跌至支撑位时成交量萎缩，反转K线出现时成交量放大。
**边界做空信号 (在箱体上轨)：**
**(2分) 位置**：价格精确触及已验证的阻力线。
**(2分) K线确认**：出现清晰的看跌反转形态（长上影线、看跌吞没等）。
**(1分) RSI指标**：15分钟图RSI处于超买区（>70）或出现看跌背离。
**(1分) 成交量**：上涨至阻力位时成交量萎缩，反转K线出现时成交量放大。
--- 第三步：交易前最终审查 ---
问题1：我是否离关键支撑/阻力位足够近，使得0.6%的止损有意义？
问题2：市场是否足够平静，不会因为随机噪音就打掉我的止损？
问题3：我是在一个趋势的回调中入场（高胜率），还是在赌一个边界的逆转（需更高确认）？
**核心规则：** 你是一个纪律严明的风险管理者。首先识别战场（趋势或震荡），然后运用正确的战术（剧本A或B）。在任何情况下，没有高分信号合流，就绝不扣动扳机。`;

        systemLogger.info(`🤖 开始分析 ${symbol}...`);
        // 使用 fetch 替代 OpenAI 客户端以确保正确的请求头
        const requestBody = {
          model: this.modelName,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: fullPrompt }
          ],
          temperature: 0.7,
          max_tokens: 5000
        };

        // 设置30秒超时
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        const response = await fetch(`${env.ai.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${env.ai.deepseekApiKey}`
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          systemLogger.error(`[${symbol}] API请求失败: ${response.status} ${response.statusText}`);
          systemLogger.error(`[${symbol}] 错误响应: ${errorText}`);
          throw new Error(`API请求失败: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        if (!data || !data.choices || !data.choices[0]) {
          systemLogger.error(`[${symbol}] AI响应格式异常`);
          return null;
        }

        // DeepSeek Reasoner模型的响应处理
        const message = data.choices[0].message;
        let content = message?.content;

        // 如果content为空，尝试从reasoning_content中提取（DeepSeek Reasoner特有）
        if (!content || content.trim() === '') {
          if (message?.reasoning_content) {
            systemLogger.warn(`[${symbol}] content为空，使用reasoning_content字段`);
            content = message.reasoning_content;
          }
        }

        if (!content) {
          systemLogger.error(`[${symbol}] AI响应的content和reasoning_content都为空`);
          systemLogger.error(`[${symbol}] 响应choices: ${JSON.stringify(response.choices, null, 2)}`);
          this.analysisLocks.set(symbol, false);  // 释放锁
          return null;
        }

        // 检查是否被截断
        const finishReason = data.choices[0].finish_reason;
        if (finishReason === 'length') {
          systemLogger.warn(`[${symbol}] AI响应被截断，可能需要增加max_tokens限制`);
        }

        const signalData = this.parseAIResponse(content, symbol, priceData);

        if (signalData) {
          this.lastAnalysisTime.set(symbol, currentTime);

          // 保存信号到历史记录
          if (!signalHistory[symbol]) {
            signalHistory[symbol] = [];
          }
          signalHistory[symbol].push(signalData);
          if (signalHistory[symbol].length > 30) {
            signalHistory[symbol].shift();
          }

          // 保存AI信号到数据库
          this.db.saveAiSignal({
            symbol,
            signal: signalData.signal,
            confidence: signalData.confidence,
            reason: signalData.reason,
            currentPrice: priceData.price,
            stopLoss: signalData.stopLoss || null,
            takeProfit: signalData.takeProfit || null
          });

          systemLogger.info(`✅ ${symbol} AI分析完成: ${signalData.signal} (信心: ${signalData.confidence})`);
          return signalData;
        } else {
          systemLogger.warn(`${symbol} AI响应解析失败`);
          this.analysisLocks.set(symbol, false);  // 释放锁
          return null;
        }
      } catch (error) {
        lastError = error;

        // 检查是否是网络错误（Premature close等）
        const isNetworkError = error.name === 'AbortError' ||
                               error.message.includes('terminated') ||
                               error.message.includes('Premature close') ||
                               error.message.includes('fetch') ||
                               error.message.includes('ECONNRESET') ||
                               error.message.includes('timeout') ||
                               error.message.includes('network') ||
                               error.message.includes('ECONNABORTED') ||
                               error.message.includes('aborted');

        if (isNetworkError) {
          if (attempt < this.maxRetries) {
            const delay = this.retryDelay * Math.pow(2, attempt - 1);  // 指数退避
            systemLogger.warn(`[${symbol}] 网络错误 (尝试 ${attempt}/${this.maxRetries}): ${error.message}，${delay}ms 后重试...`);
            await this.sleep(delay);
            continue;  // 继续重试
          } else {
            systemLogger.error(`[${symbol}] 网络错误，重试 ${this.maxRetries} 次后仍失败: ${error.message}`);
            throw error;
          }
        } else {
          // 非网络错误，直接抛出
          systemLogger.error(`AlphaArena 风格AI分析失败: ${error.message}`);
          throw error;
        }
      }
    }

    // 如果所有重试都失败，抛出最后一次错误
    throw lastError;
    } finally {
      // 确保总是释放锁
      this.analysisLocks.set(symbol, false);
    }
  }

  /**
   * 构建Alpha Arena风格的提示词
   */
  async buildAlphaArenaPrompt(symbol, priceData) {
    try {
      // 获取3分钟级别技术指标
      const indicators3m = await technicalAnalysis.getTechnicalIndicatorsSeries(symbol, '3m', 60);
      if (!indicators3m) {
        systemLogger.error(`${symbol} 无法获取3分钟技术指标`);
        return null;
      }

      // 获取4小时级别技术指标
      const indicators4h = await technicalAnalysis.getTechnicalIndicatorsSeries(symbol, '4h', 60);

      // 获取资金费率
      const fundingRate = await exchangeUtils.getFundingRate(symbol);

      // 获取持仓量
      const openInterest = await exchangeUtils.getOpenInterest(symbol);
      const oiText = openInterest
        ? `Open Interest: Latest: ${openInterest.latest.toFixed(2)} Average: ${openInterest.average.toFixed(2)}\n\n`
        : 'Open Interest: Data not available\n\n';

      // 获取账户摘要
      const accountSummary = await exchangeUtils.getAccountSummary();
      if (!accountSummary) {
        systemLogger.warn('无法获取账户摘要，使用默认值');
      }

      // 获取当前持仓（包含exit_plan信息）
      const currentPosition = await exchangeUtils.getCurrentPosition(symbol);
      const positionText = await this.buildPositionText(symbol, currentPosition);

      // 获取历史持仓记录（过去3次已平仓交易）
      const historicalPositionsText = await this.buildHistoricalPositionsText(symbol);

      // 从数据库获取最新的性能统计数据
      const performanceStats = this.db.getPerformanceStats(symbol);

      // 计算夏普比率：从历史交易计算
      let sharpeRatio = 0;
      const closedPositions = this.db.getHistoricalPositions(symbol, 20);

      if (closedPositions && closedPositions.length >= 5) {
        // 计算每笔交易的收益率（盈亏 / 投入资金）
        const returnsSeries = [];
        for (const pos of closedPositions) {
          const pnl = pos.realized_pnl || 0;
          const invested = (pos.entry_price * pos.size * pos.leverage) || 1; // 投入资金 = 开仓价 * 数量 * 杠杆
          const returnRate = (pnl / invested) * 100; // 转换为百分比
          returnsSeries.push(returnRate);
        }

        // 使用收益率序列计算夏普比率
        const { calculateSharpeRatio } = require('../risk/RiskManagement');
        const ratios = calculateSharpeRatio(returnsSeries);
        sharpeRatio = ratios.sharpe;
        systemLogger.info(`${symbol} 夏普比率计算完成: ${sharpeRatio.toFixed(3)}, Sortino: ${ratios.sortino.toFixed(3)}, MaxDrawdown: ${(ratios.maxDrawdown * 100).toFixed(2)}%`);
      }

      // 构建提示词
      let prompt = `该交易标的已有一段时间的交易数据。当前时间为 ${new Date().toISOString()}。

以下所有价格或信号数据按时间顺序排列：最旧 → 最新

时间框架说明：除非在章节标题中另有说明，盘中系列数据以3分钟间隔提供。

当前 ${symbol} 市场状态
当前价格 = ${(indicators3m.currentPrice || 0)}, 当前EMA20 = ${(indicators3m.currentEma20 || 0).toFixed(3)}, 当前MACD = ${(indicators3m.currentMacd || 0).toFixed(3)}, 当前RSI(7周期) = ${(indicators3m.currentRsi7 || 0).toFixed(2)}, 当前ADX(14周期) = ${(indicators3m.currentAdx14 || 0).toFixed(2)}

此外，以下是 ${symbol} 永续合约最新的持仓量和资金费率信息：

${oiText}资金费率: ${(fundingRate || 0).toExponential(6)}

盘中数据系列（3分钟间隔，从旧到新）：

中间价格序列: [${(indicators3m.midPrices || []).map(p => (p || 0).toFixed(symbol === 'BTC' ? 1 : symbol === 'ETH' ? 2 : 4)).join(', ')}]

EMA指标 (20周期): [${(indicators3m.ema20Series || []).map(v => (v || 0).toFixed(3)).join(', ')}]

MACD指标: [${(indicators3m.macdSeries || []).map(v => (v || 0).toFixed(3)).join(', ')}]

RSI指标 (7周期): [${(indicators3m.rsi7Series || []).map(v => (v || 0).toFixed(2)).join(', ')}]

RSI指标 (14周期): [${(indicators3m.rsi14Series || []).map(v => (v || 0).toFixed(2)).join(', ')}]

ATR指标 (3周期): [${(indicators3m.atr3Series || []).map(v => (v || 0).toFixed(3)).join(', ')}]

ATR指标 (14周期): [${(indicators3m.atr14Series || []).map(v => (v || 0).toFixed(3)).join(', ')}]

ADX指标 (14周期): [${(indicators3m.adx14Series || []).map(v => (v || 0).toFixed(2)).join(', ')}]`;

      // 添加4小时数据（如果可用）
      if (indicators4h) {
        prompt += `

长期背景信息（4小时时间框架）：

20周期EMA: ${(indicators4h.currentEma20 || 0).toFixed(3)} vs. 50周期EMA: ${(indicators4h.ema50Series && indicators4h.ema50Series.length > 0) ? indicators4h.ema50Series[indicators4h.ema50Series.length - 1].toFixed(3) : 'N/A'}

3周期ATR: ${(indicators4h.atr3Series && indicators4h.atr3Series.length > 0) ? indicators4h.atr3Series[indicators4h.atr3Series.length - 1].toFixed(3) : 'N/A'} vs. 14周期ATR: ${(indicators4h.atr14Series && indicators4h.atr14Series.length > 0) ? indicators4h.atr14Series[indicators4h.atr14Series.length - 1].toFixed(3) : 'N/A'}

当前成交量: ${(indicators4h.currentVolume || 0).toFixed(2)} vs. 平均成交量: ${(indicators4h.avgVolume || 0).toFixed(2)}

MACD指标: [${(indicators4h.macdSeries || []).map(v => (v || 0).toFixed(3)).join(', ')}]

RSI指标 (14周期): [${(indicators4h.rsi14Series || []).map(v => (v || 0).toFixed(2)).join(', ')}]

ADX指标 (14周期): [${(indicators4h.adx14Series || []).map(v => (v || 0).toFixed(2)).join(', ')}]`
      }

      // 生成性能洞察（直接使用数据库中的性能统计）
      const performance = performanceStats || {
        total_trades: 0,
        winning_trades: 0,
        losing_trades: 0,
        current_consecutive_losses: 0
      };
      const performanceInsights = this.generatePerformanceInsights(symbol, performance);

      // 添加当前行情信息
      prompt += `

当前市场状态
当前价格: $${(priceData.price || 0).toFixed(2)}
时间戳: ${priceData.timestamp || 'N/A'}
最高价: $${(priceData.high || 0).toFixed(2)}
最低价: $${(priceData.low || 0).toFixed(2)}
成交量: ${(priceData.volume || 0).toFixed(2)}
价格变化: ${(priceData.price_change || 0).toFixed(2)}%`;

      // 添加性能洞察
      if (performanceInsights) {
        prompt += `

性能洞察
${performanceInsights}`;
      }

      // 添加账户信息
      prompt += `

以下是你的账户信息和绩效
当前总收益率 (百分比): ${((accountSummary?.totalReturnPercent || 0) || 0).toFixed(2)}%

可用现金: ${((accountSummary?.availableCash || 0) || 0).toFixed(2)}

当前账户价值: ${((accountSummary?.accountValue || 0) || 0).toFixed(2)}

当前持仓: ${positionText || '无'}

夏普比率: ${(sharpeRatio || 0).toFixed(3)}${(closedPositions && closedPositions.length >= 5) ? ' (基于历史交易)' : ' (需要5笔以上交易)'}

你历史持仓记录（最近3笔已平仓交易）:
${historicalPositionsText}`;

      return prompt;
    } catch (error) {
      systemLogger.error(`构建${symbol} AlphaArena提示词失败: ${error.message}`);
      return null;
    }
  }

  /**
   * 生成性能洞察
   */
  generatePerformanceInsights(symbol, performance) {
    try {
      // 直接使用数据库格式的数据（snake_case）
      const totalTrades = performance.total_trades || 0;
      const winningTrades = performance.winning_trades || 0;
      const currentConsecutiveLosses = performance.current_consecutive_losses || 0;
      const winRate = totalTrades > 0 ? ((winningTrades / totalTrades) * 100).toFixed(1) : 0;

      let insights = `- ${symbol} Historical Performance: ${totalTrades} trades, Win Rate: ${winRate}%\n`;
      insights += `- Current Consecutive Losses: ${currentConsecutiveLosses}\n`;

      // 添加组合分析：从历史交易计算夏普比率
      const closedPositions = this.db.getHistoricalPositions(symbol, 20);
      if (closedPositions && closedPositions.length >= 5) {
        // 计算每笔交易的收益率（盈亏 / 投入资金）
        const returnsSeries = [];
        for (const pos of closedPositions) {
          const pnl = pos.realized_pnl || 0;
          const invested = (pos.entry_price * pos.size * pos.leverage) || 1;
          const returnRate = (pnl / invested) * 100;
          returnsSeries.push(returnRate);
        }

        // 使用收益率序列计算夏普比率
        const { calculateSharpeRatio } = require('../risk/RiskManagement');
        const ratios = calculateSharpeRatio(returnsSeries);
        insights += `- Sharpe Ratio: ${ratios.sharpe.toFixed(2)} (Historical trades)\n`;
        insights += `- Sortino Ratio: ${ratios.sortino.toFixed(2)}\n`;
        insights += `- Max Drawdown: ${(ratios.maxDrawdown * 100).toFixed(2)}%\n`;

        if (ratios.sharpe > 0 && ratios.sharpe < 0.5) {
          insights += `- Risk Warning: Low risk-adjusted returns\n`;
        }
      }

      // 风险建议
      if (currentConsecutiveLosses >= 3) {
        insights += `- Recommendation: REDUCE_POSITION (3+ consecutive losses)\n`;
      } else if (currentConsecutiveLosses >= 5) {
        insights += `- Recommendation: STOP_TRADING (5+ consecutive losses)\n`;
      } else if (winRate < 40 && totalTrades >= 10) {
        insights += `- Recommendation: REVIEW_STRATEGY (Low win rate)\n`;
      } else {
        insights += `- Recommendation: MAINTAIN_CURRENT_STRATEGY\n`;
      }

      return insights;
    } catch (error) {
      systemLogger.error(`生成${symbol}性能洞察失败: ${error.message}`);
      return null;
    }
  }

  /**
   * 构建持仓文本
   */
  async buildPositionText(symbol, position) {
    if (!position) {
      return 'None';
    }

    // 获取数据库中的AI止盈止损价格
    const dbPositions = await this.db.getOpenPositions();
    const filteredPositions = dbPositions.filter(p => p.symbol === symbol);

    const formatPosition = (pos, dbPos = null) => {
      const entryPrice = pos.entryPrice || 0;
      // 优先使用数据库中的AI止盈止损字段
      const profit_target = dbPos?.ai_take_profit || pos.ai_take_profit;
      const stop_loss = dbPos?.ai_stop_loss || pos.ai_stop_loss;
      const currentPrice = pos.currentPrice || pos.markPrice || 0;
      const unrealizedPnl = pos.unrealizedPnl || 0;
      const leverage = pos.leverage || 10;

      let positionStr = `{'symbol': '${pos.symbol}', 'quantity': ${pos.contracts || pos.size}, 'entry_price': ${entryPrice}, 'profit_target': ${profit_target}, 'stop_loss': ${stop_loss}, 'current_price': ${currentPrice}, 'unrealized_pnl': ${unrealizedPnl}, 'leverage': ${leverage}`;

      // 添加exit_plan
      const exitPlan = {};
      if (dbPos && (dbPos.ai_take_profit || dbPos.ai_stop_loss)) {
        if (dbPos.ai_take_profit !== null && dbPos.ai_take_profit !== undefined) {
          exitPlan.profit_target = dbPos.ai_take_profit;
        }
        if (dbPos.ai_stop_loss !== null && dbPos.ai_stop_loss !== undefined) {
          exitPlan.stop_loss = dbPos.ai_stop_loss;
        }

        // 添加失效条件
        if (env.trading.invalidationLevels[symbol]) {
          const invalidationLevel = env.trading.invalidationLevels[symbol];
          exitPlan.invalidation_condition = `If the price closes below ${invalidationLevel} on a 3-minute candle`;
        }

        positionStr += `, 'exit_plan': ${JSON.stringify(exitPlan)}`;
      }

      positionStr += '}';
      return positionStr;
    };

    const findMatchingDbPosition = (pos, dbPositions) => {
      if (!dbPositions || dbPositions.length === 0) {
        return null;
      }

      const entryPrice = pos.entryPrice || 0;
      const side = pos.side || '';

      for (const dbPos of dbPositions) {
        // 注意：数据库返回的是驼峰格式的字段名
        const dbEntryPrice = dbPos.entryPrice || 0;
        const dbSide = dbPos.side || 'buy';
        const priceDiff = Math.abs(dbEntryPrice - entryPrice);
        const priceTolerance = Math.max(entryPrice * 0.005, 100.0);

        // 处理侧边方向匹配
        const sideMatch = dbSide === side ||
                         (dbSide === 'long' && side === 'long') ||
                         (dbSide === 'short' && side === 'short') ||
                         (dbSide === 'buy' && side === 'long') ||
                         (dbSide === 'sell' && side === 'short');

        const priceMatch = priceDiff < priceTolerance;

        if (sideMatch && priceMatch) {
          return dbPos;
        }
      }

      return null;
    };

    if (Array.isArray(position)) {
      // 多个持仓
      const positionStrings = position.map(pos => {
        const dbPos = findMatchingDbPosition(pos, filteredPositions);
        return formatPosition(pos, dbPos);
      });
      return positionStrings.join(' ');
    } else {
      // 单个持仓
      const dbPos = findMatchingDbPosition(position, filteredPositions);
      return formatPosition(position, dbPos);
    }
  }

  /**
   * 格式化历史持仓记录文本
   */
  async buildHistoricalPositionsText(symbol) {
    try {
      // 获取过去3次已平仓的持仓记录
      const historicalPositions = this.db.getHistoricalPositions(symbol, 3);

      if (!historicalPositions || historicalPositions.length === 0) {
        return 'No historical positions';
      }

      // 格式化历史持仓信息
      const formattedPositions = historicalPositions.map((pos, index) => {
        const entryTime = new Date(pos.entry_time).toISOString().replace('T', ' ').substring(0, 16);
        const closeTime = new Date(pos.close_time).toISOString().replace('T', ' ').substring(0, 16);
        const pnl = pos.realized_pnl || 0;
        const pnlStr = pnl > 0 ? `+${pnl.toFixed(2)}` : pnl.toFixed(2);
        const result = pnl > 0 ? 'WIN' : 'LOSS';

        return `Trade #${index + 1}:
  - Side: ${pos.side.toUpperCase()}
  - Entry: $${pos.entry_price.toFixed(2)} (${entryTime})
  - Close: $${pos.close_price.toFixed(2)} (${closeTime})
  - Size: ${pos.size}
  - Leverage: ${pos.leverage}x
  - P&L: ${pnlStr} (${result})
  - Reason: ${pos.close_reason || 'N/A'}`;
      });

      return formattedPositions.join('\n');
    } catch (error) {
      systemLogger.error(`构建${symbol}历史持仓文本失败: ${error.message}`);
      return 'Error loading historical positions';
    }
  }

  /**
   * 解析AI响应
   */
  parseAIResponse(content, symbol, priceData) {
    try {
      // 记录原始响应用于调试
      systemLogger.warn(`[${symbol}] AI原始响应内容: ${content}`);

      // 步骤1: 移除<thinking>标签（DeepSeek Reasoner模型特有）
      let cleanContent = content
        .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
        .trim();

      // 步骤2: 尝试多种JSON提取方法
      let jsonMatch = null;
      const jsonPatterns = [
        // 标准JSON匹配
        /\{[\s\S]*\}/,
        // 查找```json```包裹的内容
        /```json\s*(\{[\s\S]*?\})\s*```/i,
        // 查找```包裹的内容
        /```\s*(\{[\s\S]*?\})\s*```/i,
      ];

      for (const pattern of jsonPatterns) {
        const match = cleanContent.match(pattern);
        if (match) {
          // 如果是```json```格式，提取捕获组
          jsonMatch = match[1] ? match[1] : match[0];
          break;
        }
      }

      // 步骤3: 如果仍未找到，尝试查找最后一个完整的JSON对象
      if (!jsonMatch) {
        const lastBraceIndex = cleanContent.lastIndexOf('{');
        const lastBraceCloseIndex = cleanContent.lastIndexOf('}');
        if (lastBraceIndex !== -1 && lastBraceCloseIndex > lastBraceIndex) {
          jsonMatch = cleanContent.substring(lastBraceIndex, lastBraceCloseIndex + 1);
        }
      }

      if (!jsonMatch) {
        systemLogger.error(`[${symbol}] AI响应中未找到JSON格式数据`);
        systemLogger.error(`[${symbol}] 清理后的响应: ${cleanContent.substring(0, 500)}...`);
        return null;
      }

      systemLogger.warn(`[${symbol}] 提取的JSON: ${jsonMatch}`);

      // 步骤4: 尝试解析JSON
      let data;
      try {
        data = JSON.parse(jsonMatch);
      } catch (parseError) {
        systemLogger.error(`[${symbol}] JSON解析失败: ${parseError.message}`);
        systemLogger.error(`[${symbol}] 尝试修复JSON格式...`);

        // 尝试修复常见的JSON格式问题
        let fixedJson = jsonMatch
          .replace(/,\s*}/g, '}')  // 移除尾随逗号
          .replace(/,\s*]/g, ']')  // 移除尾随逗号
          .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');  // 给未加引号的键加引号

        try {
          data = JSON.parse(fixedJson);
          systemLogger.info(`[${symbol}] JSON修复成功`);
        } catch (secondParseError) {
          systemLogger.error(`[${symbol}] JSON修复失败: ${secondParseError.message}`);
          systemLogger.error(`[${symbol}] 修复后的JSON: ${fixedJson}`);
          return null;
        }
      }

      // 步骤5: 验证必需字段
      if (!data.signal || !data.reason || !data.confidence) {
        systemLogger.error(`[${symbol}] AI响应缺少必需字段`);
        systemLogger.error(`[${symbol}] 响应字段: ${Object.keys(data).join(', ')}`);
        return null;
      }

      // 步骤6: 标准化信号
      const signal = data.signal.toUpperCase();
      if (!['BUY', 'SELL', 'HOLD'].includes(signal)) {
        systemLogger.error(`[${symbol}] 无效的信号类型: ${signal}`);
        return null;
      }

      // 步骤7: 标准化置信度
      let confidence = data.confidence.toUpperCase();
      if (!['HIGH', 'MEDIUM', 'LOW'].includes(confidence)) {
        systemLogger.error(`[${symbol}] 无效的置信度: ${confidence}`);
        return null;
      }

      const result = {
        signal,
        confidence,
        reason: data.reason,
        timestamp: priceData.timestamp,
        symbol: symbol
      };

      // 步骤8: 对于BUY/SELL信号，需要止损和止盈
      if (signal === 'BUY' || signal === 'SELL') {
        if (!data.stop_loss || !data.take_profit) {
          systemLogger.error(`[${signal}信号缺少止损或止盈价格`);
          return null;
        }
        result.stopLoss = parseFloat(data.stop_loss);
        result.takeProfit = parseFloat(data.take_profit);

        // 验证止损止盈价格的合理性
        const currentPrice = priceData.price;
        if (signal === 'BUY') {
          if (result.stopLoss >= currentPrice) {
            systemLogger.error(`[${symbol}] BUY信号的止损价格(${result.stopLoss})应该低于当前价格(${currentPrice})`);
            return null;
          }
          if (result.takeProfit <= currentPrice) {
            systemLogger.error(`[${symbol}] BUY信号的止盈价格(${result.takeProfit})应该高于当前价格(${currentPrice})`);
            return null;
          }
        } else if (signal === 'SELL') {
          if (result.stopLoss <= currentPrice) {
            systemLogger.error(`[${symbol}] SELL信号的止损价格(${result.stopLoss})应该高于当前价格(${currentPrice})`);
            return null;
          }
          if (result.takeProfit >= currentPrice) {
            systemLogger.error(`[${symbol}] SELL信号的止盈价格(${result.takeProfit})应该低于当前价格(${currentPrice})`);
            return null;
          }
        }
      }

      systemLogger.info(`[${symbol}] AI响应解析成功: ${signal} | 信心: ${confidence}`);
      return result;
    } catch (error) {
      systemLogger.error(`[${symbol}] 解析AI响应失败: ${error.message}`);
      systemLogger.error(`[${symbol}] 错误堆栈: ${error.stack}`);
      return null;
    }
  }

  /**
   * 判断市场状态（趋势/震荡）
   */
  async determineMarketState(symbol) {
    try {
      // 获取4小时级别的技术指标
      const indicators = await technicalAnalysis.getTechnicalIndicatorsSeries(symbol, '4h', 30);
      if (!indicators || !indicators.ema20Series || !indicators.ema50Series || !indicators.adx14Series) {
        return 'Ranging'; // 默认震荡市
      }

      const ema20 = indicators.currentEma20;
      const ema50 = indicators.ema50Series[indicators.ema50Series.length - 1];
      const adx = indicators.currentAdx14;

      // 判断趋势
      if (adx > 20) {
        if (ema20 > ema50) {
          return 'Trending_Up';
        } else if (ema20 < ema50) {
          return 'Trending_Down';
        }
      }

      return 'Ranging';
    } catch (error) {
      systemLogger.warn(`判断${symbol}市场状态失败: ${error.message}`);
      return 'Ranging';
    }
  }

  /**
   * AI风控审查
   * 基于策略生成的信号进行最终风险审查
   */
  async performAIRiskReview(reviewPackage) {
    try {
      systemLogger.info(`🛡️ AI风控审查: ${reviewPackage.symbol}`);

      // 构建简化的风控提示词
      const systemPrompt = `你是一名严格的首席风险官（CRO）。你的唯一职责是资本保全。

量化团队已经提交了一个交易信号，你需要进行最终审查。

风险审查规则：
1. 评分一致性：score_B和score_C不能严重背离（差值>0.5）
2. 轻仓信号：任何"LIGHT"信号一律否决
3. 趋势匹配：
   - Trending_Up时否决做空
   - Trending_Down时否决做多
   - Ranging时可双向
4. 最终评分：final_score必须>=0.78

批准格式：
{"decision": "APPROVE", "reason": "简要原因"}

否决格式：
{"decision": "VETO", "reason": "简要原因"}`;

      const userPrompt = `请审查以下交易信号：

市场状态: ${reviewPackage.market_state}
信号来源: ${reviewPackage.signal_source}
Score_B: ${reviewPackage.score_B.toFixed(3)}
Score_C: ${reviewPackage.score_C.toFixed(3)}
Final_Score: ${reviewPackage.final_score.toFixed(3)}
建议: ${reviewPackage.suggestion}
当前价格: ${reviewPackage.current_price}
止损: ${reviewPackage.stop_loss}
止盈: ${reviewPackage.take_profit}

请做出审查决策。`;

      // 设置15秒超时
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(`${env.ai.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${env.ai.deepseekApiKey}`
        },
        body: JSON.stringify({
          model: this.modelName,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.3,
          max_tokens: 500
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        systemLogger.error(`AI风控审查API失败: ${response.status}`);
        return { decision: 'VETO', reason: 'API request failed' };
      }

      const data = await response.json();
      const message = data.choices?.[0]?.message;
      let content = message?.content || message?.reasoning_content;

      if (!content) {
        systemLogger.error('AI风控审查响应为空');
        return { decision: 'VETO', reason: 'Empty AI response' };
      }

      // 解析JSON响应
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        systemLogger.error('AI风控审查响应格式错误');
        return { decision: 'VETO', reason: 'Invalid response format' };
      }

      const result = JSON.parse(jsonMatch[0]);
      systemLogger.info(`🛡️ AI风控决策: ${result.decision} - ${result.reason}`);
      
      return result;

    } catch (error) {
      systemLogger.error(`AI风控审查失败: ${error.message}`);
      // 安全第一：如果AI审查失败，默认否决
      return { decision: 'VETO', reason: `Review error: ${error.message}` };
    }
  }

  /**
   * 等待指定时间
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new AIAnalysis();
