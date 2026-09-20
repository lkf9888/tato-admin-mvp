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
ALLOW_DESTRUCTIVE_SEED=true npm run prisma:seed
npm run dev
```

`prisma:seed` 会清空本地演示数据后重建默认管理员，所以现在必须显式加
`ALLOW_DESTRUCTIVE_SEED=true`。线上环境不能运行这个 seed。
同理，`npm run db:reset` 也必须显式加 `ALLOW_DESTRUCTIVE_RESET=true`，避免误删真实数据。

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

## Turo CSV 自动同步

当前版本支持把一个固定 CSV 来源自动导入 TATO。推荐先在后台“CSV 导入”页面的“Turo 自动同步”模块里粘贴可直接下载的 CSV URL 并保存；日历顶部的“同步 Turo”按钮和自动同步脚本都会优先使用这个工作区配置。

如果需要用环境变量兜底，也可以配置一个来源：

```env
TURO_SYNC_CSV_URL=
TURO_SYNC_CSV_YEAR=
TURO_SYNC_CSV_PATH=
TURO_SYNC_WORKSPACE_SLUG=default
TURO_SYNC_CREATE_MISSING_VEHICLES=true
TURO_SYNC_ARCHIVE_MISSING=false
TURO_SYNC_SECRET=
```

说明：

- 页面里保存了 CSV URL 后，会覆盖环境变量里的 `TURO_SYNC_CSV_URL` / `TURO_SYNC_CSV_PATH` 来源，避免 Railway 旧变量和新链接冲突
- 环境变量 `TURO_SYNC_CSV_URL` 和 `TURO_SYNC_CSV_PATH` 二选一；URL 适合私有/签名 CSV 地址，PATH 适合持久卷里的文件
- Turo Earnings 页面的下载按钮当前会请求 `https://turo.com/api/earnings/download?year=2026` 这类地址；页面里可以保存下载年份，URL 写成 `https://turo.com/api/earnings/download?year={year}` 时会自动替换年份
- Turo 的下载接口需要登录态；普通 Railway 后端直接访问通常会返回 `403`。要做全自动同步，需要提供 Turo 允许的有效授权 Header，或改用手动下载 CSV 后上传
- 最省事的配置方式：在 Chrome 打开 Turo Earnings 页，打开 DevTools 的 Network，点击 `Download CSV`，找到 `/api/earnings/download?year=...` 请求，右键 `Copy as cURL`，粘贴到 TATO 的 `粘贴 Turo Download CSV cURL` 输入框保存。TATO 会解析 URL、年份和必要 Header，保存后不会回显 Cookie 或 Authorization
- 如果 URL 需要鉴权，可在页面里填写 Authorization Header 或额外 Headers JSON；环境变量兜底为 `TURO_SYNC_CSV_AUTH_HEADER` / `TURO_SYNC_CSV_HEADERS`
- 如真实 Turo CSV 表头和默认识别不同，可在页面里填写字段映射 JSON，或用 `TURO_SYNC_CSV_MAPPING` 兜底；支持 `{"Reservation ID":"externalOrderId"}` 或 `{"externalOrderId":"Reservation ID"}`
- `TURO_SYNC_ARCHIVE_MISSING` 默认保持 `false`，避免部分导出的 CSV 把历史 Turo 订单误归档；只有当 CSV 是完整订单来源时再改成 `true`

本地或 Railway Cron 可以运行：

```bash
npm run sync:turo-csv
```

后台日历顶部也有“同步 Turo”按钮，会调用同一套同步逻辑。没有登录态的外部 cron 也可以通过：

```bash
curl -X POST https://你的域名/api/turo-sync \
  -H "Authorization: Bearer $TURO_SYNC_SECRET"
```

Railway Cron 建议单独创建一个 cron 服务，Start Command 使用 `npm run sync:turo-csv`，例如每天温哥华时间凌晨同步时，按 UTC 配置对应 crontab。

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

