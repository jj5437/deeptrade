#!/bin/bash

echo "🚀 DeepTrade Frontend 启动脚本"
echo "================================"

# 检查 Node.js 版本
if ! command -v node &> /dev/null; then
    echo "❌ 未找到 Node.js，请先安装 Node.js 18+ 版本"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js 版本过低，需要 18 或更高版本"
    exit 1
fi

echo "✓ Node.js 版本: $(node -v)"

# 检查依赖
if [ ! -d "node_modules" ]; then
    echo "📦 安装依赖包..."
    npm install
fi

# 复制环境变量文件
if [ ! -f ".env" ]; then
    echo "📄 创建环境变量文件..."
    cat > .env << 'ENV'
VITE_API_URL=http://localhost:8080/api
VITE_WS_URL=ws://localhost:8080/ws
ENV
fi

echo ""
echo "🎯 启动开发服务器..."
echo "   访问地址: http://localhost:5437"
echo "   按 Ctrl+C 停止服务"
echo ""

npm run dev
