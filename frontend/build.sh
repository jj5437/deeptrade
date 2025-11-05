#!/bin/bash

set -e

echo "🏗️  Building DeepTrade Frontend for Production"
echo "============================================="

# 检查环境
if [ ! -f ".env" ]; then
    echo "⚠️  .env file not found, creating from .env.example..."
    cp .env.example .env
fi

# 清理旧的构建
echo "🧹 Cleaning old build..."
rm -rf dist

# 安装依赖（生产环境）
echo "📦 Installing dependencies..."
npm ci --only=production

# 类型检查
echo "🔍 Running type check..."
npm run type-check

# 代码检查
echo "🔍 Running lint check..."
npm run lint

# 构建
echo "🚀 Building for production..."
npm run build

# 分析包大小
echo "📊 Bundle analysis:"
if [ -f "package.json" ]; then
    echo "Build completed successfully!"
fi

# 复制环境变量到构建目录
if [ -f ".env" ]; then
    cp .env dist/.env 2>/dev/null || true
fi

echo ""
echo "✅ Build completed!"
echo "📁 Output directory: ./dist"
echo "🌐 Preview: npm run preview"
echo ""

# 创建压缩包
if command -v tar &> /dev/null; then
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    tar -czf "deeptrade-frontend-${TIMESTAMP}.tar.gz" dist/
    echo "📦 Package created: deeptrade-frontend-${TIMESTAMP}.tar.gz"
fi

echo ""
echo "🚀 To deploy:"
echo "   1. Upload ./dist to your web server"
echo "   2. Configure your web server (Nginx/Apache)"
echo "   3. Set up SSL certificate"
echo ""
echo "📖 For more information, see README.md"