从 `v0.22.0` 开始，订单照片、视频和合约文件也会默认保存到同一个持久卷里的 `/app/data/uploads`。如果你以后要把附件放到其他挂载目录，可以额外设置 `TATO_UPLOAD_DIR`，但必须指向 `/app/data` 下面的持久化目录，不能指向容器临时目录。生产环境如果发现上传目录不在 `/app/data` 下，会直接拒绝启动，避免附件在重启或发布后丢失。

如果 Volume 没有挂上，或者挂载路径不是 `/app/data`，当前版本会直接拒绝启动，避免 Railway 在容器临时磁盘里创建一个新的空数据库并让你误以为“升级把数据清空了”。

车辆资料按“软删除”处理：后台的停用车辆操作只会把车辆状态改为 `inactive` 并关闭在线预定，不会物理删除车辆记录、历史订单或车辆附件关联。

#### 4. 配置环境变量

在 Railway 服务的 Variables 里添加：

```env
DATABASE_URL=file:/app/data/tato-prod.db
SESSION_SECRET=replace-with-a-long-random-secret
ADMIN_EMAIL=admin@local.test
ADMIN_PASSWORD=admin123
NEXT_PUBLIC_APP_URL=https://your-app.up.railway.app
RESEND_API_KEY=re_xxx
RESEND_FROM="TATO <no-reply@tatocar.co>"
STAFF_TASK_EMAIL_FROM="TATO Tasks <tasks@tatocar.co>"
TATO_UPLOAD_DIR=
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

#### 4.1 配置 TATO 域名员工任务邮件

员工任务邮件通过 Resend HTTPS API 发送，不依赖 SMTP 端口。创建任务或把任务分配给已有邮箱的员工时，系统会自动发送任务提醒。

推荐配置：

```env
RESEND_API_KEY=re_xxx
RESEND_FROM="TATO <no-reply@tatocar.co>"
STAFF_TASK_EMAIL_FROM="TATO Tasks <tasks@tatocar.co>"
NEXT_PUBLIC_APP_URL=https://tatocar.co
```

设置步骤：

1. 在 Resend 添加并验证 `tatocar.co`。Resend 会给出 SPF 和 DKIM DNS 记录，按它给出的值添加到域名 DNS。
2. DNS 验证通过后，在 Resend 创建 API key。
3. 在 Railway 服务的 Variables 里添加上面的 `RESEND_API_KEY`、`RESEND_FROM`、`STAFF_TASK_EMAIL_FROM` 和正式站点地址 `NEXT_PUBLIC_APP_URL`。
4. Railway Variables 修改后要部署一次，让运行中的服务拿到新环境变量。

`STAFF_TASK_EMAIL_FROM` 只影响线下员工排班任务通知；如果不设置，任务通知会使用 `RESEND_FROM`。

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
RESEND_API_KEY=re_xxx
RESEND_FROM="TATO <no-reply@tatocar.co>"
STAFF_TASK_EMAIL_FROM="TATO Tasks <tasks@tatocar.co>"
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

## 微信小程序员工任务端

本仓库包含一个可用微信开发者工具打开的小程序项目：`wechat-miniprogram/`。

> 从零上线的分阶段清单（注册主体、域名、模板、环境变量、初始化、发布、交接，
> 外加 errcode 对照表）见
> [`docs/wechat-mini-program-launch.md`](docs/wechat-mini-program-launch.md)。

上线前需要在 Railway Variables 配置：

```env
WECHAT_MINIPROGRAM_APP_ID=wx_xxx
WECHAT_MINIPROGRAM_APP_SECRET=xxx
WECHAT_TASK_TEMPLATE_ID=xxx
```

`WECHAT_MINIPROGRAM_STATE` 曾经在这里，现在没有代码读它了：`miniprogram_state`
是 `NotifyMiniProgram` 的一列，用
`npm run notify-hub -- mini-program:set --app-id wx... --state trial` 改。

微信公众平台里还需要设置：

- 在「开发管理」把 `https://tatocar.co` 加到 request、uploadFile 和 downloadFile 合法域名。
- 在「订阅消息」添加一个任务通知模板，默认字段建议为：`thing1=任务名称`、`time2=到期时间`、`thing3=车辆信息`、`phrase4=任务状态`、`thing5=备注`。
- 字段映射已经搬到中枢的 `NotifyTemplate.fieldMap`，用
  `npm run notify-hub -- template:set --fields '{...}'` 设置。
  老的 `WECHAT_TASK_MESSAGE_FIELDS` 现在没有代码在读，配了也不生效。
