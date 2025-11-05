import { useEffect, useState } from "react";
import { formatDate } from "@/utils/cn";
import { tradesApi } from "@/services/api";
import type { Trade } from "@/types";

export function History() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [filteredTrades, setFilteredTrades] = useState<Trade[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [filters, setFilters] = useState({
    exchange: "all",
    type: "all",
    action: "all",  // 新增：操作类型筛选
    dateFrom: "",
    dateTo: "",
  });

  useEffect(() => {
    const loadTrades = async () => {
      try {
        const data = await tradesApi.getAll();
        setTrades(data);
        setFilteredTrades(data);
      } catch (error) {
        console.error("Failed to load trades:", error);
      }
    };

    loadTrades();
  }, []);

  useEffect(() => {
    let filtered = trades;

    if (filters.exchange !== "all") {
      filtered = filtered.filter(t => t.exchange === filters.exchange);
    }

    if (filters.type !== "all") {
      filtered = filtered.filter(t => t.side === filters.type);
    }

    if (filters.action !== "all") {
      filtered = filtered.filter(t => t.action === filters.action);
    }

    if (filters.dateFrom) {
      filtered = filtered.filter(t => t.timestamp >= new Date(filters.dateFrom).getTime());
    }

    if (filters.dateTo) {
      filtered = filtered.filter(t => t.timestamp <= new Date(filters.dateTo).getTime());
    }

    setFilteredTrades(filtered);
    setCurrentPage(1); // 重置到第一页
  }, [trades, filters]);

  // 分页计算
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentItems = filteredTrades.slice(indexOfFirstItem, indexOfLastItem);
  const totalPages = Math.ceil(filteredTrades.length / itemsPerPage);

  // 页码变化处理
  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // 每页条数变化处理
  const handleItemsPerPageChange = (newItemsPerPage: number) => {
    setItemsPerPage(newItemsPerPage);
    setCurrentPage(1);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="card">
        <h2 className="text-xl font-bold mb-6 text-neutral-900 dark:text-neutral-100">交易历史</h2>

        <div className="flex flex-wrap gap-4 mb-6">
          <select
            value={filters.exchange}
            onChange={(e) => setFilters({ ...filters, exchange: e.target.value })}
            className="input-field max-w-xs"
          >
            <option value="all">所有交易所</option>
            <option value="binance">币安</option>
            <option value="okx">OKX</option>
          </select>

          <select
            value={filters.type}
            onChange={(e) => setFilters({ ...filters, type: e.target.value })}
            className="input-field max-w-xs"
          >
            <option value="all">所有方向</option>
            <option value="long">做多</option>
            <option value="short">做空</option>
            <option value="buy">买入</option>
            <option value="sell">卖出</option>
          </select>

          <select
            value={filters.action}
            onChange={(e) => setFilters({ ...filters, action: e.target.value })}
            className="input-field max-w-xs"
          >
            <option value="all">所有操作</option>
            <option value="open">开仓</option>
            <option value="close">平仓</option>
          </select>

          <input
            type="date"
            value={filters.dateFrom}
            onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
            className="input-field max-w-xs"
            placeholder="开始日期"
          />

          <input
            type="date"
            value={filters.dateTo}
            onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
            className="input-field max-w-xs"
            placeholder="结束日期"
          />

          <button
            onClick={() => setFilters({ exchange: "all", type: "all", action: "all", dateFrom: "", dateTo: "" })}
            className="btn-secondary"
          >
            重置筛选
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left text-sm text-neutral-600 dark:text-neutral-400 border-b border-neutral-300 dark:border-neutral-800">
                <th className="pb-4 whitespace-nowrap">时间</th>
                <th className="pb-4 whitespace-nowrap">交易对</th>
                <th className="pb-4 whitespace-nowrap">交易所</th>
                <th className="pb-4 whitespace-nowrap">操作</th>
                <th className="pb-4 whitespace-nowrap">数量</th>
                <th className="pb-4 whitespace-nowrap">开仓价</th>
                <th className="pb-4 whitespace-nowrap">平仓价</th>
                <th className="pb-4 whitespace-nowrap">止损价</th>
                <th className="pb-4 whitespace-nowrap">止盈价</th>
                <th className="pb-4 whitespace-nowrap">杠杆</th>
                <th className="pb-4 whitespace-nowrap">盈亏</th>
                <th className="pb-4 whitespace-nowrap">状态</th>
              </tr>
            </thead>
            <tbody>
              {currentItems.map((trade) => {
                const isBuy = trade.side === "buy";
                const isSell = trade.side === "sell";
                const isLong = trade.side === "long";
                const isShort = trade.side === "short";
                const isOpen = trade.action === "open";
                const isClose = trade.action === "close";
                const pnl = trade.pnl || 0;
                const isProfit = pnl >= 0;

                // 交易所中文映射
                const exchangeName = trade.exchange === 'binance' ? '币安' : trade.exchange === 'okx' ? 'OKX' : trade.exchange.toUpperCase();

                // 操作类型映射
                const getActionText = () => {
                  if (isOpen) {
                    if (isLong || isBuy) return '开多';
                    if (isShort || isSell) return '开空';
                  }
                  return '平仓';
                };

                const actionText = getActionText();

                // 价格格式化（去掉美元符号和多余的小数位）
                const formatPrice = (price: number | null | undefined) => {
                  if (!price) return '-';
                  return Number(price.toFixed(2)).toString();
                };

                // 开仓价和平仓价显示逻辑
                const getEntryPrice = () => {
                  if (trade.action === 'open' && trade.price) {
                    return formatPrice(trade.price);
                  }
                  if (trade.action === 'close' && trade.entryPrice) {
                    return formatPrice(trade.entryPrice);
                  }
                  return '-';
                };

                const getClosePrice = () => {
                  if (trade.action === 'close' && trade.price) {
                    return formatPrice(trade.price);
                  }
                  return '-';
                };

                return (
                  <tr key={trade.id} className="border-b border-neutral-300 dark:border-neutral-800/50 hover:bg-neutral-800/30 transition-colors">
                    <td className="py-4 text-sm text-neutral-900 dark:text-neutral-100 whitespace-nowrap">{formatDate(trade.timestamp)}</td>
                    <td className="py-4 font-semibold text-neutral-900 dark:text-neutral-100 whitespace-nowrap">{trade.symbol}</td>
                    <td className="py-4 whitespace-nowrap">
                      <span className="text-xs px-2 py-1 bg-primary-500/10 text-primary-500 rounded">
                        {exchangeName}
                      </span>
                    </td>
                    <td className="py-4 text-neutral-900 dark:text-neutral-100 whitespace-nowrap">
                    <span className={`text-xs px-2 py-1 rounded
                     ${isOpen ? "bg-info-500/10 text-info-500 dark:text-info-400" : "bg-warning-500/10 text-warning-500 dark:text-warning-400"}`}>
                        {actionText}
                      </span>
                    </td>
                    <td className="py-4 font-mono text-neutral-900 dark:text-neutral-100 whitespace-nowrap">{trade.size?.toFixed(4) || '-'}</td>
                    <td className="py-4 font-mono text-neutral-900 dark:text-neutral-100 whitespace-nowrap">
                      {getEntryPrice()}
                    </td>
                    <td className="py-4 font-mono text-neutral-900 dark:text-neutral-100 whitespace-nowrap">
                      {getClosePrice()}
                    </td>
                    <td className="py-4 font-mono text-neutral-600 dark:text-neutral-400 whitespace-nowrap">
                      {formatPrice(trade.stopLoss)}
                    </td>
                    <td className="py-4 font-mono text-neutral-600 dark:text-neutral-400 whitespace-nowrap">
                      {formatPrice(trade.takeProfit)}
                    </td>
                    <td className="py-4 font-mono text-neutral-600 dark:text-neutral-400 whitespace-nowrap">
                      {trade.leverage ? `${trade.leverage}x` : '-'}
                    </td>
                    <td className="py-4 font-mono text-neutral-900 dark:text-neutral-100 whitespace-nowrap">
                      {trade.action === "close" ? (
                        <span className={`font-semibold ${isProfit ? "text-success-500" : "text-error-500"}`}>
                          {isProfit ? '+' : ''}{Number(pnl.toFixed(2))}
                        </span>
                      ) : (
                        <span className="text-neutral-600 dark:text-neutral-400">-</span>
                      )}
                    </td>
                    <td className="py-4 whitespace-nowrap">
                      <span className={`text-xs px-2 py-1 rounded
                        ${trade.status === "completed" ? "bg-success-500/10 text-success-500" :
                         trade.status === "pending" ? "bg-warning-500/10 text-warning-500" :
                         "bg-error-500/10 text-error-500"}`}>
                        {trade.status === "completed" ? "已完成" : trade.status === "pending" ? "进行中" : "失败"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {currentItems.length === 0 && filteredTrades.length === 0 && (
            <div className="text-center py-12 text-neutral-600 dark:text-neutral-400">
              暂无交易记录
            </div>
          )}

          {currentItems.length === 0 && filteredTrades.length > 0 && (
            <div className="text-center py-12 text-neutral-600 dark:text-neutral-400">
              当前页暂无数据
            </div>
          )}

          {/* 分页控件 */}
          {filteredTrades.length > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-6 pt-6 border-t border-neutral-300 dark:border-neutral-800">
              <div className="flex items-center gap-4 text-sm text-neutral-600 dark:text-neutral-400">
                <span>
                  显示 {indexOfFirstItem + 1} - {Math.min(indexOfLastItem, filteredTrades.length)} 条，
                  共 {filteredTrades.length} 条记录
                </span>
                <select
                  value={itemsPerPage}
                  onChange={(e) => handleItemsPerPageChange(Number(e.target.value))}
                  className="input-field w-20"
                >
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </select>
                <span>条/页</span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  className={`btn-secondary px-3 py-1.5 text-sm ${
                    currentPage === 1 ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                >
                  上一页
                </button>

                <div className="flex items-center gap-1">
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum;
                    if (totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (currentPage <= 3) {
                      pageNum = i + 1;
                    } else if (currentPage >= totalPages - 2) {
                      pageNum = totalPages - 4 + i;
                    } else {
                      pageNum = currentPage - 2 + i;
                    }

                    return (
                      <button
                        key={pageNum}
                        onClick={() => handlePageChange(pageNum)}
                        className={`px-3 py-1.5 text-sm rounded transition-colors ${
                          currentPage === pageNum
                            ? 'bg-primary-500 text-white'
                            : 'hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-300'
                        }`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>

                <button
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className={`btn-secondary px-3 py-1.5 text-sm ${
                    currentPage === totalPages ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                >
                  下一页
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
