import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { useTheme } from '@/hooks/useTheme';
import { useSidebarStore } from '@/stores/sidebarStore';
import { cn } from '@/utils/cn';

export function Layout() {
  // 初始化主题系统
  useTheme();
  const { isCollapsed } = useSidebarStore();

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-neutral-100 to-neutral-200 dark:from-neutral-950 dark:to-neutral-900 transition-colors">
      <Sidebar />
      <div className={cn('flex-1 flex flex-col transition-all duration-300 ease-in-out', isCollapsed ? 'ml-0' : 'ml-[336px]')}>
        <Header title="" />
        <main className="flex-1 m-4 mt-0 rounded-b-2xl overflow-auto">
          <div className="h-full glass-card rounded-b-2xl p-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