- `WECHAT_TASK_TEMPLATE_ID` 还在用：老小程序靠它知道该申请哪个模板的授权。
  等小程序换成中枢版本（模板 ID 由 `/v1/mp/session` 下发）之后就可以删了。

员工使用流程：

1. Admin 在线下员工排班里复制员工的「小程序 Code」。
2. 员工第一次打开小程序输入 Code，系统会把该 Code 绑定到当前微信 openid。
3. 员工在小程序里点击「开启新任务微信提醒」后，后续 admin 分配或修改任务时会尝试发送微信订阅消息。

注意：微信的一次性订阅是**一次授权换一条消息**。员工点一次只够收一条，
之后的发送会拿到 43101。现在服务端遇到 43101 会把该员工的
`wechatNotificationEnabled` 关掉，排班页也就不再显示「已开启」——在小程序端
改成反复补授权之前，这是让「收不到」变成看得见的最低保证。

## 通知中枢（Notify hub）

TATO 不是唯一要往微信发提醒的系统，HostHub 和洗车棚也要，而它们各自部署、
各有数据库，洗车棚那台机器甚至没有公网地址。中枢把「怎么跟微信说话」收在一处：
凭证、订阅者绑定、订阅额度都归它管，调用方只发一个 HTTP 请求。

结构是三层：

```
小程序 (NotifyMiniProgram)   ← 一个 appid 一行，凭证和模板挂在这里
└── 应用 (NotifyApp)          ← API key 的持有者：tato / hosthub / washbay
    └── 频道 (NotifyChannel)  ← 路由单位，可以是一个人也可以是一个组
        └── 订阅 (NotifySubscription) ← 一个频道多个微信用户，一个用户多个频道
```

`NotifyApp.miniProgramId` 是这套结构里最要紧的一列。今天三个应用指向同一个
小程序；HostHub 将来要单独卖的时候，用它自己的主体注册一个小程序，跑一条
`app:move` 就换过去了，代码不动。

### 调用方接入

```bash
curl -X POST https://tatocar.co/api/v1/notify \
  -H "Authorization: Bearer ntfy_xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "staff:cl9x",
    "channelName": "张师傅",
    "template": "task",
    "priority": "high",
    "dedupeKey": "task-123-updated",
    "data": {
      "title": "半小时后交车",
      "due": "2026-09-19T14:30:00.000Z",
      "vehicle": "7ABC123 · Model 3",
      "action": "任务更新",
      "details": "客人已到停车场"
    },
    "link": { "url": "https://tatocar.co/staff-share/xxx" }
  }'
```

几点约定：

- 调用方不写模板 ID、appid 和小程序路径。`template` 是逻辑名（`task` /
  `alert` / `digest`），中枢按应用所属的小程序去查真实模板。
- 字段的中文标签归 `NotifyApp.fieldLabels` 管，用 `app:labels` 设，小程序在读
  收件箱时拿到。内置了一套通用的（内容/时间/车辆/类型/备注/来源/地点/金额），
  应用自己的词汇（HostHub 的 `room`）加上去就行，也可以覆盖内置的。
  **改标签不用重新发小程序版本**——这正是它在服务端的原因。没命名的字段显示
  字段名本身，不会空白。
