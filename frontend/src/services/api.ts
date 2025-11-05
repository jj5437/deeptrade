import axios from 'axios';
import type { Position, Trade, AISignal, PerformanceStats, Config, MarketData, AccountInfo } from '@/types';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080/api';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true, // 重要：发送Cookie到服务器
});

// 响应拦截器 - 处理401错误（优化版）
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      // 防止重复处理
      if (error.config && error.config._retry) {
        return Promise.reject(error);
      }

      // 标记请求已重试
      error.config._retry = true;

      try {
        // 先检查session状态
        const statusResponse = await axios.get('http://localhost:8080/api/auth/status', {
          withCredentials: true,
          timeout: 5000
        });

        if (statusResponse.data.success && !statusResponse.data.authenticated) {
          // Session确实过期，清除本地状态
          localStorage.removeItem('auth-token');
          sessionStorage.removeItem('auth-user');

          // 显示提示信息
          alert('登录已过期，请重新登录');

          // 跳转到登录页
          window.location.href = '/login';
        } else {
          // Session正常，可能是网络问题，重试一次
          return apiClient.request(error.config);
        }
      } catch (statusError) {
        // 检查session失败，可能是网络问题
        console.error('检查session状态失败:', statusError);

        // 清除本地状态并跳转
        localStorage.removeItem('auth-token');
        sessionStorage.removeItem('auth-user');
        alert('网络异常或登录已过期，请重新登录');
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export const positionsApi = {
  getAll: async (): Promise<Position[]> => {
    const response = await apiClient.get('/positions');
    return response.data.data;
  },
  
  getBySymbol: async (symbol: string): Promise<Position> => {
    const response = await apiClient.get(`/positions/${symbol}`);
    return response.data.data;
  },
  
  close: async (symbol: string, reason: string = 'manual'): Promise<void> => {
    await apiClient.post(`/positions/close`, { symbol, reason });
  },
};

export const tradesApi = {
  getAll: async (): Promise<Trade[]> => {
    const response = await apiClient.get('/trades');
    return response.data.data;
  },
  
  create: async (trade: Partial<Trade>): Promise<Trade> => {
    const response = await apiClient.post('/trades', trade);
    return response.data.data;
  },
};

export const analysisApi = {
  getSignals: async (limit: number = 50): Promise<AISignal[]> => {
    const response = await apiClient.get('/analysis/signals', {
      params: { limit }
    });
    return response.data.data;
  },

  getSignalsBySymbol: async (symbol: string, limit: number = 10): Promise<AISignal[]> => {
    const response = await apiClient.get(`/analysis/signals/${symbol}`, {
      params: { limit }
    });
    return response.data.data;
  },

  getSignal: async (symbol: string): Promise<AISignal> => {
    const response = await apiClient.get(`/analysis/signals/${symbol}`);
    return response.data.data;
  },

  createSignal: async (signal: Partial<AISignal>): Promise<AISignal> => {
    const response = await apiClient.post('/analysis/signals', signal);
    return response.data.data;
  },

  getStats: async () => {
    const response = await apiClient.get('/analysis/stats');
    return response.data.data;
  },
};

export const statsApi = {
  get: async (symbol: string): Promise<PerformanceStats> => {
    const response = await apiClient.get(`/stats/${symbol}`);
    return response.data.data;
  },
  
  update: async (symbol: string, stats: Partial<PerformanceStats>): Promise<void> => {
    await apiClient.post(`/stats/${symbol}`, stats);
  },
};

export const configApi = {
  get: async (): Promise<Config> => {
    const response = await apiClient.get('/config');
    return response.data.data;
  },

  update: async (config: Partial<Config>): Promise<Config> => {
    const response = await apiClient.post('/config', config);
    return response.data.data;
  },

  reset: async (): Promise<Config> => {
    const response = await apiClient.post('/config/reset');
    return response.data.data;
  },
};

export const marketApi = {
  getAll: async (): Promise<MarketData[]> => {
    const response = await apiClient.get('/market');
    return response.data.data;
  },
};

export const accountApi = {
  get: async (): Promise<AccountInfo> => {
    const response = await apiClient.get('/account');
    return response.data.data;
  },
};

export default apiClient;
