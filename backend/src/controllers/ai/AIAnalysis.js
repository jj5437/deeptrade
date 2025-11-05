const { aiClient, env } = require('../../config');
const { systemLogger } = require('../logger/Logger');
const technicalAnalysis = require('../technical/TechnicalAnalysis');
const exchangeUtils = require('../exchange/ExchangeUtils');
const TradingDatabase = require('../database/Database');

/**
 * AI分析模块 - Alpha Arena风格
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
  }

  /**
   * 使用Alpha Arena风格进行AI分析
   */
  async analyzeWithAI(priceData, priceHistory, signalHistory, tradePerformance, portfolioReturns) {
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

    // 初始化价格历史
    if (!priceHistory[symbol]) {
      priceHistory[symbol] = [];
    }

    // 初始化交易性能数据
    if (!tradePerformance[symbol]) {
      tradePerformance[symbol] = {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        totalPnl: 0,
        lastSignals: [],
        accuracyBySignal: {
          BUY: { wins: 0, total: 0 },
          SELL: { wins: 0, total: 0 }
        },
        avgHoldingTime: 0,
        maxConsecutiveLosses: 0,
        currentConsecutiveLosses: 0
      };
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
        const prompt = await this.buildAlphaArenaPrompt(symbol, priceData, tradePerformance, portfolioReturns);
        if (!prompt) {
          systemLogger.error(`${symbol} 构建提示词失败`);
          return null;
        }

        // 添加分析指令
        const analysisInstruction = `
Based on the market data above, provide your trading decision in JSON format:

{
    "signal": "BUY|SELL|HOLD",
    "reason": "Brief analysis reason",
    "confidence": "HIGH|MEDIUM|LOW",
    "stop_loss": <specific price value>,
    "take_profit": <specific price value>
}

Important notes:
- For BUY signal: stop_loss should be below current price, take_profit should be above
- For SELL signal: stop_loss should be above current price, take_profit should be below
- For HOLD signal: you can omit stop_loss and take_profit
- Consider the technical indicators, funding rate, and open interest in your decision
`;

        const fullPrompt = prompt + analysisInstruction;

        // 构建系统提示词（AlphaArena风格风险管理）
        const systemPrompt = `You are a professional quantitative trading analyst specializing in crypto derivatives trading. Your role is to analyze market data and provide high-conviction trading signals for both LONG and SHORT positions.

KEY PRINCIPLES:
1. **Risk-Reward Management** (Most Critical):
   - Strict minimum 1:2 risk-reward ratio (stop loss to take profit distance)
   - Stop loss: 3-8% from entry (align with technical levels)
   - Take profit: 6-16% from entry (align with technical targets)
   - Never set similar distances for stop loss and take profit

2. **Entry Timing Criteria** (Symmetric Rules):
   - **LONG Entry Triggers**:
     * Break above resistance WITH volume confirmation + RSI > 50
     * Pullback to support with RSI(30-40) + bullish divergence
     * MACD crossover above zero line + EMA alignment
   
   - **SHORT Entry Triggers**:
     * Break below support WITH volume confirmation + RSI < 50
     * Rally to resistance with RSI(60-70) + bearish divergence  
     * MACD crossover below zero line + EMA alignment
   
   - **Common Filters** (both directions):
     * Multiple timeframe alignment (3m, 15m, 4h)
     * Volume > 15% of 24h average
     * Avoid trading against extreme funding rates
     
3. **Exit Strategy** (Symmetric Triggers):
   - **LONG Take Profit**:
     * Price reaches upper resistance/technical target
     * RSI > 80 with bearish reversal patterns
     * MACD shows bearish divergence
   
   - **SHORT Take Profit**:
     * Price reaches lower support/technical target  
     * RSI < 20 with bullish reversal patterns
     * MACD shows bullish divergence
   
   - **Stop Loss Triggers** (both directions):
     * Key technical level broken against position
     * Volume surges against position direction
     * Market structure break

4. **Market Condition Adaptation**:
   - **Bull Trend**: Prefer LONG positions, avoid counter-trend SHORTS
   - **Bear Trend**: Prefer SHORT positions, avoid counter-trend LONGS  
   - **Ranging Market**: Both LONG at support and SHORT at resistance valid
   - **High Volatility**: Wider stops required for both directions

5. **Funding Rate Considerations**:
   - **LONG Bias**: When funding rate is negative/neutral (avoid extreme positive)
   - **SHORT Bias**: When funding rate is positive/neutral (avoid extreme negative)
   - Extreme rates (>|0.1%|) as potential contrarian signals

6. **Position Quality Assessment** (Both Directions):
   - **A+ Setup**: Clear technical levels, volume confirmation, aligned timeframes
   - **B Setup**: Mixed signals but overall directional bias clear
   - **Avoid**: Conflicting indicators, unclear levels, low conviction

CRITICAL RULE: Maintain directional neutrality - only trade the best setup regardless of bull/bear bias. The goal is to capture meaningful 10%+ price movements with appropriate stops. Small, frequent trades with tight stops result in death by fees and slippage. Quality over quantity.`;

        systemLogger.info(`🤖 开始分析 ${symbol}...`);
        // 使用 fetch 替代 OpenAI 客户端以确保正确的请求头
        const requestBody = {
          model: this.modelName,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: fullPrompt }
          ],
          temperature: 0.7,
          max_tokens: 4000  // 从1000增加到4000以避免截断
        };

        const response = await fetch(`${env.ai.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${env.ai.deepseekApiKey}`
          },
          body: JSON.stringify(requestBody)
        });

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
        const isNetworkError = error.message.includes('Premature close') ||
                               error.message.includes('fetch') ||
                               error.message.includes('ECONNRESET') ||
                               error.message.includes('timeout') ||
                               error.message.includes('network') ||
                               error.message.includes('ECONNABORTED');

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
  async buildAlphaArenaPrompt(symbol, priceData, tradePerformance, portfolioReturns) {
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

      // 计算夏普比率
      let sharpeRatio = 0;
      if (portfolioReturns[symbol] && portfolioReturns[symbol].length > 1) {
        const { calculateSharpeRatio } = require('../risk/RiskManagement');
        const ratios = calculateSharpeRatio(portfolioReturns[symbol]);
        sharpeRatio = ratios.sharpe;
      }

      // 构建提示词
      let prompt = `It has been trading for a while. The current time is ${new Date().toISOString()}.

ALL OF THE PRICE OR SIGNAL DATA BELOW IS ORDERED: OLDEST → NEWEST

Timeframes note: Unless stated otherwise in a section title, intraday series are provided at 3‑minute intervals.

CURRENT MARKET STATE FOR ${symbol}
current_price = ${(indicators3m.currentPrice || 0)}, current_ema20 = ${(indicators3m.currentEma20 || 0).toFixed(3)}, current_macd = ${(indicators3m.currentMacd || 0).toFixed(3)}, current_rsi (7 period) = ${(indicators3m.currentRsi7 || 0).toFixed(2)}

In addition, here is the latest ${symbol} open interest and funding rate for perps:

${oiText}Funding Rate: ${(fundingRate || 0).toExponential(6)}

Intraday series (3‑minute intervals, oldest → latest):

Mid prices: [${(indicators3m.midPrices || []).map(p => (p || 0).toFixed(symbol === 'BTC' ? 1 : symbol === 'ETH' ? 2 : 4)).join(', ')}]

EMA indicators (20‑period): [${(indicators3m.ema20Series || []).map(v => (v || 0).toFixed(3)).join(', ')}]

MACD indicators: [${(indicators3m.macdSeries || []).map(v => (v || 0).toFixed(3)).join(', ')}]

RSI indicators (7‑Period): [${(indicators3m.rsi7Series || []).map(v => (v || 0).toFixed(2)).join(', ')}]

RSI indicators (14‑Period): [${(indicators3m.rsi14Series || []).map(v => (v || 0).toFixed(2)).join(', ')}]`;

      // 添加4小时数据（如果可用）
      if (indicators4h) {
        prompt += `
Longer‑term context (4‑hour timeframe):

20‑Period EMA: ${(indicators4h.currentEma20 || 0).toFixed(3)} vs. 50‑Period EMA: ${(indicators4h.ema50Series && indicators4h.ema50Series.length > 0) ? indicators4h.ema50Series[indicators4h.ema50Series.length - 1].toFixed(3) : 'N/A'}

3‑Period ATR: ${(indicators4h.atr3Series && indicators4h.atr3Series.length > 0) ? indicators4h.atr3Series[indicators4h.atr3Series.length - 1].toFixed(3) : 'N/A'} vs. 14‑Period ATR: ${(indicators4h.atr14Series && indicators4h.atr14Series.length > 0) ? indicators4h.atr14Series[indicators4h.atr14Series.length - 1].toFixed(3) : 'N/A'}

Current Volume: ${(indicators4h.currentVolume || 0).toFixed(2)} vs. Average Volume: ${(indicators4h.avgVolume || 0).toFixed(2)}

MACD indicators: [${(indicators4h.macdSeries || []).map(v => (v || 0).toFixed(3)).join(', ')}]

RSI indicators (14‑Period): [${(indicators4h.rsi14Series || []).map(v => (v || 0).toFixed(2)).join(', ')}]`;
      }

      // 生成性能洞察
      const performance = tradePerformance[symbol] || {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        currentConsecutiveLosses: 0
      };
      const performanceInsights = this.generatePerformanceInsights(symbol, performance, portfolioReturns);

      // 添加当前行情信息
      prompt += `\n\nCURRENT MARKET STATUS
Current Price: $${(priceData.price || 0).toFixed(2)}
Timestamp: ${priceData.timestamp || 'N/A'}
Highest: $${(priceData.high || 0).toFixed(2)}
Lowest: $${(priceData.low || 0).toFixed(2)}
Volume: ${(priceData.volume || 0).toFixed(2)}
Price Change: ${(priceData.price_change || 0).toFixed(2)}%`;

      // 添加性能洞察
      if (performanceInsights) {
        prompt += `\n\nPERFORMANCE INSIGHTS
${performanceInsights}`;
      }

      // 添加账户信息
      prompt += `
\n\nHERE IS YOUR ACCOUNT INFORMATION & PERFORMANCE
Current Total Return (percent): ${((accountSummary?.totalReturnPercent || 0) || 0).toFixed(2)}%

Available Cash: ${((accountSummary?.availableCash || 0) || 0).toFixed(2)}

Current Account Value: ${((accountSummary?.accountValue || 0) || 0).toFixed(2)}

Current live positions: ${positionText || 'None'}

Sharpe Ratio: ${(sharpeRatio || 0).toFixed(3)}`;

      return prompt;
    } catch (error) {
      systemLogger.error(`构建${symbol} AlphaArena提示词失败: ${error.message}`);
      return null;
    }
  }

  /**
   * 生成性能洞察
   */
  generatePerformanceInsights(symbol, performance, portfolioReturns) {
    try {
      const totalTrades = performance.totalTrades || 0;
      const winningTrades = performance.winningTrades || 0;
      const winRate = totalTrades > 0 ? ((winningTrades / totalTrades) * 100).toFixed(1) : 0;
      const currentConsecutiveLosses = performance.currentConsecutiveLosses || 0;

      let insights = `- ${symbol} Historical Performance: ${totalTrades} trades, Win Rate: ${winRate}%\n`;
      insights += `- Current Consecutive Losses: ${currentConsecutiveLosses}\n`;

      // 添加组合分析
      if (portfolioReturns[symbol] && portfolioReturns[symbol].length >= 20) {
        const { calculateSharpeRatio } = require('../risk/RiskManagement');
        const ratios = calculateSharpeRatio(portfolioReturns[symbol]);
        insights += `- Sharpe Ratio: ${ratios.sharpe.toFixed(2)}\n`;
        insights += `- Sortino Ratio: ${ratios.sortino.toFixed(2)}\n`;
        insights += `- Max Drawdown: ${(ratios.maxDrawdown * 100).toFixed(2)}%\n`;

        if (ratios.sharpe < 0.5) {
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
   * 等待指定时间
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new AIAnalysis();