- 字段长度由字段名推出来：`phrase4` 只收 5 个字，`thing1` 收 20 个，超了自动
  截断而不是被微信整条退回。`time2` 收 ISO 时间戳，按 `NOTIFY_TIMEZONE`
  （默认跟 `CSV_IMPORT_TIMEZONE` 走，也就是 `America/Vancouver`）渲染，
  **不是**服务器本地时区——Railway 上跑在 UTC，用本地时区会让每条提醒差七八个小时。
- 返回 207 表示部分成功，逐个订阅者给出 `sent` / `no_quota` / `muted` /
  `duplicate` / `failed`。中枢**不做兜底**：额度不够就如实返回 `no_quota`，
  要不要改发邮件或短信由调用方自己决定。
- `priority` 决定能不能动用最后几格额度：`high` 剩 1 格就发，`normal` 要剩 2
  格，`low` 要剩 3 格。共用模板意味着共用额度池，这是防止洗车棚的例行消息
  吃掉 TATO 急单那一格的办法。
- `dedupeKey` 幂等。超时重试不会多花一次订阅额度。

### 额度

微信一次性订阅授权一次只能发一条，且可以累积，服务端查不到余额——所以中枢
自己记账：小程序每次 `requestSubscribeMessage` 回来调 `/api/v1/mp/subscribe`
上报，发送成功扣一格，收到 43101 就把该模板清零。记账会漂，但漂了会被 43101
纠正，不会静默。

### 小程序端接口

| 接口 | 用途 |
| --- | --- |
| `POST /api/v1/mp/session` | `wx.login` 的 code 换中枢会话，返回频道、模板 ID 和余额 |
| `POST /api/v1/mp/bind` | 用绑定码加入一个频道 |
| `POST /api/v1/mp/subscribe` | 上报 `requestSubscribeMessage` 的授权结果 |
| `GET /api/v1/mp/inbox` | 消息列表；带 `?d=<id>` 取被点开的那一条 |

中枢只存够详情页渲染的短 payload（最多 12 个字段、每个 200 字符），默认 30 天
过期。它不是消息中心：没有已读未读、没有搜索、没有历史。之所以要存一点，是因为
洗车棚在内网，点开详情时回不了源。

### 运维

```bash
npm run notify-hub -- status
npm run notify-hub -- mini-program:add --app-id wx123 --name "Ops"
npm run notify-hub -- template:set --mini-program wx123 --key task \
  --template-id TMPL_X --fields '{"title":"thing1","due":"time2"}'
npm run notify-hub -- app:add --key hosthub --name HostHub --mini-program wx123
npm run notify-hub -- app:labels --app hosthub --labels '{"room":"房间"}'
npm run notify-hub -- key:mint --app hosthub --name "vercel prod"
npm run notify-hub -- channel:add --app hosthub --key cleaning --name "保洁组"
npm run notify-hub -- channel:list --app hosthub
npm run notify-hub -- app:move --app hosthub --mini-program wx999
```

API key 只在 `key:mint` 时明文打印一次，之后只存哈希。

环境变量：

```env
# 小程序密钥按 NotifyMiniProgram.secretEnvVar 里写的变量名读取，
# 默认就是下面这个，多小程序时每个一行。
WECHAT_MINIPROGRAM_APP_SECRET=xxx
NOTIFY_HUB_SESSION_SECRET=xxx      # 缺省回落到 SESSION_SECRET
NOTIFY_TIMEZONE=America/Vancouver  # 缺省回落到 CSV_IMPORT_TIMEZONE
WECHAT_API_BASE=                   # 只在测试或需要微信备用域名时设置
```

### TATO 怎么接的

`lib/staff-task-notifications.ts` 里的微信那一路已经改成走中枢。TATO 自己不再
知道模板 ID、appid 和小程序路径，只说「发给 `staff:<id>` 频道、用 `task`
模板」。邮件和短信两路没动。

频道按员工一人一个，`channelName` 让它在第一次派单时自动建出来，不需要预先
开通。`dedupeKey` 用 `task:<id>:<action>:<updatedAt>`——同一次保存重试是重复，
真正的第二次编辑不是。派单和移除用 `high`，普通编辑用 `normal`，额度紧张时
急事才动用最后一格。

