import { create } from 'zustand';
import type { Position, Trade, AISignal, MarketData, Config, AccountInfo } from '@/types';

interface DataState {
  positions: Position[];
  trades: Trade[];
  aiSignals: AISignal[];
  marketData: MarketData[];
  config: Config | null;
  accountInfo: AccountInfo | null;
  
  setPositions: (positions: Position[]) => void;
  addPosition: (position: Position) => void;
  updatePosition: (symbol: string, position: Partial<Position>) => void;
  removePosition: (symbol: string) => void;
  
  setTrades: (trades: Trade[]) => void;
  addTrade: (trade: Trade) => void;
  
  setAiSignals: (signals: AISignal[]) => void;
  addAiSignal: (signal: AISignal) => void;
  
  setMarketData: (data: MarketData[]) => void;

  setConfig: (config: Config) => void;

  setAccountInfo: (info: AccountInfo) => void;
}

export const useDataStore = create<DataState>((set) => ({
  positions: [],
  trades: [],
  aiSignals: [],
  marketData: [],
  config: null,
  accountInfo: null,
  
  setPositions: (positions) => set({ positions }),
  
  addPosition: (position) =>
    set((state) => ({
      positions: [...state.positions, position],
    })),
  
  updatePosition: (symbol, updates) =>
    set((state) => ({
      positions: state.positions.map((p) =>
        p.symbol === symbol ? { ...p, ...updates } : p
      ),
    })),
  
  removePosition: (symbol) =>
    set((state) => ({
      positions: state.positions.filter((p) => p.symbol !== symbol),
    })),
  
  setTrades: (trades) => set({ trades }),
  
  addTrade: (trade) =>
    set((state) => ({
      trades: [...state.trades, trade],
    })),
  
  setAiSignals: (aiSignals) => set({ aiSignals }),
  
  addAiSignal: (signal) =>
    set((state) => {
      // 检查信号是否已存在（避免重复）
      const exists = state.aiSignals.some(s => s.id === signal.id);
      if (exists) {
        return state;
      }

      // 添加新信号到列表前面，并保持最多50条
      const updatedSignals = [signal, ...state.aiSignals].slice(0, 50);
      return { aiSignals: updatedSignals };
    }),
  
  setMarketData: (marketData) => set({ marketData }),

  setConfig: (config) => set({ config }),

  setAccountInfo: (info) => set({ accountInfo: info }),
}));
