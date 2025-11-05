// 加密货币图标组件
import React from 'react';

interface CryptoIconProps {
  className?: string;
}

export const BitcoinIcon: React.FC<CryptoIconProps> = ({ className = '' }) => (
  <svg viewBox="0 0 256 256" className={className} xmlns="http://www.w3.org/2000/svg">
    <path fill="currentColor" d="M128 16c-61.6 0-112 50.4-112 112s50.4 112 112 112 112-50.4 112-112S189.6 16 128 16zm0 192c-44.2 0-80-35.8-80-80s35.8-80 80-80 80 35.8 80 80-35.8 80-80 80z"/>
    <path fill="currentColor" d="M94 96c0-18.8 15.2-34 34-34h12v20h-8c-8.8 0-16 7.2-16 16v48h-22V96zm22 22v48h20v-48h-20z"/>
  </svg>
);

export const EthereumIcon: React.FC<CryptoIconProps> = ({ className = '' }) => (
  <svg viewBox="0 0 256 256" className={className} xmlns="http://www.w3.org/2000/svg">
    <path fill="currentColor" d="M128 24l80 32-80 128L48 56l80-32z"/>
  </svg>
);

export const UsdtIcon: React.FC<CryptoIconProps> = ({ className = '' }) => (
  <svg viewBox="0 0 256 256" className={className} xmlns="http://www.w3.org/2000/svg">
    <path fill="currentColor" d="M128 16L40 80v96l88 64 88-64V80L128 16zm0 32l72 48v64l-72 48-72-48v-64l72-48z"/>
  </svg>
);

export const ShieldIcon: React.FC<CryptoIconProps> = ({ className = '' }) => (
  <svg viewBox="0 0 256 256" className={className} xmlns="http://www.w3.org/2000/svg">
    <path fill="currentColor" d="M128 24C74.6 24 32 66.6 32 120c0 47.2 34.2 87.1 80 97.8V232l64-32 64 32v-14.2c45.8-10.7 80-50.6 80-97.8 0-53.4-42.6-96-96-96z"/>
  </svg>
);
