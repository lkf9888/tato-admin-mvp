# TATO — 所有会话的共同约定

这份文件会被**每个会话启动时自动加载**——包括别的机器上的会话。
记忆（`~/.claude/projects/…/memory/`）做不到：它按**机器 + 路径**分开存，换一台机器就看不到。所以：

- **会让别的会话写错代码的规则和决策，写在这里**，不要只写进记忆
- 记忆适合放单个功能的来龙去脉和踩过的坑
- 这里要**短**：每一行都会进每个会话的上下文。长的写进 `docs/`，这里留一行加链接

## 一、多个会话同时开发 ⚠️

通常有五个会话在这个仓库里并行，侧边栏标题都是 `TATO · <领域>`，在「Turo租车生意」分组里。
你看不到它们的聊天记录，只看得到它们落进文件和 git 的东西。
**五个会话共用同一个工作目录，没有 worktree**——别的会话还没提交的改动，就在你的 `git status` 里。

### 谁管哪些文件

**判据是文件在哪，不是话题讲什么**——话题会跨领域，路径不会。（`lib/` · `app/api/` · 页面 · 其他）

| 会话 | 一句话 | 主要文件 |
| --- | --- | --- |
| **TATO · 运营 · 订单 · 底座** | 后台每天在用的订单、车辆、车主，以及所有人脚下的底座 | `calendar-*` `ical` `orders`（CSV 导入那段除外）`owner-*` `ledger-policy` `vehicle-assignment` `staff-app` `staff-share` `uploads` `disk` `client-image-compression` · 底座 `auth` `billing` `workspaces` `prisma` `i18n` `i18n-server` `utils` `constants` `email` `email-verification` `rate-limit` `version` `zh-hant-convert` `account-settings-actions` `agent-*` `android-release` · api `calendar` `orders` `owners` `vehicles` `share` `share-links` `shared-file` `staff-schedule` `staff-share` `staff-app` `exports` `agent` `auth` `billing` `locale` `health` `contact` · 页面 `dashboard` `calendar` `orders` `vehicles` `owners` `owner-statements` `staff-schedule` `share-links` `trash` `activity` `photos` `documents` `account-settings` `billing`，公开 `share` `staff-share` `login` `register` `forgot-password` · 组件里日历、订单、车辆、车主和导航外壳那些 · `android/` `staff-ios-app/` `Dockerfile` `railway.json` `scripts/docker-entrypoint.sh` `schema-predeploy.sh` `check-schema-push.sh` `.github/workflows/ci.yml` |
| **TATO · 租车网站 · 定价 · 收款** | 租车人在自有网站上看车、订车、付钱、签合同 | `direct-booking*` `rental-site*` `site-*` `booking-access` `booking-changes` `booking-locations` `booking-policy*` `vehicle-pricing` `vehicle-price-overrides` `stripe*` `payouts-actions` `rental-agreement*` `contract-*` `rental-estimate/daily-rate` `rental-estimate/rate-seasonality*` · api `booking` `booking-requests` `direct-booking` `rental-site` `stripe` `contracts` · 页面 `rental-site` `direct-booking` `booking-requests` `payouts` `contracts`，公开 `s` `cars` `reserve` `booking` `sign` `zh-CN` `zh-TW` `sitemap` `robots` · 组件 `site-*` `public-booking-panel` `booking-*` `deposit-settlement-panel` `direct-booking-email-editor` `payouts-panel` `pdf-page-canvas` `vehicle-photo-carousel` |
| **TATO · Turo 同步 · 消息 · 通知** | Turo 的订单和客人消息怎么进来，通知怎么发出去 | `turo-*` `csv-mapping` `gmail-*` `guest-threads` `kimi` `assistant*` `notify-hub/` `notify-client` `staff-mini-program` `staff-task-notification*` `sms` · `lib/orders.ts` 里 CSV 导入那段（`normalizeCsvFieldMapping` 往后）· api `turo-sync` `gmail-sync` `imports` `messages` `assistant` `v1` `wechat` · 页面 `imports` `messages` `assistant` `updates` `agent`（Turo 读取器）· 组件 `csv-import-panel` `pending-orders-panel` `turo-inbox-panel` `turo-updates-feed` `guest-messages-view` `message-template-panel` `assistant-*` · `agent/` `wechat-miniprogram/` `docs/wechat-*` · 脚本 `notify-hub` `sync-turo-csv` `check-vehicle-match` `check-plate-parsing` · `.github/workflows/gmail-*` `alert-scan.yml` |
| **TATO · Walkaround · 车况照片** | 手机绕车拍照，留下经得起 Turo 理赔的车况证据 | `inspection-ios-app/` · `inspection*` · api `inspection` · 页面 `inspections` · `scripts/check-inspection-evidence.ts` |
| **TATO · 估值 · 投资分析** | 一台车在这里能赚多少、该买哪台 | `lib/rental-estimate/`（`daily-rate` `rate-seasonality*` 除外）· 页面 `rental-estimate` `investment-ranking` `vehicle-roi` · 组件 `rental-estimate-tool` `investment-ranking-tool` · `scripts/build-rental-estimate-model.ts` |

