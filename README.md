# Turo Fleet Calendar MVP

本地可运行的 Turo 租车后台管理系统 MVP，覆盖：

- 管理后台登录
- Dashboard
- 车辆管理
- 车主管理
- 订单管理
- 线下订单创建与编辑
- Turo CSV 导入
- 冲突检测
- 车主只读共享页

## 技术栈

- Next.js 15
- TypeScript
- Tailwind CSS 4
- Prisma
- SQLite
- FullCalendar

## 本地运行

```bash
cd /Users/kefei/Documents/New\ project/turo-admin-mvp
npm install
npm run db:push
npm run prisma:seed
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)

## 默认账号

- Admin email: `admin@local.test`
- Admin password: `admin123`

## 共享页示例

- URL: `/share/demo-daniel-owner`
- Password: `owner123`

## CSV 示例文件

项目内已提供：

- `/Users/kefei/Documents/New project/turo-admin-mvp/sample-data/turo-sample.csv`

默认映射支持以下典型字段：

- `Reservation ID`
- `Car`
- `Guest Name`
- `Phone`
- `Trip Start`
- `Trip End`
- `Earnings`
- `Status`

如果你后面提供真实 Turo CSV 样本，可以继续把导入映射和车辆匹配规则收紧。

## 公网部署

当前项目最适合先走“单台云服务器 + Docker + Caddy + 持久化 SQLite”这条路线，改动最少，能最快公开上线。

### 1. 准备服务器和域名

- 准备一台 Ubuntu 22.04 / 24.04 的云服务器
- 给它绑定一个域名，例如 `tato.yourdomain.com`
- 在域名 DNS 里把 `A` 记录指向服务器公网 IP

### 2. 服务器安装 Docker

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-plugin
sudo systemctl enable --now docker
```

### 3. 上传项目

```bash
git clone <your-repo-url> tato-admin-mvp
cd tato-admin-mvp
```

### 4. 配置生产环境变量

```bash
cp .env.production.example .env.production
```

编辑 `.env.production`，至少修改：

- `DOMAIN`
- `SESSION_SECRET`
- `DATABASE_URL`

推荐示例：

```env
DOMAIN=tato.yourdomain.com
DATABASE_URL=file:/app/data/tato-prod.db
SESSION_SECRET=replace-with-a-long-random-secret
ADMIN_EMAIL=admin@local.test
ADMIN_PASSWORD=admin123
```

### 5. 启动公网服务

```bash
docker compose -f docker-compose.public.yml up -d --build
```

启动后：

- Next.js 应用运行在 Docker 容器内
- SQLite 数据库持久化到服务器上的 `./data`
- Caddy 自动申请 HTTPS 证书并对外提供访问

### 6. 打开网站

浏览器访问：

```text
https://你的域名
```

首次登录后，你也可以直接在注册页创建新的后台账号。

### 7. 更新版本

以后更新代码时：

```bash
git pull
docker compose -f docker-compose.public.yml up -d --build
```

### 8. 备份数据库

数据库文件默认在：

```text
./data/tato-prod.db
```

订单上传的照片、视频和合约文件默认保存在：

```text
./data/uploads
```

定期备份 `./data` 整个目录即可。

### 备注

- 这套方式非常适合当前 MVP 和少量内部用户
- 如果后面要多人高频同时使用，建议下一步把 SQLite 升级到 PostgreSQL
