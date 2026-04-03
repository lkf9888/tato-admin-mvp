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

### Railway 低成本部署

如果你想用更便宜、而且更省事的方案，当前项目更推荐直接部署到 Railway。

这套项目已经适配 Railway：

- 使用 Docker 部署
- 支持 Railway 动态 `PORT`
- 支持挂载 Volume 持久化 SQLite
- 首次上线后可直接访问 `/register` 创建后台账号

#### 1. 准备 GitHub 仓库

先把当前项目推到 GitHub。

```bash
cd /Users/kefei/Documents/New\ project/turo-admin-mvp
git init
git add .
git commit -m "Prepare Railway deployment"
git branch -M main
git remote add origin <your-github-repo-url>
git push -u origin main
```

#### 2. 在 Railway 创建项目

- 登录 Railway
- 点击 `New Project`
- 选择 `Deploy from GitHub repo`
- 选择这个项目仓库

Railway 会自动识别仓库里的 `Dockerfile` 并构建服务。

#### 3. 挂载持久化 Volume

在 Railway 里给这个服务添加一个 Volume：

- 打开服务设置
- 添加 Volume
- 挂载路径填：`/app/data`

这个路径是当前项目专门按 Railway Volume 规则配置的，SQLite 数据会持久化保存在这里。

#### 4. 配置环境变量

在 Railway 服务的 Variables 里添加：

```env
DATABASE_URL=file:/app/data/tato-prod.db
SESSION_SECRET=replace-with-a-long-random-secret
ADMIN_EMAIL=admin@local.test
ADMIN_PASSWORD=admin123
```

如果需要，可以先参考：

- `.env.railway.example`

#### 5. 触发部署

环境变量和 Volume 配好后，Redeploy 一次即可。

启动时容器会自动执行：

- `prisma db push`
- `next start`

所以不需要你手动进容器初始化数据库。

#### 6. 打开公网地址

Railway 会先给你一个 `*.up.railway.app` 的公网地址。

你可以先用这个地址测试：

- 登录页：`/login`
- 注册页：`/register`

#### 7. 绑定自定义域名

如果你有自己的域名，可以在 Railway 的域名设置里直接绑定。

#### 8. 后续更新

以后只要推送 GitHub：

```bash
git add .
git commit -m "Update app"
git push
```

Railway 就会自动重新部署。

#### 9. 数据备份

当前生产数据库是 Volume 里的 SQLite 文件：

```text
/app/data/tato-prod.db
```

建议你定期做 Volume 备份，或者后面升级到 PostgreSQL。

#### 注意

- 这套 Railway + SQLite 很适合 MVP、少量内部用户和早期验证
- 不建议开多个副本，因为 SQLite + 单 Volume 不适合多实例并发写入

### 自建服务器部署

如果你以后还是想自己控制服务器，也保留了“单台云服务器 + Docker + Caddy + 持久化 SQLite”的路线，改动最少，能稳定公开上线。

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

定期备份这个文件即可。

### 备注

- 这套方式非常适合当前 MVP 和少量内部用户
- 如果后面要多人高频同时使用，建议下一步把 SQLite 升级到 PostgreSQL