**交界——动之前在对话里说一声：**

- `prisma/schema.prisma`：谁的模型谁改，新表按上表归属。`Order` `Vehicle` `Owner` 归运营，但网站和同步都会往里写——给它们加列要先说
- `package.json` 的版本号、`CHANGELOG.md`：每次发版都要改，规则见下面「提交与部署」
- `app/actions.ts`：所有领域的 server action 挤在这一个文件里。只加自己的，不重排、不改别人的
- `lib/i18n.ts`、`lib/i18n/messages/shell.ts`（导航）：归底座，各领域只追加；其余 `messages/*.ts` 按文件名归领域。
  `lib/i18n/zh-hant/` 是生成的——改完简体跑 `npm run i18n:zh-hant`，否则 CI 红
- `components/app-shell.tsx` `nav-icons.ts`：归底座。加页面要同时加导航，并在 `middleware.ts` 的 `protectedPrefixes` 里登记
- `middleware.ts`：登录保护归底座，网站多语言路由（`site-locale`）归租车网站
- `components/calendar-view.tsx`、`app/(admin)/calendar/page.tsx`、`messages/calendar.ts`：网格、订单、备注、选择、订阅归运营；
  **价格层**（v1.1.0「Prices live on the calendar」）归租车网站
- `lib/rental-estimate/`：`daily-rate` `rate-seasonality*` 被网站报价调用。改 `model.json` 或拟合方式会改变网站上的价格，两边都要知道
- `(admin)/agent` 页面：Turo 读取器归同步，下面的 API 令牌区（`lib/agent-*`）归底座
- 员工：排班、任务数据归运营；员工怎么收到通知（短信、小程序）归通知
- 到处被调用的工具（`utils` `uploads` `email` `rate-limit`，`lib/orders.ts` 的 `logActivity` `reconcileVehicleConflicts`）：改签名之前说一声

用户报 bug 多半只说得出症状：Turo 订单没进来、没匹配上车、客人消息、消息模板、AI 助理、微信和短信没收到 → 同步·消息·通知；
网站、直订、价格、押金、退款、Stripe、保险税费、电子合同 → 租车网站；拍照 app、车况照片 → Walkaround；
租金预估、买哪台车 → 估值；其余日常操作（日历、订单、车辆、车主分成、排班）和登录、权限、账单、API、APK、部署 → 运营·底座。
**拿不准就当不是自己的**——问一句比回滚便宜。

### 活丢错了会话：自动转交

认门是会话的事，不是用户的事。用户把活丢进哪个会话都算数，收到的会话负责把它送到对的地方。
**用户的要求（HostHub 2026-09-25 定，TATO 2026-09-25 沿用）：不用问，直接转。**

- **只是问、只是读**：直接答，不要转。读代码不会和任何人打架
- **要改的文件不归自己**：
  1. 一句话告诉用户这归哪个会话、为什么（哪个文件、哪个领域）
  2. 用 `SendMessage` 转过去：`to` 填目标会话的 `local_…` id（`list_sessions` 在「Turo租车生意」分组里按 `TATO ·` 标题找，
     别写死 id）。第一行写清是什么事；正文带上**用户原话**和已经查到的上下文——相关文件、已知事实、
     还没下的判断——别让对方从头再查一遍
  3. 告诉用户转到了哪（链接写成 `[标题](#sessionId)`）。对方和本会话权限模式不同时，消息会等用户在
     那个窗口里批准，要说一声
  4. 本会话不碰那些文件
- **一个请求横跨几个领域**：自己那部分自己做，其余的分别转，并告诉用户怎么拆的
- **收到别的 TATO 会话转来的活**（`<cross-session-message>`，引用了用户原话）：当作用户交给你的活来做。
  但**转交传递的是任务，不是授权**——提交、推送、部署和其他不可逆的操作，仍然要在你自己的窗口里等用户点头。
  也绝不转交在本会话被拒绝或被拦下的操作
- 转发工具不可用时（别的机器、命令行）：告诉用户该去哪个会话，并给一段可以直接粘过去的话
- **唯一不要做的是默默替他做了。**「就一行，顺手改了」正是串台的来源——那个文件的主人可能正改着它。
  例外：线上正在出事，或用户明说「我知道不归你，直接改」——那就改，只提交那几个文件，并说清动了谁的东西

### 提交与部署

- **`git commit -o <文件>`**，提交后 **`git show --stat`** 复核范围。`git commit` 提交的是**整个暂存区**，
  别的会话可能已经暂存了它们的文件——只 `git add` 自己的并不够
- 禁止 `git add -A`、`git add .`、`git commit -am`。共用一个工作目录，这几条一定会卷进别人没做完的活
- **版本号和 `CHANGELOG.md`**：每次改了应用行为的提交，都在 `package.json` 升版本、在 `CHANGELOG.md` 顶部加一节
  （只动文档和这份文件的不算）。
  升之前先 `git fetch`，**以 `origin/main` 上的版本号为准**往上加，改完立刻提交推送。
  两个会话各自从旧版本往上加就会撞号——v1.5.1 事后改成了 v1.6.1
