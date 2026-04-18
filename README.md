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
- Stripe Checkout + Billing Portal

## 本地运行

```bash
cd /Users/kefei/Documents/New\ project/turo-admin-mvp
npm install
npm run db:push
npm run prisma:seed
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)

## 默认本地管理员

- Admin email: `admin@local.test`
- Admin password: `admin123`

## Stripe 订阅计费

当前版本包含一个车辆名额订阅 MVP：

- 前 5 台车辆免费
- 从第 6 台开始，每多 1 台车辆名额收费 `$1 USD / 月`
- 只有已购买名额覆盖车辆数量后，才允许导入 CSV
- 如果 CSV 预估导入后的车辆数量超过已付费名额，系统会弹窗提示补交费用

### Stripe 必填环境变量

```env
NEXT_PUBLIC_APP_URL=http://localhost:3000
STRIPE_SECRET_KEY=
STRIPE_LISTING_PRICE_ID=
STRIPE_WEBHOOK_SECRET=
BILLING_FREE_SLOT_COUPONS=
BILLING_BYPASS_ADMIN_NAME=
BILLING_BYPASS_ADMIN_EMAIL=
BILLING_BYPASS_ADMIN_PASSWORD=
```

说明：

- `STRIPE_LISTING_PRICE_ID` 应该指向你在 Stripe 后台创建的 `$1 USD / month` recurring price
- `STRIPE_WEBHOOK_SECRET` 用于校验 Stripe webhook
- `BILLING_FREE_SLOT_COUPONS` 可选，用于配置免费额度 coupon，格式示例：`WELCOME3:3,VIP10:10`
- `BILLING_BYPASS_ADMIN_*` 可选，用于自动创建一个免额度限制的调试管理员账号
- webhook 地址应指向：

```text
https://你的域名/api/stripe/webhook
```

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

如果 Volume 没有挂上，或者挂载路径不是 `/app/data`，当前版本会直接拒绝启动，避免 Railway 在容器临时磁盘里创建一个新的空数据库并让你误以为“升级把数据清空了”。

#### 4. 配置环境变量

在 Railway 服务的 Variables 里添加：

```env
DATABASE_URL=file:/app/data/tato-prod.db
SESSION_SECRET=replace-with-a-long-random-secret
ADMIN_EMAIL=admin@local.test
ADMIN_PASSWORD=admin123
NEXT_PUBLIC_APP_URL=https://your-app.up.railway.app
STRIPE_SECRET_KEY=
STRIPE_LISTING_PRICE_ID=
STRIPE_WEBHOOK_SECRET=
BILLING_FREE_SLOT_COUPONS=
BILLING_BYPASS_ADMIN_NAME=Debug Admin
BILLING_BYPASS_ADMIN_EMAIL=debug-admin@tatocar.co
BILLING_BYPASS_ADMIN_PASSWORD=replace-with-a-strong-password
```

其中最关键的是：

- `DATABASE_URL` 必须是 `file:/app/data/...`
- Railway Volume 的挂载路径必须是 `/app/data`

如果需要，可以先参考：

- `.env.railway.example`

如果你要启用 Stripe 订阅计费，还需要：

1. 在 Stripe 创建一个 `$1 USD / month` 的 recurring price
2. 把这个 price 的 ID 填到 `STRIPE_LISTING_PRICE_ID`
3. 在 Stripe 新建 webhook，监听这些事件：
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`
4. 把 webhook 地址指向：

```text
https://你的 Railway 域名/api/stripe/webhook
```

如果你要启用调试管理员免额度限制，还可以额外设置：

- `BILLING_BYPASS_ADMIN_NAME`
- `BILLING_BYPASS_ADMIN_EMAIL`
- `BILLING_BYPASS_ADMIN_PASSWORD`

容器启动时会自动创建或更新这个账号，并赋予“跳过购买额度限制”的调试权限。

#### 5. 触发部署

环境变量和 Volume 配好后，Redeploy 一次即可。

启动时容器会自动执行：

- `prisma db push`（不允许 destructive changes）
- `next start`

所以不需要你手动进容器初始化数据库。

为了保护线上数据，当前生产启动流程还会：

- 在 `/app/data/backups` 下自动备份现有 SQLite 文件
- 只做非破坏性 schema 同步
- 如果 Prisma 判断这次变更会造成数据丢失，部署会直接失败，并保留原有车辆、订单和车主数据不变

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