传输方式看环境变量：设了 `NOTIFY_HUB_URL` 就走 HTTP，没设就直接在进程内调用。
中枢现在就在这个 app 里，所以默认是进程内——给自己发一个 localhost 请求只会
多一种失败方式。哪天中枢搬出去，加两个变量就行，代码不用动。

发送失败永远不会抛：邮件短信都发完了才轮到微信，中枢挂了不能把派单变成 500。

```env
NOTIFY_APP_KEY=tato          # 对应 NotifyApp.key，缺省 tato
NOTIFY_HUB_URL=              # 留空＝进程内调用
NOTIFY_HUB_API_KEY=          # 只有走 HTTP 时需要
```

老小程序（`wechat-miniprogram/`）还没换，但已经用一座桥接到中枢上：绑定员工码
时建订阅，点「开启提醒」时记一格额度。桥在 `lib/notify-client.ts` 末尾，标了
transitional——等小程序改成调 `/v1/mp/bind` 和 `/v1/mp/subscribe`，桥和它的两个
调用点一起删掉。

已有员工的回填：

```bash
npm run notify-hub -- tato:sync
```

给每个在职员工建频道，已经绑过微信的顺带建订阅。额度不回填——没人做过的授权
造不出来。

### 小程序端

`wechat-miniprogram/` 现在是中枢的客户端，不再是 TATO 专用的任务端。

| 页面 | 作用 |
| --- | --- |
| `pages/message/index` | 首页，消息列表。**中枢发的每条订阅消息都跳这里**（`?d=<deliveryId>`），所以这个页面不能改名 |
| `pages/bind/bind` | 输入绑定码加入频道，可以加多个 |
| `pages/webview/webview` | 用 `web-view` 打开消息里带的链接 |
| `pages/login/login`、`pages/tasks/index` | TATO 原来的员工码登录和任务页，没动 |

`utils/hub.js` 是中枢的客户端，跟 TATO 自己的 `utils/api.js` 分开——同一个
小程序也要服务 HostHub 和洗车棚，那两边没有「任务」这个概念。

**补额度是这一版的重点。** `hub.topUp()` 做三件事：查哪些模板余额低于 3，
挑余额最少的最多三个（`requestSubscribeMessage` 一次最多三个），把授权结果报给
`/api/v1/mp/subscribe`。调用点有三处：

- 每次打开首页（用户勾了「总是保持以上选择」之后这里会静默成功，这是余额唯一
  能自动恢复的途径）
- 加入频道成功之后（刚点过按钮，手势还在，弹窗也不突兀）
- 首页顶部那条横幅，手动点

余额为 0 时横幅变红，写明「微信提醒已用完」。这是让「收不到」变成看得见的
最后一道——服务端记账、admin 界面、小程序横幅，三处都不再假装提醒是开着的。

**两个注册限制**（代码解决不了，注册前要想清楚）：

- `web-view` 对**个人主体小程序不开放**。真走个人主体的话，`pages/webview`
  用不了，消息详情只能看中枢存的那几个字段，点不进各系统自己的页面。
- 每个要在 `web-view` 里打开的域名都得在小程序后台配成业务域名。

### 还没做的

- 应用、密钥和模板还是只能从上面的 CLI 配。**频道和绑定码已经接到排班页了**：
  展开员工卡片的「Code / 员工备注」就能看到绑定码（点一下复制）、已绑定人数，
  以及还能收几条提醒；余额为 0 时会标红提示让员工重新授权。频道在页面渲染时
  按需创建，跟旁边的「小程序 Code」是同一套做法。
- 老的员工码登录（`pages/login`）和中枢的绑定码是两套身份，小程序里同时存在。
  等所有人都迁到绑定码之后，`lib/notify-client.ts` 里那座桥、老的
  `/api/wechat/staff/*` 路由和这两个页面可以一起删。
