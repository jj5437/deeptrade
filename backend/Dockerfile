# 使用官方Node.js运行时作为父镜像
FROM node:18-alpine

# 设置工作目录
WORKDIR /usr/src/app

# 复制package.json和package-lock.json（如果存在）
COPY package*.json ./

# 安装依赖
RUN npm ci --only=production

# 复制应用代码
COPY src/ ./src/
COPY data/ ./data/
COPY logs/ ./logs/

# 创建非root用户
RUN addgroup -g 1001 -S nodejs && \
    adduser -S deeptrade -u 1001

# 更改所有者
RUN chown -R deeptrade:nodejs /usr/src/app
USER deeptrade

# 暴露端口
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# 启动应用
CMD ["node", "src/index.js"]
