import { useEffect, useState, useCallback } from "react";
import { formatCurrency, formatNumber, formatPercent } from "@/utils/cn";
import { positionsApi } from "@/services/api";
import { useDataStore } from "@/stores/dataStore";
import type { Position } from "@/types";

export function Positions() {
  // 使用全局状态（来自WebSocket推送）
  const positions = useDataStore((state) => state.positions);
  const setPositions = useDataStore((state) => state.setPositions);
  const [selectedPosition, setSelectedPosition] = useState<Position | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [closingSymbol, setClosingSymbol] = useState<string | null>(null);

  const loadPositions = useCallback(async (showRefreshing = false) => {
    try {
      if (showRefreshing) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      const data = await positionsApi.getAll();
      setPositions(data);
    } catch (error) {
      console.error("Failed to load positions:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // 初始加载：从API快速获取数据（快速模式，pnl=0但数据展示快）
    loadPositions();

    // 注意：移除了定时刷新，因为WebSocket每30秒推送实时价格数据
    // 页面上的价格、pnl、pnlPercent会通过WebSocket自动更新
  }, []);

  const handleClosePosition = async (symbol: string) => {
    try {
      setClosingSymbol(symbol);
      await positionsApi.close(symbol, "manual");
      setPositions(positions.filter(p => p.symbol !== symbol));
      if (selectedPosition?.symbol === symbol) {
        setSelectedPosition(null);
      }
    } catch (error) {
      console.error("Failed to close position:", error);
      alert("平仓失败，请重试");
    } finally {
      setClosingSymbol(null);
    }
  };

  const handleCloseAll = async () => {
    for (const position of positions) {
      await handleClosePosition(position.symbol);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-neutral-600 dark:text-neutral-400">加载中...</div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-in">
      <div className="lg:col-span-2 card">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">持仓列表</h2>
            {refreshing && (
              <span className="text-sm text-primary-500 flex items-center gap-2">
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                </svg>
                刷新中...
              </span>
            )}
          </div>
          <button
            onClick={handleCloseAll}
            className="btn-danger flex items-center gap-2"
            disabled={positions.length === 0}
          >
            <span>平仓所有</span>
          </button>
        </div>

        <div className="space-y-3">
          {positions.map((position) => {
            // 数据库可能存储 buy/sell 或 long/short，统一映射为 long
            const isLong = position.side === "long" || position.side === "buy";
            const isProfit = position.pnl >= 0;

            return (
              <div
                key={position.id}
                onClick={() => setSelectedPosition(position)}
                className="p-3 bg-neutral-200/50 dark:bg-neutral-800/50 rounded-xl hover:bg-neutral-300/50 dark:hover:bg-neutral-800 transition-all cursor-pointer hover:shadow-lg"
              >
                <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                  {/* 交易对信息 - 左上 */}
                  <div className="flex items-center gap-2 min-w-[120px]">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-neutral-800 dark:text-neutral-200 text-sm">{position.symbol}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${isLong ? "bg-success-500/10 text-success-500" : "bg-error-500/10 text-error-500"}`}>
                          {isLong ? "多" : "空"}
                        </span>
                      </div>
                      <div className="text-xs text-neutral-600 dark:text-neutral-400">
                        {position.leverage}x 杠杆
                      </div>
                    </div>
                  </div>

                  {/* 持仓数量 */}
                  <div className="text-center min-w-[80px]">
                    <div className="text-xs text-neutral-600 dark:text-neutral-400">持仓数量</div>
                    <div className="font-mono text-xs text-neutral-900 dark:text-neutral-100">{formatNumber(position.size, 4)}</div>
                  </div>

                  {/* 开仓价格 */}
                  <div className="text-center min-w-[90px]">
                    <div className="text-xs text-neutral-600 dark:text-neutral-400">开仓价格</div>
                    <div className="font-mono text-xs text-neutral-900 dark:text-neutral-100">{formatCurrency(position.entryPrice)}</div>
                  </div>

                  {/* 当前价格 */}
                  <div className="text-center min-w-[90px]">
                    <div className="text-xs text-neutral-600 dark:text-neutral-400">当前价格</div>
                    <div className="font-mono text-xs text-neutral-900 dark:text-neutral-100">{formatCurrency(position.currentPrice)}</div>
                  </div>

                  {/* 浮动盈亏 */}
                  <div className="text-center min-w-[100px]">
                    <div className="text-xs text-neutral-600 dark:text-neutral-400">浮动盈亏</div>
                    <div className={`font-mono text-xs font-semibold ${isProfit ? "text-success-500" : "text-error-500"} truncate`}>
                      {formatCurrency(position.pnl)}
                    </div>
                  </div>

                  {/* 收益率 */}
                  <div className="text-center min-w-[70px]">
                    <div className="text-xs text-neutral-600 dark:text-neutral-400">收益率</div>
                    <div className={`font-mono text-xs font-semibold ${isProfit ? "text-success-500" : "text-error-500"}`}>
                      {formatPercent(position.pnlPercent)}
                    </div>
                  </div>

                  {/* 平仓按钮 - 右上 */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleClosePosition(position.symbol);
                    }}
                    className="btn-secondary text-xs px-3 py-1 ml-auto"
                    disabled={closingSymbol === position.symbol}
                  >
                    {closingSymbol === position.symbol ? (
                      <span className="flex items-center gap-2">
                        <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                        </svg>
                        平仓中...
                      </span>
                    ) : (
                      "平仓"
                    )}
                  </button>
                </div>
              </div>
            );
          })}

          {positions.length === 0 && (
            <div className="text-center py-12 text-neutral-600 dark:text-neutral-400">
              暂无持仓
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <h2 className="text-xl font-bold mb-6 text-neutral-900 dark:text-neutral-100">持仓详情</h2>

        {selectedPosition ? (
          <div className="space-y-4">
            <div>
              <div className="text-sm text-neutral-600 dark:text-neutral-400 mb-1">交易对</div>
              <div className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{selectedPosition.symbol}</div>
            </div>

            <div>
              <div className="text-sm text-neutral-600 dark:text-neutral-400 mb-1">持仓方向</div>
              <div className={selectedPosition.side === "long" ? "text-success-500" : "text-error-500"}>
                {selectedPosition.side === "long" ? "做多" : "做空"}
              </div>
            </div>

            <div>
              <div className="text-sm text-neutral-600 dark:text-neutral-400 mb-1">持仓数量</div>
              <div className="font-mono text-neutral-900 dark:text-neutral-100">{formatNumber(selectedPosition.size, 4)}</div>
            </div>

            <div>
              <div className="text-sm text-neutral-600 dark:text-neutral-400 mb-1">杠杆倍数</div>
              <div className="text-neutral-900 dark:text-neutral-100">{selectedPosition.leverage}x</div>
            </div>

            <div>
              <div className="text-sm text-neutral-600 dark:text-neutral-400 mb-1">开仓价格</div>
              <div className="font-mono text-neutral-900 dark:text-neutral-100">{formatCurrency(selectedPosition.entryPrice)}</div>
            </div>

            <div>
              <div className="text-sm text-neutral-600 dark:text-neutral-400 mb-1">当前价格</div>
              <div className="font-mono text-neutral-900 dark:text-neutral-100">{formatCurrency(selectedPosition.currentPrice)}</div>
            </div>

            <div className="pt-4 border-t border-neutral-300 dark:border-neutral-800">
              <div className="text-sm text-neutral-600 dark:text-neutral-400 mb-1">浮动盈亏</div>
              <div className={`text-2xl font-bold font-mono ${selectedPosition.pnl >= 0 ? "text-success-500" : "text-error-500"}`}>
                {formatCurrency(selectedPosition.pnl)}
              </div>
            </div>

            <button
              onClick={() => handleClosePosition(selectedPosition.symbol)}
              className="btn-danger w-full mt-6"
              disabled={closingSymbol === selectedPosition.symbol}
            >
              {closingSymbol === selectedPosition.symbol ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                  </svg>
                  平仓中...
                </span>
              ) : (
                "平仓"
              )}
            </button>
          </div>
        ) : (
          <div className="text-center py-12 text-neutral-600 dark:text-neutral-400">
            选择一个持仓查看详情
          </div>
        )}
      </div>
    </div>
  );
}
