import { LineChart, Line, ResponsiveContainer } from 'recharts';
import { formatCurrency } from '@/utils/cn';

interface PnlCardProps {
  pnl: number;
  data: Array<{ value: number; timestamp: number }>;
}

export function PnlCard(props: PnlCardProps) {
  const { pnl } = props;
  const isPositive = pnl >= 0;

  return (
    <div className="row-span-2 card">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-neutral-700 dark:text-neutral-300">今日盈亏</h3>
      </div>

      <div className="mb-6">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-light text-neutral-600 dark:text-neutral-400">USD</span>
          <span className="text-4xl font-bold font-mono text-neutral-900 dark:text-neutral-100">
            {formatCurrency(pnl).replace('US$', '')}
          </span>
        </div>
      </div>

      <div className="h-32">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={props.data}>
            <Line
              type="monotone"
              dataKey="value"
              stroke={isPositive ? '#22c55e' : '#ef4444'}
              strokeWidth={2}
              dot={false}
              animationDuration={300}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
