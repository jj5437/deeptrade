import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import axios from 'axios';

interface User {
  username: string;
  loginTime: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  isAuthenticated: boolean;
  refreshAuthStatus: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // 检查登录状态
  const checkAuthStatus = async () => {
    try {
      const response = await axios.get('http://localhost:8080/api/auth/status', {
        withCredentials: true,
        timeout: 5000
      });

      if (response.data.success && response.data.authenticated) {
        setUser(response.data.user);
      } else {
        setUser(null);
      }
    } catch (error) {
      console.error('检查登录状态失败:', error);
      setUser(null);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  // 手动刷新登录状态
  const refreshAuthStatus = async () => {
    setIsRefreshing(true);
    await checkAuthStatus();
  };

  useEffect(() => {
    checkAuthStatus();
  }, []);

  // 独立的ping机制
  useEffect(() => {
    // 只在已登录且未刷新时启动ping
    if (!loading && user) {
      const pingInterval = setInterval(async () => {
        try {
          await axios.get('http://localhost:8080/api/auth/ping', {
            withCredentials: true,
            timeout: 5000
          });
          console.log('Session ping成功');
        } catch (error) {
          console.error('Session ping失败:', error);
          // ping失败时，重新检查状态
          if (!isRefreshing) {
            setIsRefreshing(true);
            setTimeout(() => {
              checkAuthStatus();
              setIsRefreshing(false);
            }, 1000);
          }
        }
      }, 5 * 60 * 1000); // 5分钟

      return () => clearInterval(pingInterval);
    }
  }, [user, loading]);

  const login = async (username: string, password: string) => {
    try {
      const response = await axios.post(
        'http://localhost:8080/api/auth/login',
        { username, password },
        { withCredentials: true }
      );

      if (response.data.success) {
        setUser(response.data.user);
        return { success: true };
      } else {
        return { success: false, error: response.data.error || '登录失败' };
      }
    } catch (error: any) {
      console.error('登录失败:', error);
      return {
        success: false,
        error: error.response?.data?.error || '登录失败，请检查网络连接'
      };
    }
  };

  const logout = async () => {
    try {
      await axios.post(
        'http://localhost:8080/api/auth/logout',
        {},
        { withCredentials: true }
      );
    } catch (error) {
      console.error('登出失败:', error);
    } finally {
      setUser(null);
    }
  };

  const value: AuthContextType = {
    user,
    loading,
    login,
    logout,
    isAuthenticated: !!user,
    refreshAuthStatus
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
