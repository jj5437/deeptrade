# SSL证书配置说明

## 启用HTTPS

要启用HTTPS，您需要将SSL证书文件放置在此目录中。

### 方式一：使用Let's Encrypt（推荐）

1. 安装certbot：
```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install certbot

# CentOS/RHEL
sudo yum install certbot
```

2. 获取证书：
```bash
sudo certbot certonly --standalone -d your-domain.com -d www.your-domain.com
```

3. 复制证书到项目目录：
```bash
sudo cp /etc/letsencrypt/live/your-domain.com/fullchain.pem ./nginx/ssl/cert.pem
sudo cp /etc/letsencrypt/live/your-domain.com/privkey.pem ./nginx/ssl/key.pem
sudo chown $USER:$USER ./nginx/ssl/*.pem
```

4. 取消注释docker-compose.yml中的HTTPS配置部分，并更新域名：
```bash
# 编辑nginx/nginx.conf，将your-domain.com替换为您的实际域名
```

5. 重启服务：
```bash
docker-compose down
docker-compose up -d
```

### 方式二：使用自己的证书

如果您有自己的SSL证书，请将以下文件放置在此目录：

- `cert.pem` - 证书文件
- `key.pem` - 私钥文件

然后：
1. 更新nginx/nginx.conf中的server_name为您的域名
2. 取消注释HTTPS server块
3. 重启服务

### 方式三：使用自签名证书（仅用于测试）

生成自签名证书：
```bash
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout nginx/ssl/key.pem \
  -out nginx/ssl/cert.pem
```

**注意**：自签名证书会在浏览器中显示安全警告，仅适用于测试环境。

## 自动续期（Let's Encrypt）

添加crontab任务自动续期证书：
```bash
crontab -e
```

添加以下行：
```
0 12 * * * /usr/bin/certbot renew --quiet
```

## 验证SSL配置

检查证书信息：
```bash
openssl x509 -in nginx/ssl/cert.pem -text -noout
```

测试HTTPS连接：
```bash
curl -v https://your-domain.com
```
