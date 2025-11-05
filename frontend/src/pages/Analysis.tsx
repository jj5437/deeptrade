import { useEffect, useState } from "react";
import { Brain} from "lucide-react";
import { formatDate } from "@/utils/cn";
import { analysisApi, statsApi } from "@/services/api";
import { useDataStore } from "@/stores/dataStore";
import type { AISignal } from "@/types";

export function Analysis() {
  const { aiSignals, setAiSignals } = useDataStore();
  const [selectedSignal, setSelectedSignal] = useState<AISignal | null>(null);

  const [overallStats, setOverallStats] = useState({
    totalDecisions: 0,
    successfulDecisions: 0,
    accuracy: 0,
    totalProfit: 0
  });
  const [isLoading, setIsLoading] = useState(true);


  useEffect(() => {
    const loadData = async () => {
      try {
        setIsLoading(true);
        // 获取最新的50条AI信号
        const signalsData = await analysisApi.getSignals(50);
        setAiSignals(signalsData);

        // 获取总体统计数据
        try {
          const analysisStats = await analysisApi.getStats();
          setOverallStats(analysisStats);
        } catch (error) {
          console.error("Failed to load analysis stats:", error);
        }

        // 并发加载各币种统计信息
        const statsData: any = {};
        const uniqueSymbols = [...new Set(signalsData.slice(0, 5).map(s => s.symbol))];

        // 使用Promise.allSettled进行并发请求，即使某个请求失败也不会阻塞其他请求
        const statsPromises = uniqueSymbols.map(async (symbol) => {
          try {
            const stat = await statsApi.get(symbol);
            return { symbol, stat, success: true };
          } catch (error) {
            console.error("Failed to load stats for", symbol, error);
            return { symbol, stat: null, success: false };
          }
        });

        const results = await Promise.allSettled(statsPromises);
        results.forEach((result) => {
          if (result.status === 'fulfilled' && result.value.success) {
            statsData[result.value.symbol] = result.value.stat;
          }
        });

      } catch (error) {
        console.error("Failed to load analysis data:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [setAiSignals]);

  const signals = aiSignals;
  // 使用真实的总体统计数据，而不是前50条的长度
  const { totalDecisions, successfulDecisions, accuracy, totalProfit } = overallStats;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="card">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            {isLoading && (
              <div className="text-sm text-neutral-600 dark:text-neutral-400">
                <span className="inline-block w-2 h-2 bg-primary-500 rounded-full animate-pulse mr-2"></span>
                加载中...
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-8">
          <div className="text-center">
            <div className="text-4xl font-bold text-primary-500 mb-2">{totalDecisions}</div>
            <div className="text-sm text-neutral-600 dark:text-neutral-400">总决策数</div>
          </div>
          <div className="text-center">
            <div className="text-4xl font-bold text-success-500 mb-2">{successfulDecisions}</div>
            <div className="text-sm text-neutral-600 dark:text-neutral-400">成功决策</div>
          </div>
          <div className="text-center">
            <div className="text-4xl font-bold text-warning-500 mb-2">{accuracy.toFixed(1)}%</div>
            <div className="text-sm text-neutral-600 dark:text-neutral-400">准确率</div>
          </div>
          <div className="text-center">
            <div className="text-4xl font-bold text-neutral-800 dark:text-neutral-200 mb-2">${totalProfit.toFixed(2)}</div>
            <div className="text-sm text-neutral-600 dark:text-neutral-400">AI盈利</div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card">
            <h3 className="text-lg font-semibold mb-4 text-neutral-800 dark:text-neutral-200">最新AI分析</h3>
            <div className="h-[450px] overflow-y-auto pr-2 space-y-3 custom-scrollbar">
              {signals.map((signal) => {
                const signalColor = signal.signal === "BUY" ? "text-success-500" :
                                   signal.signal === "SELL" ? "text-error-500" : "text-warning-500";
                const bgColor = signal.signal === "BUY" ? "bg-success-500/10" :
                               signal.signal === "SELL" ? "bg-error-500/10" : "bg-warning-500/10";

                return (
                  <div
                    key={signal.id}
                    onClick={() => setSelectedSignal(signal)}
                    className="p-4 bg-neutral-200/50 dark:bg-neutral-800/50 rounded-xl hover:bg-neutral-300/50 dark:hover:bg-neutral-800 transition-all cursor-pointer hover:shadow-lg"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Brain className="w-4 h-4 text-primary-500" />
                        <span className="font-semibold text-neutral-800 dark:text-neutral-200">{signal.symbol}</span>
                      </div>
                      <span className="text-xs text-neutral-600 dark:text-neutral-400">{formatDate(signal.timestamp)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className={`px-3 py-1 rounded-lg ${bgColor} ${signalColor} font-semibold text-sm`}>
                        {signal.signal}
                      </div>
                      <div className="text-xs text-neutral-600 dark:text-neutral-400">
                        置信度: {signal.confidence.toUpperCase()}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card">
            <h3 className="text-lg font-semibold mb-4 text-neutral-800 dark:text-neutral-200">分析详情</h3>

            <div className="h-[450px] overflow-y-auto pr-2 custom-scrollbar">
              {selectedSignal ? (
              <div className="space-y-4">
                <div>
                  <div className="text-sm text-neutral-600 dark:text-neutral-400 mb-1">交易对</div>
                  <div className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{selectedSignal.symbol}</div>
                </div>

                <div>
                  <div className="text-sm text-neutral-600 dark:text-neutral-400 mb-1">决策信号</div>
                  <div className={`text-lg font-semibold ${selectedSignal.signal === "BUY" ? "text-success-500" :
                                                     selectedSignal.signal === "SELL" ? "text-error-500" : "text-warning-500"}`}>
                    {selectedSignal.signal}
                  </div>
                </div>

                <div>
                  <div className="text-sm text-neutral-600 dark:text-neutral-400 mb-1">置信度</div>
                  <div className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                    {selectedSignal.confidence.toUpperCase()}
                  </div>
                </div>

                <div>
                  <div className="text-sm text-neutral-600 dark:text-neutral-400 mb-1">分析时间</div>
                  <div className="text-neutral-900 dark:text-neutral-100">{formatDate(selectedSignal.timestamp)}</div>
                </div>

                <div>
                  <div className="text-sm text-neutral-600 dark:text-neutral-400 mb-1">决策依据</div>
                  <div className="text-sm bg-neutral-200/50 dark:bg-neutral-800/50 rounded-lg p-3 mt-2 text-neutral-900 dark:text-neutral-100">
                    {selectedSignal.reason}
                  </div>
                </div>

                {selectedSignal.result && (
                  <div>
                    <div className="text-sm text-neutral-600 dark:text-neutral-400 mb-1">执行结果</div>
                    <span className={`text-sm px-3 py-1 rounded-lg ${selectedSignal.result === "success" ? "bg-success-500/10 text-success-500" :
                                                                     selectedSignal.result === "failure" ? "bg-error-500/10 text-error-500" :
                                                                     "bg-warning-500/10 text-warning-500"}`}>
                      {selectedSignal.result === "success" ? "成功" : selectedSignal.result === "failure" ? "失败" : "进行中"}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-12 text-neutral-600 dark:text-neutral-400">
                选择一个决策查看详情
              </div>
            )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
