#!/bin/bash

# DeepTrade Backend 安装脚本

set -e

echo "==========================================="
echo "  DeepTrade Backend 安装脚本"
echo "==========================================="
echo ""

# 检查操作系统
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    OS="linux"
    echo "检测到 Linux 操作系统"
elif [[ "$OSTYPE" == "darwin"* ]]; then
    OS="macos"
    echo "检测到 macOS 操作系统"
else
    echo "不支持的操作系统: $OSTYPE"
    exit 1
fi

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "错误: 未检测到 Node.js"
    echo ""
    echo "请安装 Node.js 18+:"
    echo "  - 下载: https://nodejs.org/"
    echo "  - 或使用 nvm: https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2)
MAJOR_VERSION=$(echo $NODE_VERSION | cut -d'.' -f1)

if [ "$MAJOR_VERSION" -lt 18 ]; then
    echo "错误: Node.js 版本过低 ($NODE_VERSION)，需要 18+"
    exit 1
fi

echo "✓ Node.js 版本: $NODE_VERSION"

# 检查 npm
NPM_VERSION=$(npm -v)
echo "✓ npm 版本: $NPM_VERSION"

# 安装依赖
echo ""
echo "安装项目依赖..."
npm install

echo "✓ 依赖安装完成"

# 创建环境变量文件
if [ ! -f .env ]; then
    echo ""
    echo "创建环境变量文件..."
    cp .env.example .env
    echo "✓ 已创建 .env 文件"
    echo ""
    echo "重要: 请编辑 .env 文件并配置以下内容:"
    echo "  - AI API 密钥 (推荐使用中转 API)"
    echo "  - 交易所 API 密钥"
    echo "  - AUTO_TRADE=false (测试时)"
else
    echo "✓ 环境变量文件已存在"
fi

# 创建必要目录
echo ""
echo "创建必要目录..."
mkdir -p data logs
echo "✓ 目录创建完成"

# 权限设置
if [[ "$OS" == "linux" ]]; then
    chmod 755 data logs
    echo "✓ 权限设置完成"
fi

# 运行测试
echo ""
echo "运行基础测试..."
npm run lint --if-present || echo "⚠ ESLint 检查跳过"

echo ""
echo "==========================================="
echo "  安装完成！"
echo "==========================================="
echo ""
echo "下一步操作:"
echo "1. 编辑 .env 文件配置 API 密钥"
echo "2. 运行: ./start.sh"
echo "3. 或直接运行: npm start"
echo ""
echo "详细文档请查看 README.md"
echo ""