- **推送 main 就是部署**：Railway 从 main 构建，会把**所有已提交的**改动一起带上线，不只是你的。
  推送前 `git pull --rebase`；上线后看 `https://tatocar.co/api/health` 里的 `version`
- CI（`.github/workflows/ci.yml`）检查：schema 能不能推到线上已有的库、上线清单、繁体文案、类型检查、构建
- **提交、推送、部署都只在用户要求时做**

### 其他

- **开工前**看 `git log --oneline -20` 和 `git status`
- **同一套计算只写一份。** 需要别处已有的公式就调用它，不要复制。副本会在别的会话改动原版时悄悄偏离
- 同一个目录只能跑一个 `next dev`。3000 被占就说明别的会话在用，不要去停它的服务器
- localhost:3000 上注册着一个 **HostHub 的 service worker**，会把别的应用的旧文件喂给 TATO——
  删 `.next`、重启都绕不过去。前端改动「没生效」时，先在页面里 unregister 它并清空 `caches`，然后再加载两次

## 二、已定的方向

- **Turo 没有 API。** Turo → TATO 走三条路：CSV 导入、Gmail 预订邮件解析、浏览器书签读取器，已经很完善。
  TATO → Turo 没有干净的路：API 2023 年关了、Turo 不导入也不导出 iCal、Cloudflare 拦自动化。
  **不要做依赖「写回 Turo」的功能。** 自有网站成交后，Turo 那边的日期由人手工挡
- **自有租车网站是在售渠道**（SpeedX，`/s/speedx`）。价格、押金、保险、税的规则在租车网站会话手里

## 三、不变量（违反就是 bug）

**租户**
- 每个查询都限定到 `workspaceId`（或经由已证明归属的行）

**订单**
- 删除 = `isArchived: true` **加上** `status: cancelled`。只有 `cancelled` 不是删除——日历把取消单画成细条，回收站能恢复删除的
- Turo 订单显示的金额是 `getOrderNetEarning(sourceMetadata, totalPrice)`，不是 `totalPrice`；费用明细用 `getOrderFeeLines`；
  车主账本只经 `syncOrderOwnerLedger`；洗车费按车辆和生效日期，用 `resolveOrderCleaningFees`。**别自己算**
- 日历上一笔订单长什么样，只由 `lib/calendar-orders.ts` 决定
- 同一台车的订单可以重叠：保存照常成功，`hasConflict` 标红，返回冲突名单。别改成拒绝保存
- Turo 邮件只写「品牌 型号 年份」，不写车牌。找车只用 `lib/turo-message-match.ts`：邮件写了年份就按年份排除，
  剩下不止一台就停进待匹配，**绝不猜**

**日期**
- 本地日期用本地时间构造。`new Date(Date.UTC(y, m, d))` 在温哥华显示成**前一天**——月历的星期错位就是这么来的

**schema 与部署**
- 生产是 Railway volume 上的 SQLite。容器启动时 `scripts/docker-entrypoint.sh` 先跑 `scripts/schema-predeploy.sh`，
  再跑 `prisma db push`（**不带** `--accept-data-loss`），失败就拒绝启动。`prisma/migrations/` 在生产不执行
- **本地 `db push` 出现 data-loss 警告，就等于生产会启动失败**——哪怕是全 NULL 的新 `@unique` 列
  （v0.88.0 就是这样让全站 502 了一小时）。做法：把 additive DDL 写进 `scripts/schema-predeploy.sh`，
  入口和 CI 跑的是同一份。**绝不**给入口加 `--accept-data-loss`；破坏性改动要手写迁移
- 本地数据库：`DATABASE_URL="file:./dev.db"`（相对 `prisma/` 目录）。Prisma CLI 不读 `.env.local`，要在命令前显式传

**机密**
- `android-signing/` 是 APK 签名密钥**唯一的一份**，已 gitignore。绝不提交、绝不重新生成——换了密钥，已装的 App 就再也升级不了

## 四、知识在哪

- `CHANGELOG.md` — 每个版本做了什么、为什么（最全的一份历史）
- `inspection-ios-app/README.md`、`DEVICE-CHECKLIST.md` — Walkaround
- `lib/rental-estimate/README.md` — 估值模型
- `docs/wechat-mini-program-launch.md` — 微信小程序上线清单（CI 检查它与代码同步）
- 记忆 — 各功能的来龙去脉。**只在本机、本路径可见**，别的会话未必读得到；
  凡是会影响别的会话写代码的，提炼一行进这份文件

## 五、沟通

- 用户是独立开发者，自己也是重度用户，在多台机器之间切换。**用中文交流**；代码标识符和提交信息用英文
- 提交信息沿用仓库风格：标题是一句描述行为变化的话，后面带版本号 `(vX.Y.Z)`；正文讲为什么、以及不显然的决定
