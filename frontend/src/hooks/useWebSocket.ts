import { useEffect, useRef, useState } from 'react';
import { useDataStore } from '@/stores/dataStore';
import { positionsApi, tradesApi, analysisApi } from '@/services/api';

export function useWebSocket() {
  const ws = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const { setPositions, setTrades, setAiSignals, addAiSignal } = useDataStore();

  useEffect(() => {
    const connect = () => {
      const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:8080/ws';
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
        const positions = await positionsApi.getAll();
        setPositions(positions);
        break;
      case 'trade_update':
        const trades = await tradesApi.getAll();
        setTrades(trades);
        break;
      case 'ai_signal':
        // 增量更新AI信号
        const newSignal = data.data;
        addAiSignal(newSignal);
        break;
      default:
        break;
    }
  };

  return { isConnected };
}
