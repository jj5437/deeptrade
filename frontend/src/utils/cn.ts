import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number, useAbbreviation: boolean = false): string {
  // 根据数值大小动态调整小数位数
  let minFractionDigits = 2;
  let maxFractionDigits = 4;

  if (value >= 100000) {
    // 大于10万：0位小数
    minFractionDigits = 0;
    maxFractionDigits = 0;
  } else if (value >= 1000) {
    // 1千到10万：2位小数
    minFractionDigits = 2;
    maxFractionDigits = 2;
  } else if (value >= 1) {
    // 1到1千：4位小数
    minFractionDigits = 2;
    maxFractionDigits = 4;
  }
  // 小于1的保持更多小数位
  else if (value >= 0.1) {
    minFractionDigits = 3;
    maxFractionDigits = 4;
  } else if (value >= 0.01) {
    minFractionDigits = 4;
    maxFractionDigits = 5;
  }

  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: minFractionDigits,
    maximumFractionDigits: maxFractionDigits,
  }).format(value);
}

export function formatNumber(value: number, decimals: number = 2): string {
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatPercent(value: number): string {
  return new Intl.NumberFormat('zh-CN', {
    style: 'percent',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100);
}

export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN');
}

export function formatTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (days > 0) return `${days}天前`;
  if (hours > 0) return `${hours}小时前`;
  if (minutes > 0) return `${minutes}分钟前`;
  return '刚刚';
}

export function formatVolume(value: number): string {
  const absValue = Math.abs(value);
  let formattedValue: string;
  let suffix = '';

  if (absValue >= 1000000000) {
    formattedValue = (value / 1000000000).toFixed(2);
    suffix = 'B';
  } else if (absValue >= 1000000) {
    formattedValue = (value / 1000000).toFixed(2);
    suffix = 'M';
  } else if (absValue >= 1000) {
    formattedValue = (value / 1000).toFixed(2);
    suffix = 'K';
  } else {
    formattedValue = value.toFixed(0);
  }

  // 移除末尾的零
  if (formattedValue.endsWith('.00')) {
    formattedValue = formattedValue.slice(0, -3);
  } else if (formattedValue.endsWith('0')) {
    formattedValue = formattedValue.slice(0, -1);
  }

  return `${formattedValue}${suffix}`;
}
