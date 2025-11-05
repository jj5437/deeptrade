import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useDataStore } from '@/stores/dataStore';

interface WebSocketContextType {
  isConnected: boolean;
}

const WebSocketContext = createContext<WebSocketContextType>({
  isConnected: false,
});

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const ws = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const { setPositions, setTrades, addAiSignal, setMarketData } = useDataStore();
  const marketDataRef = useRef<any[]>([]);

  // 使用useEffect同步marketData
  useEffect(() => {
    const { marketData } = useDataStore.getState();
    marketDataRef.current = marketData;
  });

  useEffect(() => {
    const connect = () => {
      const wsUrl = (window as any).import?.meta?.env?.VITE_WS_URL || 'ws://localhost:8080/ws';
      ws.current = new WebSocket(wsUrl);

      ws.current.onopen = () => {
        setIsConnected(true);
        console.log('WebSocket connected');
      };

      ws.current.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          handleMessage(data);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };

      ws.current.onclose = () => {
        setIsConnected(false);
        console.log('WebSocket disconnected');
        setTimeout(connect, 5000);
      };

      ws.current.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
    };

    connect();

    return () => {
      if (ws.current) {
        ws.current.close();
      }
    };
  }, []);

  const handleMessage = async (data: any) => {
    switch (data.type) {
      case 'position_update':
        // 直接使用推送的数据（包含价格和pnl）
        if (data.data && Array.isArray(data.data)) {
          console.log('收到持仓更新:', data.data);
          setPositions(data.data);
        }
        break;
      case 'trade_update':
        if (data.data && Array.isArray(data.data)) {
          setTrades(data.data);
        }
        break;
      case 'ai_signal':
        if (data.data) {
          // 使用addAiSignal进行增量更新，自动处理去重和限制50条
          addAiSignal(data.data);
        }
        break;
      case 'market_update':
        if (data.data) {


          // 确保数据是数组
          const marketUpdates = Array.isArray(data.data) ? data.data : [data.data];

          // 如果当前市场数据为空，直接设置所有数据
          if (!marketDataRef.current || marketDataRef.current.length === 0) {
            setMarketData(marketUpdates);
          } else {
            // 合并更新数据
            const newMarketData = [...marketDataRef.current];
            marketUpdates.forEach((update: any) => {
              const existingIndex = newMarketData.findIndex(item => item.symbol === update.symbol);
              if (existingIndex >= 0) {
                newMarketData[existingIndex] = update;
              } else {
                newMarketData.push(update);
              }
            });
            setMarketData(newMarketData);
          }
        }
        break;
      default:
        break;
    }
  };

  return (
    <WebSocketContext.Provider value={{ isConnected }}>
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWebSocket() {
  return useContext(WebSocketContext);
}
