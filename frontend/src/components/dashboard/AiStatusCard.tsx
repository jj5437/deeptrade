import { Brain, Activity } from 'lucide-react';

interface AiStatusCardProps {
  decisionsToday: number;
  successRate: number;
}

export function AiStatusCard({ decisionsToday, successRate }: AiStatusCardProps) {
  return (
    <div className="row-span-2 card">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-neutral-700 dark:text-neutral-300">AI决策引擎</h3>
        <div className="flex items-center gap-2 px-3 py-1 bg-success-500/10 text-success-500 rounded-lg">
          <Activity className="w-4 h-4" />
          <span className="text-sm font-medium">运行中</span>
        </div>
      </div>

      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Brain className="w-5 h-5 text-primary-500" />
            <span className="text-neutral-600 dark:text-neutral-400">今日决策</span>
          </div>
          <span className="text-2xl font-bold font-mono text-neutral-900 dark:text-neutral-100">{decisionsToday}</span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-neutral-600 dark:text-neutral-400">成功率</span>
          <span className="text-2xl font-bold font-mono text-success-500">
            {(successRate || 0).toFixed(1)}%
          </span>
        </div>
      </div>
    </div>
  );
}
