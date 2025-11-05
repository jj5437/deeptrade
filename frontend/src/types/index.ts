export interface Position {
  id: string;
  symbol: string;
  exchange: 'binance' | 'okx';
  side: 'long' | 'short';
  size: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPercent: number;
  leverage: number;
  timestamp: number;
}

export interface Trade {
  id: string;
  symbol: string;
  exchange: string;
  side: 'buy' | 'sell' | 'long' | 'short';
  action?: 'open' | 'close';  // 开仓或平仓
  size: number;
  price: number;
  total: number;
  pnl?: number | null;  // 盈亏
  entryPrice?: number | null;  // 开仓价格
  leverage?: number | null;  // 杠杆
  stopLoss?: number | null;  // 止损价
  takeProfit?: number | null;  // 止盈价
  status: 'pending' | 'completed' | 'failed';
  message?: string;  // 交易信息
  timestamp: number;
}

export interface AISignal {
  id: string;
  symbol: string;
  signal: 'BUY' | 'SELL' | 'HOLD';
  confidence: string;
  reason: string;
  timestamp: number;
  result?: 'success' | 'failure' | 'pending';
}

export interface PerformanceStats {
  symbol: string;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnL: number;
  totalReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
}

export interface Config {
  exchange: {
    type: 'binance' | 'okx';
    binance: {
      apiKey: string;
      secretKey: string;
    };
    okx: {
      apiKey: string;
      secretKey: string;
      passphrase: string;
    };
  };
  trading: {
    amount: number;
    leverage: number;
    timeframe: string;
    autoTrade: boolean;
    holdThreshold: number;
    takeProfit: {
      enabled: boolean;
      percentage: number;
    };
    stopLoss: {
      enabled: boolean;
      percentage: number;
    };
    riskMonitor: {
      enabled: boolean;
      interval: number;
      autoClose: boolean;
    };
    invalidation: {
      BTC: number;
      ETH: number;
      SOL: number;
      XRP: number;
      DOGE: number;
      BNB: number;
    };
  };
  ai: {
    model: string;
    modelName: string;
    baseUrl?: string;
    deepseekApiKey?: string;
  };
  system: {
    port: number;
    adminUsername: string;
  };
}

export interface MarketData {
  symbol: string;
  price: number;
  change24h: number;
  changePercent24h: number;
  volume24h: number;
  high24h: number;
  low24h: number;
  timestamp: number;
}

export interface AccountInfo {
  availableCash: number;
  accountValue: number;
  totalReturnPercent: number;
  activePositions: ActivePositionInfo[];
}

export interface ActivePositionInfo {
  symbol: string;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  leverage: number;
}

