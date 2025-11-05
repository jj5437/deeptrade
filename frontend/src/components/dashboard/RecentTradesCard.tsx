import { formatDate, formatCurrency } from "@/utils/cn";
import type { Trade } from "@/types";

interface RecentTradesCardProps {
  trades: Trade[];
}

export function RecentTradesCard({ trades }: RecentTradesCardProps) {
  return (
    <div className="col-span-full card">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-neutral-700 dark:text-neutral-300">最近交易</h3>
      </div>

      <div className="space-y-3">
        {trades.map((trade) => {
          const isBuy = trade.side === "buy";

          return (
            <div
              key={trade.id}
              className="flex items-center justify-between p-4 bg-neutral-200/50 dark:bg-neutral-800/50 rounded-xl hover:bg-neutral-300/50 dark:hover:bg-neutral-800 transition-colors"
            >
              <div className="flex items-center gap-4">
                <div>
                  <div className="font-semibold text-neutral-800 dark:text-neutral-200">{trade.symbol}</div>
                  <div className="text-sm text-neutral-600 dark:text-neutral-400">{formatDate(trade.timestamp)}</div>
                </div>
              </div>

              <div className="flex items-center gap-8">
                <div className="text-center">
                  <div className="text-xs text-neutral-600 dark:text-neutral-400">类型</div>
                  <div className={`text-sm font-semibold ${isBuy ? "text-success-500" : "text-error-500"}`}>
                    {isBuy ? "买入" : "卖出"}
                  </div>
                </div>

                <div className="text-center">
                  <div className="text-xs text-neutral-600 dark:text-neutral-400">数量</div>
                  <div className="text-sm font-mono text-neutral-900 dark:text-neutral-100">{(trade.size || 0).toFixed(4)}</div>
                </div>

                <div className="text-center">
                  <div className="text-xs text-neutral-600 dark:text-neutral-400">价格</div>
                  <div className="text-sm font-mono text-neutral-900 dark:text-neutral-100">{formatCurrency(trade.price)}</div>
                </div>

                <div className="text-center">
                  <div className="text-xs text-neutral-600 dark:text-neutral-400">总计</div>
                  <div className="text-sm font-mono text-neutral-900 dark:text-neutral-100">{formatCurrency(trade.total || 0)}</div>
                </div>

                <div className="text-center">
                  <div className="text-xs text-neutral-600 dark:text-neutral-400">状态</div>
                  <div className={`text-xs px-2 py-1 rounded ${trade.status === "completed" ? "bg-success-500/10 text-success-500" :
                    trade.status === "pending" ? "bg-warning-500/10 text-warning-500" :
                    "bg-error-500/10 text-error-500"}`}>
                    {trade.status === "completed" ? "已完成" :
                     trade.status === "pending" ? "进行中" : "失败"}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
