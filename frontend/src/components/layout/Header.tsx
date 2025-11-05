import { useState, useEffect } from 'react';
import { RefreshCw, Wifi, WifiOff, Sun, Moon, Menu, LogOut, User } from 'lucide-react';
import { formatTimeAgo } from '@/utils/cn';
import { useWebSocket } from '@/contexts/WebSocketContext';
import { useTheme } from '@/hooks/useTheme';
import { useSidebarStore } from '@/stores/sidebarStore';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/utils/cn';

interface HeaderProps {
  title: string;
  onRefresh?: () => void;
}

export function Header({ title, onRefresh }: HeaderProps) {
  const [lastUpdate, setLastUpdate] = useState(Date.now());
  const { isConnected } = useWebSocket();
  const { theme, toggleTheme } = useTheme();
  const { isCollapsed, toggleSidebar } = useSidebarStore();
  const { user, logout } = useAuth();

  useEffect(() => {
    const timer = setInterval(() => {
      setLastUpdate(Date.now());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const handleRefresh = () => {
    setLastUpdate(Date.now());
    onRefresh?.();
  };

  return (
    <header className="glass-card m-4 mb-0 rounded-t-2xl p-6 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <button
          onClick={toggleSidebar}
          className={cn(
            'p-3 rounded-xl transition-all duration-200',
            'hover:bg-gradient-to-r hover:from-primary-500/10 hover:to-primary-600/10',
            'text-neutral-700 dark:text-neutral-300'
          )}
          title={isCollapsed ? '展开侧边栏' : '收缩侧边栏'}
        >
          <Menu className="w-6 h-6" />
        </button>
        <div>
          <h2 className="text-3xl font-bold text-neutral-900 dark:text-neutral-100 mb-1 tracking-tight">
            {title}
          </h2>
          <p className="text-base text-neutral-600 dark:text-neutral-400 font-medium">
            最后更新: {formatTimeAgo(lastUpdate)}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-success-500/10 text-success-500 border border-success-500/20">
          {isConnected ? <Wifi className="w-5 h-5" /> : <WifiOff className="w-5 h-5" />}
          <span className="text-sm font-semibold">
            {isConnected ? '实时连接' : '连接断开'}
          </span>
        </div>

        <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-500/10 text-blue-500 border border-blue-500/20">
          <User className="w-5 h-5" />
          <span className="text-sm font-semibold">
            {user?.username}
          </span>
        </div>

        <button
          onClick={toggleTheme}
          className="btn-secondary flex items-center gap-2"
          title={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
        >
          {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          {theme === 'dark' ? '浅色模式' : '深色模式'}
        </button>

        <button
          onClick={handleRefresh}
          className="btn-secondary flex items-center gap-2"
        >
          <RefreshCw className="w-5 h-5" />
          刷新
        </button>

        <button
          onClick={logout}
          className="btn-danger flex items-center gap-2"
          title="登出"
        >
          <LogOut className="w-5 h-5" />
          登出
        </button>
      </div>
    </header>
  );
}
