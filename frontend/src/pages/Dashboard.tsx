import { useEffect, useRef, useState } from "react";
import { TotalBalanceCard } from "@/components/dashboard/TotalBalanceCard";
import { PnlCard } from "@/components/dashboard/PnlCard";
import { AiStatusCard } from "@/components/dashboard/AiStatusCard";
import { MarketOverviewCard } from "@/components/dashboard/MarketOverviewCard";
import { RecentTradesCard } from "@/components/dashboard/RecentTradesCard";
import { useDataStore } from "@/stores/dataStore";
import { positionsApi, tradesApi, marketApi, accountApi, analysisApi, statsApi } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";

export function Dashboard() {
  const { positions, trades, marketData, accountInfo, setPositions, setTrades, setMarketData, setAccountInfo } = useDataStore();
  const hasInitialLoad = useRef(false);
  const { isAuthenticated, loading } = useAuth();
  const [aiStats, setAiStats] = useState({
    totalDecisions: 0,
    successfulDecisions: 0,
    accuracy: 0,
    totalProfit: 0
  });
  const [todayRealizedPnl, setTodayRealizedPnl] = useState(0);

  useEffect(() => {
    // 只有在用户已认证且不在加载中时才加载数据
    if (!isAuthenticated || loading) {
      return;
    }

    const loadData = async () => {
      try {
        // 首次加载时获取所有数据
        if (!hasInitialLoad.current) {
          console.log('初始加载市场数据...');
          const [positionsData, tradesData, marketDataData, accountData] = await Promise.all([
            positionsApi.getAll(),
            tradesApi.getAll(),
            marketApi.getAll(),  // 只在首次加载时获取市场数据
            accountApi.get(),
          ]);
          setPositions(positionsData);
          setTrades(tradesData);
          setMarketData(marketDataData);
          setAccountInfo(accountData);

          // 加载AI统计数据和今日盈亏
          try {
            const [statsData, todayPnlData] = await Promise.all([
              analysisApi.getStats(),
              statsApi.getToday()
            ]);
            setAiStats(statsData);
            setTodayRealizedPnl(todayPnlData.todayRealizedPnl);
          } catch (error) {
            console.error("Failed to load stats:", error);
          }

          hasInitialLoad.current = true;
          console.log('初始市场数据加载完成:', marketDataData);
        } else {
          // 后续只更新持仓、交易和账户信息，市场数据由WebSocket实时更新
          console.log('更新持仓、交易和账户信息...');
          const [positionsData, tradesData, accountData] = await Promise.all([
            positionsApi.getAll(),
            tradesApi.getAll(),
            accountApi.get(),
          ]);
          setPositions(positionsData);
          setTrades(tradesData);
          setAccountInfo(accountData);

          // 更新AI统计数据和今日盈亏
          try {
            const [statsData, todayPnlData] = await Promise.all([
              analysisApi.getStats(),
              statsApi.getToday()
            ]);
            setAiStats(statsData);
            setTodayRealizedPnl(todayPnlData.todayRealizedPnl);
          } catch (error) {
            console.error("Failed to load stats:", error);
          }
        }
      } catch (error) {
        console.error("Failed to load data:", error);
      }
    };

    loadData();
    const interval = setInterval(loadData, 5000);

    return () => clearInterval(interval);
  }, [isAuthenticated, loading]); // 依赖于认证状态

  // 构造今日盈亏图表数据（模拟24小时数据）
  const pnlChartData = [
    { value: 0, timestamp: Date.now() - 4 * 60 * 60 * 1000 },
    { value: todayRealizedPnl * 0.3, timestamp: Date.now() - 3 * 60 * 60 * 1000 },
    { value: todayRealizedPnl * 0.7, timestamp: Date.now() - 2 * 60 * 60 * 1000 },
    { value: todayRealizedPnl, timestamp: Date.now() - 1 * 60 * 60 * 1000 },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-fade-in">
      <TotalBalanceCard accountInfo={accountInfo} />

      <PnlCard pnl={todayRealizedPnl} data={pnlChartData} />

      <AiStatusCard
        decisionsToday={aiStats.totalDecisions}
        successRate={aiStats.accuracy}
      />

      <MarketOverviewCard data={marketData || []} />

      <RecentTradesCard trades={(trades || []).slice(0, 5)} />
    </div>
  );
}
