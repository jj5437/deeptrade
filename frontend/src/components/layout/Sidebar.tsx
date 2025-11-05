import { NavLink } from 'react-router-dom';
import { cn } from '@/utils/cn';
import { useSidebarStore } from '@/stores/sidebarStore';
import {
  BarChart3,
  Briefcase,
  History,
  Brain,
  Settings,
  ChevronLeft,
  ChevronRight,
  TrendingUp
} from 'lucide-react';

const navigation = [
  { name: '仪表盘', href: '/', icon: BarChart3 },
  { name: '持仓管理', href: '/positions', icon: Briefcase },
  { name: '交易历史', href: '/history', icon: History },
  { name: 'AI分析', href: '/analysis', icon: Brain },
  { name: '设置', href: '/settings', icon: Settings },
];

export function Sidebar() {
  const { isCollapsed, toggleSidebar } = useSidebarStore();

  return (
    <aside
      className={cn(
        'glass-card m-4 rounded-2xl p-6 flex flex-col h-[calc(100vh-2rem)] fixed left-0 top-0 z-30 w-80 transition-all duration-300 ease-in-out'
      )}
      style={{
        transform: isCollapsed ? 'translateX(-100%)' : 'translateX(0)',
      }}
    >
      {/* 头部 Logo 和折叠按钮 */}
      <div className={cn('flex items-center', isCollapsed ? 'justify-center' : 'justify-between')}>
        {!isCollapsed && (
          <div>
            <h1 className="text-3xl font-bold text-gradient tracking-tight">
              DeepTrade
            </h1>
            <p className="text-base text-neutral-600 dark:text-neutral-400 mt-1 font-medium">
              AI自动化加密货币交易平台
            </p>
          </div>
        )}
        {isCollapsed && (
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-primary text-white">
            <TrendingUp className="w-6 h-6" />
          </div>
        )}
        <button
          onClick={toggleSidebar}
          className="p-2 rounded-lg hover:bg-neutral-200/80 dark:hover:bg-neutral-800/80 transition-colors"
          title={isCollapsed ? '展开侧边栏' : '收缩侧边栏'}
        >
          {isCollapsed ? (
            <ChevronRight className="w-5 h-5 text-neutral-600 dark:text-neutral-400" />
          ) : (
            <ChevronLeft className="w-5 h-5 text-neutral-600 dark:text-neutral-400" />
          )}
        </button>
      </div>

      {/* 导航菜单 */}
      <nav className={cn('flex-1 space-y-3 mt-8', isCollapsed ? 'mt-10' : '')}>
        {navigation.map((item) => (
          <NavLink
            key={item.name}
            to={item.href}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-4 px-4 py-4 rounded-2xl transition-all duration-200 group',
                'hover:bg-gradient-to-r hover:from-primary-500/10 hover:to-primary-600/10 hover:shadow-lg',
                isActive
                  ? 'bg-gradient-primary text-white shadow-xl transform scale-[1.02]'
                  : 'text-neutral-700 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-100'
              )
            }
          >
            <item.icon
              className={cn(
                'w-6 h-6 transition-colors',
                isCollapsed ? 'mx-auto' : '',
                'group-hover:scale-110'
              )}
            />
            {!isCollapsed && (
              <span className="font-semibold text-base">{item.name}</span>
            )}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
