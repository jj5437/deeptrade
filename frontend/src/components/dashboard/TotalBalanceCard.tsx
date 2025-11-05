import { Wallet } from 'lucide-react';
import { formatCurrency } from '@/utils/cn';
import type { AccountInfo } from '@/types';

interface TotalBalanceCardProps {
  accountInfo: AccountInfo | null;
}

export function TotalBalanceCard({ accountInfo }: TotalBalanceCardProps) {
  // 计算未实现盈亏（所有持仓的unrealizedPnl之和）
  const totalUnrealizedPnl = accountInfo?.activePositions.reduce((sum, pos) => sum + pos.unrealizedPnl, 0) || 0;

  // 计算保证金余额（账户价值 = 可用资金 + 保证金 + 未实现盈亏）
  const marginBalance = accountInfo ? accountInfo.accountValue : 0;

  // 可用余额
  const availableBalance = accountInfo?.availableCash || 0;

  // 判断盈亏颜色
  const isPositive = totalUnrealizedPnl >= 0;

  return (
    <div className="row-span-2 card">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-neutral-700 dark:text-neutral-300">账户资产</h3>
        <Wallet className="w-5 h-5 text-primary-500" />
      </div>

      <div className="mb-6">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-light text-neutral-600 dark:text-neutral-400">USDT</span>
          <span className="text-4xl font-bold font-mono text-neutral-900 dark:text-neutral-100">
            {formatCurrency(marginBalance).replace('US$', '')}
          </span>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-neutral-500 dark:text-neutral-400">可用余额</span>
          <span className="font-medium text-neutral-700 dark:text-neutral-300">
            {formatCurrency(availableBalance).replace('US$', '')}
          </span>
        </div>

        <div className="flex items-center justify-between text-sm">
          <span className="text-neutral-500 dark:text-neutral-400">未实现盈亏</span>
          <span className={`font-medium ${isPositive ? 'text-success-500' : 'text-error-500'}`}>
            {isPositive ? '+' : ''}{formatCurrency(totalUnrealizedPnl).replace('US$', '')}
          </span>
        </div>

        <div className="flex items-center justify-between text-sm">
          <span className="text-neutral-500 dark:text-neutral-400">收益率</span>
          <span className={`font-medium ${isPositive ? 'text-success-500' : 'text-error-500'}`}>
            {isPositive ? '+' : ''}{(accountInfo?.totalReturnPercent || 0).toFixed(2)}%
          </span>
        </div>
      </div>
    </div>
  );
}
