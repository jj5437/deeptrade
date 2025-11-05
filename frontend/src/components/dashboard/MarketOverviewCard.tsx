import { TrendingUp, TrendingDown } from "lucide-react";
import { formatCurrency, formatVolume } from "@/utils/cn";
import type { MarketData } from "@/types";

interface MarketOverviewCardProps {
  data: MarketData[];
}

// 固定的市场数据顺序
const SYMBOL_ORDER = ['BTC/USDT', 'ETH/USDT', 'BNB/USDT', 'XRP/USDT', 'SOL/USDT', 'DOGE/USDT'];

export function MarketOverviewCard({ data }: MarketOverviewCardProps) {
  // 按照固定顺序排序数据，只显示前6个，忽略不在列表中的symbol
  const filteredData = data.filter(item => item && item.symbol && SYMBOL_ORDER.includes(item.symbol));

  const sortedData = filteredData
    .sort((a, b) => {
      const aIndex = SYMBOL_ORDER.indexOf(a.symbol);
      const bIndex = SYMBOL_ORDER.indexOf(b.symbol);
      return aIndex - bIndex;
    })
    .slice(0, 6); // 限制只显示6个币种

  console.log('MarketOverviewCard - 原始数据:', data.length, '项');
  console.log('MarketOverviewCard - 过滤后数据:', sortedData.length, '项');

  return (
    <div className="col-span-full card">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-neutral-700 dark:text-neutral-300">市场概览</h3>
        <span className="text-xs text-neutral-500">显示 {sortedData.length}/6 个币种</span>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {sortedData.map((item) => {
          // 验证数据有效性，过滤NaN值
          const validPrice = typeof item.price === 'number' && !isNaN(item.price);
          const validChangePercent = typeof item.changePercent24h === 'number' && !isNaN(item.changePercent24h);

          if (!validPrice || !validChangePercent) {
            console.warn('MarketOverviewCard - 过滤无效数据:', item);
            return null;
          }

          const isPositive = item.changePercent24h >= 0;

          return (
            <div
              key={item.symbol}
              className="bg-neutral-200/50 dark:bg-neutral-800/50 rounded-lg p-5 hover:bg-neutral-300/50 dark:hover:bg-neutral-800 transition-colors flex flex-col justify-between min-h-[180px]"
            >
              <div className="flex items-center justify-between mb-3">
                <span className="font-semibold text-base text-neutral-800 dark:text-neutral-200">
                  {item.symbol}
                </span>
                {isPositive ? (
                  <TrendingUp className="w-5 h-5 text-success-500 flex-shrink-0" />
                ) : (
                  <TrendingDown className="w-5 h-5 text-error-500 flex-shrink-0" />
                )}
              </div>

              <div className="space-y-2">
                <div className="text-2xl font-bold font-mono text-neutral-900 dark:text-neutral-100">
                  {formatCurrency(item.price)}
                </div>
                <div className={`text-sm font-medium ${isPositive ? "text-success-500" : "text-error-500"}`}>
                  {isPositive ? "+" : ""}{item.changePercent24h.toFixed(2)}%
                </div>
                <div className="flex items-center justify-between text-xs text-neutral-600 dark:text-neutral-400 pt-1 border-t border-neutral-300 dark:border-neutral-700">
                  <div className="flex flex-col">
                    <span className="text-neutral-500">24h最高</span>
                    <span className="font-mono text-neutral-700 dark:text-neutral-300">{formatCurrency(item.high24h || 0)}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-neutral-500">24h最低</span>
                    <span className="font-mono text-neutral-700 dark:text-neutral-300">{formatCurrency(item.low24h || 0)}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-neutral-500">24h量</span>
                    <span className="font-mono text-neutral-700 dark:text-neutral-300">{formatVolume(item.volume24h || 0)}</span>
                  </div>
                </div>
              </div>
            </div>
          );
        }).filter(Boolean)}
      </div>
    </div>
  );
}
