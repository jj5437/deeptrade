import { useState, useEffect } from "react";
import { useDataStore } from "@/stores/dataStore";
import { useThemeStore } from "@/stores/themeStore";
import { useToastContext } from "@/contexts/ToastContext";
import { configApi } from "@/services/api";
import type { Config } from "@/types";
import { cn } from "@/utils/cn";

type TabType = "exchange" | "ai" | "trading" | "risk";

export function Settings() {
  const { config, setConfig } = useDataStore();
  const { theme, toggleTheme } = useThemeStore();
  const { success, error: showError, warning } = useToastContext();
  const [formData, setFormData] = useState<Partial<Config>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>("exchange");
  const [showApiKeys, setShowApiKeys] = useState(false);

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const data = await configApi.get();
        setConfig(data);
        setFormData(data);
      } catch (error) {
        console.error("Failed to load config:", error);
      } finally {
        setLoading(false);
      }
    };

    loadConfig();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await configApi.update(formData);
      const newConfig = await configApi.get();
      setConfig(newConfig);
      setFormData(newConfig);
      success("设置保存成功");
    } catch (error) {
      console.error("Failed to save config:", error);
      showError("设置保存失败: " + (error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (confirm("确定要重置所有设置为默认值吗？")) {
      try {
        const defaultConfig = await configApi.reset();
        setFormData(defaultConfig);
        setConfig(defaultConfig);
        success("配置已重置为默认值");
      } catch (error) {
        console.error("Failed to reset config:", error);
        showError("重置配置失败: " + (error as Error).message);
      }
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-neutral-600 dark:text-neutral-400">加载中...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="card">
        <h2 className="text-xl font-bold mb-6 text-neutral-900 dark:text-neutral-100">设置中心</h2>

        {/* 标签页导航 */}
        <div className="flex gap-2 mb-8 bg-neutral-100 dark:bg-neutral-800/50 p-1 rounded-xl overflow-x-auto">
          <button
            onClick={() => setActiveTab("exchange")}
            className={cn(
              "flex-1 py-3 px-4 rounded-lg font-semibold transition-all duration-200 whitespace-nowrap",
              activeTab === "exchange"
                ? "bg-gradient-primary text-white shadow-lg"
                : "text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200/80 dark:hover:bg-neutral-800"
            )}
          >
            交易所配置
          </button>
          <button
            onClick={() => setActiveTab("ai")}
            className={cn(
              "flex-1 py-3 px-4 rounded-lg font-semibold transition-all duration-200 whitespace-nowrap",
              activeTab === "ai"
                ? "bg-gradient-primary text-white shadow-lg"
                : "text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200/80 dark:hover:bg-neutral-800"
            )}
          >
            AI配置
          </button>
          <button
            onClick={() => setActiveTab("trading")}
            className={cn(
              "flex-1 py-3 px-4 rounded-lg font-semibold transition-all duration-200 whitespace-nowrap",
              activeTab === "trading"
                ? "bg-gradient-primary text-white shadow-lg"
                : "text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200/80 dark:hover:bg-neutral-800"
            )}
          >
            交易参数
          </button>
          <button
            onClick={() => setActiveTab("risk")}
            className={cn(
              "flex-1 py-3 px-4 rounded-lg font-semibold transition-all duration-200 whitespace-nowrap",
              activeTab === "risk"
                ? "bg-gradient-primary text-white shadow-lg"
                : "text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200/80 dark:hover:bg-neutral-800"
            )}
          >
            风控设置
          </button>
        </div>

        {/* 标签页内容 */}
        <div className="min-h-[400px]">
          {/* 交易所配置 */}
          {activeTab === "exchange" && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold mb-4 text-neutral-800 dark:text-neutral-200">选择交易所</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div
                  onClick={() => setFormData({
                    ...formData,
                    exchange: { ...formData.exchange, type: 'binance' }
                  })}
                  className={cn(
                    "p-4 border-2 rounded-lg cursor-pointer transition-all",
                    formData.exchange?.type === 'binance'
                      ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                      : "border-neutral-300 dark:border-neutral-700 hover:border-neutral-400"
                  )}
                >
                  <div className="font-semibold text-neutral-900 dark:text-neutral-100">币安 (Binance)</div>
                  <div className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">全球最大的加密货币交易所</div>
                </div>
                <div
                  onClick={() => setFormData({
                    ...formData,
                    exchange: { ...formData.exchange, type: 'okx' }
                  })}
                  className={cn(
                    "p-4 border-2 rounded-lg cursor-pointer transition-all",
                    formData.exchange?.type === 'okx'
                      ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                      : "border-neutral-300 dark:border-neutral-700 hover:border-neutral-400"
                  )}
                >
                  <div className="font-semibold text-neutral-900 dark:text-neutral-100">欧易 (OKX)</div>
                  <div className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">领先的数字资产交易平台</div>
                </div>
              </div>

              {/* API密钥配置 */}
              <div className="pt-6 border-t border-neutral-300 dark:border-neutral-800">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-neutral-800 dark:text-neutral-200">API密钥配置</h3>
                  <button
                    onClick={() => setShowApiKeys(!showApiKeys)}
                    className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    {showApiKeys ? "隐藏" : "显示"}密钥
                  </button>
                </div>

                {formData.exchange?.type === 'binance' && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-2 text-neutral-900 dark:text-neutral-100">API Key</label>
                      <input
                        type={showApiKeys ? "text" : "password"}
                        value={formData.exchange?.binance?.apiKey || ''}
                        onChange={(e) => setFormData({
                          ...formData,
                          exchange: {
                            ...formData.exchange,
                            binance: { ...formData.exchange?.binance, apiKey: e.target.value }
                          }
                        })}
                        className="input-field"
                        placeholder="输入币安API Key"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2 text-neutral-900 dark:text-neutral-100">Secret Key</label>
                      <input
                        type={showApiKeys ? "text" : "password"}
                        value={formData.exchange?.binance?.secretKey || ''}
                        onChange={(e) => setFormData({
                          ...formData,
                          exchange: {
                            ...formData.exchange,
                            binance: { ...formData.exchange?.binance, secretKey: e.target.value }
                          }
                        })}
                        className="input-field"
                        placeholder="输入币安Secret Key"
                      />
                    </div>
                  </div>
                )}

                {formData.exchange?.type === 'okx' && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-2 text-neutral-900 dark:text-neutral-100">API Key</label>
                      <input
                        type={showApiKeys ? "text" : "password"}
                        value={formData.exchange?.okx?.apiKey || ''}
                        onChange={(e) => setFormData({
                          ...formData,
                          exchange: {
                            ...formData.exchange,
                            okx: { ...formData.exchange?.okx, apiKey: e.target.value }
                          }
                        })}
                        className="input-field"
                        placeholder="输入欧易API Key"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2 text-neutral-900 dark:text-neutral-100">Secret Key</label>
                      <input
                        type={showApiKeys ? "text" : "password"}
                        value={formData.exchange?.okx?.secretKey || ''}
                        onChange={(e) => setFormData({
                          ...formData,
                          exchange: {
                            ...formData.exchange,
                            okx: { ...formData.exchange?.okx, secretKey: e.target.value }
                          }
                        })}
                        className="input-field"
                        placeholder="输入欧易Secret Key"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2 text-neutral-900 dark:text-neutral-100">Passphrase</label>
                      <input
                        type={showApiKeys ? "text" : "password"}
                        value={formData.exchange?.okx?.passphrase || ''}
                        onChange={(e) => setFormData({
                          ...formData,
                          exchange: {
                            ...formData.exchange,
                            okx: { ...formData.exchange?.okx, passphrase: e.target.value }
                          }
                        })}
                        className="input-field"
                        placeholder="输入欧易Passphrase"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* AI配置 */}
          {activeTab === "ai" && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold mb-4 text-neutral-800 dark:text-neutral-200">AI模型配置 (DeepSeek)</h3>

              <div>
                <label className="block text-sm font-medium mb-2 text-neutral-900 dark:text-neutral-100">API Base URL</label>
                <input
                  type="text"
                  value={formData.ai?.baseUrl || ''}
                  onChange={(e) => setFormData({
                    ...formData,
                    ai: { ...formData.ai, baseUrl: e.target.value }
                  })}
                  className="input-field"
                  placeholder="https://api.deepseek.com"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2 text-neutral-900 dark:text-neutral-100">API Key</label>
                <input
                  type={showApiKeys ? "text" : "password"}
                  value={formData.ai?.deepseekApiKey || ''}
                  onChange={(e) => setFormData({
                    ...formData,
                    ai: { ...formData.ai, deepseekApiKey: e.target.value }
                  })}
                  className="input-field"
                  placeholder="输入DeepSeek API Key"
                />
              </div>
            </div>
          )}

          {/* 交易参数 */}
          {activeTab === "trading" && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold mb-4 text-neutral-800 dark:text-neutral-200">交易参数</h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2 text-neutral-900 dark:text-neutral-100">交易金额 (USDT)</label>
                  <input
                    type="number"
                    value={formData.trading?.amount || 10}
                    onChange={(e) => setFormData({
                      ...formData,
                      trading: { ...formData.trading, amount: Number(e.target.value) }
                    })}
                    className="input-field"
                    min="1"
                    max="10000"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2 text-neutral-900 dark:text-neutral-100">杠杆基数</label>
                  <input
                    type="number"
                    value={formData.trading?.leverage || 10}
                    onChange={(e) => setFormData({
                      ...formData,
                      trading: { ...formData.trading, leverage: Number(e.target.value) }
                    })}
                    className="input-field"
                    min="1"
                    max="100"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2 text-neutral-900 dark:text-neutral-100">时间周期</label>
                  <select
                    value={formData.trading?.timeframe || '3m'}
                    onChange={(e) => setFormData({
                      ...formData,
                      trading: { ...formData.trading, timeframe: e.target.value }
                    })}
                    className="input-field"
                  >
                    <option value="1m">1分钟</option>
                    <option value="3m">3分钟</option>
                    <option value="5m">5分钟</option>
                    <option value="15m">15分钟</option>
                    <option value="30m">30分钟</option>
                    <option value="1h">1小时</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2 text-neutral-900 dark:text-neutral-100">止盈百分比 (%)</label>
                  <input
                    type="number"
                    value={formData.trading?.takeProfit?.percentage || 2}
                    onChange={(e) => setFormData({
                      ...formData,
                      trading: {
                        ...formData.trading,
                        takeProfit: { ...formData.trading?.takeProfit, percentage: Number(e.target.value) }
                      }
                    })}
                    className="input-field"
                    min="1"
                    max="50"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2 text-neutral-900 dark:text-neutral-100">止损百分比 (%)</label>
                  <input
                    type="number"
                    value={formData.trading?.stopLoss?.percentage || 5}
                    onChange={(e) => setFormData({
                      ...formData,
                      trading: {
                        ...formData.trading,
                        stopLoss: { ...formData.trading?.stopLoss, percentage: Number(e.target.value) }
                      }
                    })}
                    className="input-field"
                    min="1"
                    max="20"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-neutral-900 dark:text-neutral-100">自动交易</div>
                    <div className="text-sm text-neutral-600 dark:text-neutral-400">启用后系统将自动执行交易</div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.trading?.autoTrade || false}
                      onChange={(e) => setFormData({
                        ...formData,
                        trading: { ...formData.trading, autoTrade: e.target.checked }
                      })}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-neutral-300 dark:bg-neutral-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
                  </label>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-neutral-900 dark:text-neutral-100">启用止盈</div>
                    <div className="text-sm text-neutral-600 dark:text-neutral-400">达到止盈点时自动平仓</div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.trading?.takeProfit?.enabled || false}
                      onChange={(e) => setFormData({
                        ...formData,
                        trading: {
                          ...formData.trading,
                          takeProfit: { ...formData.trading?.takeProfit, enabled: e.target.checked }
                        }
                      })}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-neutral-300 dark:bg-neutral-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
                  </label>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-neutral-900 dark:text-neutral-100">启用止损</div>
                    <div className="text-sm text-neutral-600 dark:text-neutral-400">达到止损点时自动平仓</div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.trading?.stopLoss?.enabled || false}
                      onChange={(e) => setFormData({
                        ...formData,
                        trading: {
                          ...formData.trading,
                          stopLoss: { ...formData.trading?.stopLoss, enabled: e.target.checked }
                        }
                      })}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-neutral-300 dark:bg-neutral-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* 风控设置 */}
          {activeTab === "risk" && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold mb-4 text-neutral-800 dark:text-neutral-200">策略失效条件</h3>
              <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-4">
                当价格跌破以下阈值时，对应币种的所有策略将自动失效
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'BNB'].map((symbol) => (
                  <div key={symbol}>
                    <label className="block text-sm font-medium mb-2 text-neutral-900 dark:text-neutral-100">
                      {symbol} 失效价格 (USDT)
                    </label>
                    <input
                      type="number"
                      step="0.00001"
                      value={formData.trading?.invalidation?.[symbol] || 0}
                      onChange={(e) => setFormData({
                        ...formData,
                        trading: {
                          ...formData.trading,
                          invalidation: {
                            ...formData.trading?.invalidation,
                            [symbol]: Number(e.target.value)
                          }
                        }
                      })}
                      className="input-field"
                      placeholder={`输入${symbol}失效价格`}
                    />
                  </div>
                ))}
              </div>

              <div className="pt-6 border-t border-neutral-300 dark:border-neutral-800">
                <h3 className="text-lg font-semibold mb-4 text-neutral-800 dark:text-neutral-200">风险监控</h3>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium text-neutral-900 dark:text-neutral-100">启用风险监控</div>
                      <div className="text-sm text-neutral-600 dark:text-neutral-400">实时监控持仓风险</div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.trading?.riskMonitor?.enabled || false}
                        onChange={(e) => setFormData({
                          ...formData,
                          trading: {
                            ...formData.trading,
                            riskMonitor: { ...formData.trading?.riskMonitor, enabled: e.target.checked }
                          }
                        })}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-neutral-300 dark:bg-neutral-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
                    </label>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2 text-neutral-900 dark:text-neutral-100">监控间隔 (秒)</label>
                    <input
                      type="number"
                      value={formData.trading?.riskMonitor?.interval || 30}
                      onChange={(e) => setFormData({
                        ...formData,
                        trading: {
                          ...formData.trading,
                          riskMonitor: { ...formData.trading?.riskMonitor, interval: Number(e.target.value) }
                        }
                      })}
                      className="input-field"
                      min="10"
                      max="300"
                    />
                  </div>

                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="autoClose"
                      checked={formData.trading?.riskMonitor?.autoClose || false}
                      onChange={(e) => setFormData({
                        ...formData,
                        trading: {
                          ...formData.trading,
                          riskMonitor: { ...formData.trading?.riskMonitor, autoClose: e.target.checked }
                        }
                      })}
                      className="mr-2"
                    />
                    <label htmlFor="autoClose" className="text-sm text-neutral-700 dark:text-neutral-300">
                      风险达到阈值时自动平仓
                    </label>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex gap-4 justify-center mt-6 pt-6 border-t border-neutral-300 dark:border-neutral-800">
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-primary px-8"
          >
            {saving ? "保存中..." : "保存设置"}
          </button>
          <button
            onClick={handleReset}
            className="btn-secondary px-8"
          >
            重置默认
          </button>
        </div>
      </div>
    </div>
  );
}
