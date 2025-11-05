#!/bin/bash

# DeepTrade Backend 启动脚本

set -e

echo "==========================================="
echo "  DeepTrade Backend 启动脚本"
echo "==========================================="

# 检查 Node.js 版本
NODE_VERSION=$(node --version 2>/dev/null || echo "未安装")
echo "Node.js 版本: $NODE_VERSION"

if [ -z "$NODE_VERSION" ]; then
    echo "错误: 未检测到 Node.js，请先安装 Node.js 18+"
    exit 1
fi

# 检查 npm
NPM_VERSION=$(npm --version 2>/dev/null || echo "未安装")
echo "npm 版本: $NPM_VERSION"

# 检查环境变量文件
if [ ! -f .env ]; then
    echo "警告: 未找到 .env 文件，将使用默认配置"
    if [ -f .env.example ]; then
        echo "请复制 .env.example 为 .env 并进行配置"
    fi
    echo ""
fi

# 检查依赖
if [ ! -d "node_modules" ]; then
    echo "正在安装依赖..."
    npm install
fi

# 创建必要目录
mkdir -p data logs

# 设置权限
chmod 755 data logs

# 启动模式选择
echo ""
echo "请选择启动模式:"
echo "1) 开发模式 (使用 nodemon)"
echo "2) 生产模式"
echo "3) 仅启动 API 服务器"
echo "4) 启动交易引擎"
echo ""
read -p "请输入选择 (1-4): " choice

case $choice in
    1)
        echo "启动开发模式..."
        npm run dev
        ;;
    2)
        echo "启动生产模式..."
        NODE_ENV=production node src/index.js
        ;;
    3)
        echo "启动 API 服务器..."
        node src/server.js
        ;;
    4)
        echo "启动交易引擎..."
        node src/services/TradingEngine.js
        ;;
    *)
        echo "无效选择，启动生产模式..."
        NODE_ENV=production node src/index.js
        ;;
esac
