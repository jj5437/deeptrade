#!/bin/bash

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 打印带颜色的消息
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 显示横幅
show_banner() {
    echo -e "${BLUE}"
    cat << 'EOF'
╔════════════════════════════════════════════════════════════╗
║              DeepTrade Docker 一键部署脚本                  ║
║                                                            ║
║     AI-Powered Cryptocurrency Trading System              ║
╚════════════════════════════════════════════════════════════╝
EOF
    echo -e "${NC}"
}

# 检查Docker是否安装
check_docker() {
    print_info "检查Docker环境..."
    if ! command -v docker &> /dev/null; then
        print_error "Docker未安装！请先安装Docker："
        echo "  Ubuntu/Debian: sudo apt-get install docker.io"
        echo "  CentOS/RHEL: sudo yum install docker"
        echo "  MacOS: brew install docker"
        exit 1
    fi

    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        print_error "Docker Compose未安装！请先安装Docker Compose："
        echo "  https://docs.docker.com/compose/install/"
        exit 1
    fi

    print_success "Docker环境检查通过"
}

# 创建必要目录
create_directories() {
    print_info "创建必要目录..."
    mkdir -p backend/data
    mkdir -p backend/logs
    mkdir -p nginx/ssl
    mkdir -p logs
    print_success "目录创建完成"
}

# 检查环境变量文件
check_env_files() {
    print_info "检查环境变量文件..."

    # 检查根目录.env
    if [ ! -f .env ]; then
        print_warning "未找到根目录 .env 文件，正在从 .env.example 复制..."
        if [ -f .env.example ]; then
            cp .env.example .env
            print_success "已复制 .env.example 为 .env，请根据需要修改配置"
        else
            print_error "未找到 .env.example 文件！"
            exit 1
        fi
    else
        print_success "根目录 .env 文件已存在"
    fi

    # 检查后端.env
    if [ ! -f backend/.env ]; then
        print_warning "未找到 backend/.env 文件"
        if [ -f backend/.env.example ]; then
            print_info "请复制 backend/.env.example 为 backend/.env 并配置API密钥"
        fi
    else
        print_success "backend/.env 文件已存在"
    fi

    # 检查前端.env
    if [ ! -f frontend/.env ]; then
        print_warning "未找到 frontend/.env 文件"
        if [ -f frontend/.env.example ]; then
            print_info "请复制 frontend/.env.example 为 frontend/.env"
        fi
    else
        print_success "frontend/.env 文件已存在"
    fi
}

# 构建镜像
build_images() {
    print_info "构建Docker镜像..."
    docker-compose build --no-cache
    print_success "镜像构建完成"
}

# 启动服务
start_services() {
    print_info "启动DeepTrade服务..."
    docker-compose up -d
    print_success "服务启动完成"
}

# 等待服务就绪
wait_for_services() {
    print_info "等待服务就绪..."

    # 等待后端健康检查
    print_info "检查后端服务..."
    for i in {1..30}; do
        if curl -s http://localhost:8080/health > /dev/null 2>&1; then
            print_success "后端服务就绪"
            break
        fi
        if [ $i -eq 30 ]; then
            print_error "后端服务启动超时"
            docker-compose logs backend
            exit 1
        fi
        echo -n "."
        sleep 2
    done

    # 等待Nginx健康检查
    print_info "检查Nginx服务..."
    for i in {1..30}; do
        if curl -s http://localhost/health > /dev/null 2>&1; then
            print_success "Nginx服务就绪"
            break
        fi
        if [ $i -eq 30 ]; then
            print_warning "Nginx服务可能未完全就绪，但将继续执行"
            break
        fi
        echo -n "."
        sleep 2
    done
}

# 显示访问信息
show_access_info() {
    echo ""
    print_success "================================"
    print_success "  DeepTrade 部署完成！"
    print_success "================================"
    echo ""
    echo -e "${GREEN}访问地址：${NC}"
    echo "  🌐 前端地址: http://localhost:${NGINX_HTTP_PORT:-80}"
    echo "  🔗 API地址: http://localhost:${NGINX_HTTP_PORT:-80}/api"
    echo "  📊 WebSocket: ws://localhost:${NGINX_HTTP_PORT:-80}/ws"
    echo ""
    echo -e "${GREEN}管理命令：${NC}"
    echo "  查看日志:     ./deploy.sh logs"
    echo "  停止服务:     ./deploy.sh stop"
    echo "  重启服务:     ./deploy.sh restart"
    echo "  重新部署:     ./deploy.sh redeploy"
    echo "  查看状态:     ./deploy.sh status"
    echo ""
    echo -e "${YELLOW}注意事项：${NC}"
    echo "  1. 确保已正确配置 backend/.env 中的API密钥"
    echo "  2. 生产环境请配置HTTPS（参考 nginx/ssl/README.md）"
    echo "  3. 首次使用请设置 AUTO_TRADE=false 进行测试"
    echo ""
}

# 查看日志
show_logs() {
    docker-compose logs -f
}

# 停止服务
stop_services() {
    print_info "停止DeepTrade服务..."
    docker-compose down
    print_success "服务已停止"
}

# 重启服务
restart_services() {
    print_info "重启DeepTrade服务..."
    docker-compose restart
    print_success "服务已重启"
}

# 重新部署
redeploy() {
    print_info "重新部署DeepTrade..."
    docker-compose down
    docker-compose build --no-cache
    docker-compose up -d
    wait_for_services
    show_access_info
}

# 查看状态
show_status() {
    print_info "服务状态："
    docker-compose ps
    echo ""
    print_info "资源使用："
    docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}"
}

# 清理数据
clean_data() {
    print_warning "这将删除所有数据（数据库、日志等），确定要继续吗？ (y/N)"
    read -r response
    if [[ "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
        print_info "清理数据..."
        docker-compose down -v
        docker system prune -af
        print_success "数据清理完成"
    else
        print_info "取消清理"
    fi
}

# 显示帮助
show_help() {
    cat << EOF
DeepTrade Docker 部署脚本

用法: ./deploy.sh [命令]

命令:
  deploy      部署服务（默认）
  logs        查看实时日志
  stop        停止服务
  restart     重启服务
  status      查看服务状态
  redeploy    重新部署
  clean       清理所有数据
  help        显示帮助信息

示例:
  ./deploy.sh              # 部署服务
  ./deploy.sh logs         # 查看日志
  ./deploy.sh stop         # 停止服务
  ./deploy.sh status       # 查看状态

EOF
}

# 主函数
main() {
    show_banner

    case "${1:-deploy}" in
        "deploy")
            check_docker
            create_directories
            check_env_files
            build_images
            start_services
            wait_for_services
            show_access_info
            ;;
        "logs")
            show_logs
            ;;
        "stop")
            stop_services
            ;;
        "restart")
            restart_services
            ;;
        "redeploy")
            redeploy
            ;;
        "status")
            show_status
            ;;
        "clean")
            clean_data
            ;;
        "help"|"-h"|"--help")
            show_help
            ;;
        *)
            print_error "未知命令: $1"
            show_help
            exit 1
            ;;
    esac
}

# 执行主函数
main "$@"
