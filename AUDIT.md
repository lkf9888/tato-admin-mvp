# 体检报告 — 2026-04-30

体检对象:Tato Admin MVP `v0.16.5`(Next.js 15 + Prisma + SQLite + Stripe)。
本次体检覆盖:核心鉴权、业务逻辑、API 路由、UI 层、依赖与文档。
**不在此次范围**:跑 dev server / 实际触发流程的运行时测试(本机未装依赖,见下方"如何继续")。

CHANGELOG 显示项目近 3 天非常活跃(v0.16.0–0.16.5),所以下面的"明显问题"已经被修过一遍。本报告聚焦近期改动**没有覆盖到**的盲区,以及结构层面值得长期投入的方向。

---

## 🐛 Bug 修复(按严重度排序)

### P0(影响数据正确性,建议优先处理)

- [ ] **Direct-booking 订单写入时缺少 `workspaceId`** — [lib/direct-booking-server.ts:133-158](lib/direct-booking-server.ts:133)
  - 现象:Stripe webhook 完成支付后,`prisma.order.create` 没有把 `workspaceId` 写进去。同文件 line 88 用 `findUnique({where: {id}})` 拿车,也没按 workspace 过滤。
  - 后果:通过 `/reserve/[vehicleId]` 进来的真实付款订单,在 calendar / dashboard / orders / share 页全都按 `workspaceId` 过滤的查询里**看不到**——管理员收了钱但看不到这单。
  - 修复:在 create payload 里加上 `workspaceId: vehicle.workspaceId` (对应 vehicle 的 workspace),并在前面 vehicle 查询里把它一起 select 出来。

### P1(安全 & 鉴权层面的硬伤)

- [ ] **`loginAction` 没有任何 rate limit** — [app/actions.ts:93-104](app/actions.ts:93)
  - 现象:任何人可以无限次试密码。bcrypt 拖慢了攻击,但拦不住分布式枚举,也容易被刷成 DoS。
  - 修复:加一层基于 IP + email 的尝试次数限制(可以用 `prisma` 临时建张 `LoginAttempt` 表,或上 Upstash Redis)。

- [ ] **`unlockShareLinkAction` 没有 rate limit** — [app/actions.ts:711-731](app/actions.ts:711)
  - 现象:share-link 密码同上,可被暴力破解。share-link 页是公网可达的。
  - 修复:同上,按 token + IP 限速。

- [ ] **没有忘记密码 / 重置密码流程**(grep 全仓为零)
  - 现象:用户忘了密码就只能联系运营手动改库或重置。生产环境必备。
  - 修复:复用现有 `EmailVerification` 表(已支持 `purpose` 字段),新增 `purpose: "password_reset"`,加两个 server action + 一个 `/reset-password` 路由。

- [ ] **密码强度过弱**:`z.string().min(6)` — [app/actions.ts:69](app/actions.ts:69)
  - 修复:至少 8 位,加复杂度检查或简单地集成 zxcvbn。

- [ ] **Middleware 只检查 cookie 是否存在,不验签** — [middleware.ts:19](middleware.ts:19)
  - 现状:实际页面都调了 `requireCurrentWorkspace` 等做了二次验签(已 grep 确认 12 个 admin 页面全覆盖),所以**当前不可被利用**——只是 defense-in-depth 缺一层。
  - 修复(可选):用 Edge-Runtime 兼容的 Web Crypto 在 middleware 里直接验 HMAC,避免依赖每个页面记得调。

### P2(逻辑/边界问题,影响小或已被外部因素掩盖)

- [ ] **`parseCsvDate` 解析失败时悄悄走 `new Date(trimmed)` fallback** — [lib/orders.ts:315-316](lib/orders.ts:315)
  - 现象:fallback 没有时区换算,会用 server 时区解析,可能跟 `CSV_IMPORT_TIMEZONE` 配置不一致,造成时差几小时的订单。
  - 修复:fallback 路径也走 `zonedWallClockToUtc`,或干脆 `failures.push` 标为不可解析行。

- [ ] **CSV 导入 reconcile 是 O(n²)** — [lib/orders.ts:73-90](lib/orders.ts:73)
  - 现象:一辆车 1000 个订单时为 100 万次比较,每次还触发一个 prisma update。
  - 修复:排序后单次扫描(O(n log n)),`hasConflict` 一次性 batch update。

- [ ] **`importTuroOrders` 顺序 await 单行处理** — [lib/orders.ts:782-948](lib/orders.ts:782)
  - 现象:大文件(500+ 行)导入慢,每行 1–5 个串行 DB 调用。Railway 部署上容易卡。
  - 修复:同 vehicle 内可串行(冲突检测需要),但跨 vehicle 可以并行;或先批量 `findMany` 再内存匹配。

- [ ] **重复的"创建订单"逻辑** — [app/actions.ts:478-557](app/actions.ts:478) vs [app/api/orders/offline/route.ts:64-127](app/api/orders/offline/route.ts:64)
  - 现象:两份代码做几乎一样的事,字段校验、payload 组装、reconcile、log 都重复了。任何业务变更要改两处,极易漂移。
  - 修复:抽出 `lib/orders-write.ts`(`createOfflineOrder`/`updateOfflineOrder`),两边都调它。

- [ ] **重复的"创建 share-link"逻辑** — [app/actions.ts:619-658](app/actions.ts:619) vs [app/api/share-links/create/route.ts:26-75](app/api/share-links/create/route.ts:26)
  - 同上,抽公共函数。

- [ ] **`getCurrentAdminUser` 缺少撤销机制** — [lib/auth.ts:80-100](lib/auth.ts:80)
  - 现象:cookie 仅按 8h `maxAge` 过期,无 server 端 session 表。改密码 / 删除用户后,旧 session cookie 还能继续工作 8 小时。
  - 修复(可选):加一个 `User.passwordChangedAt`,session value 里嵌 issuedAt,验证时比对;或干脆在 DB 里维护 session 表。

---

## 🎨 UI 美化机会

### 全局问题(影响所有页面)

- [ ] **8 处 `rgba(89, 60, 251, X)` 在 Tailwind 任意值里写了空格,样式被静默丢弃**
  - Tailwind 的 `bg-[...]` / `border-[...]` / `shadow-[...]` 等任意值不允许字面空格(空格会切断 class)。`rgba(89, 60, 251, 0.18)` 之类应改成 `rgba(89,60,251,0.18)` 或 `rgba(89_60_251_/_0.18)`(Tailwind 4 的 modern 语法)。
  - 受影响文件:
    - [app/(admin)/layout.tsx:144](app/(admin)/layout.tsx:144) — workspace badge 边框 + 阴影
    - [app/(admin)/vehicle-roi/page.tsx:320](app/(admin)/vehicle-roi/page.tsx:320) — 主按钮阴影
    - [app/(admin)/direct-booking/page.tsx:124](app/(admin)/direct-booking/page.tsx:124) — 选中态边框
    - [app/(admin)/orders/page.tsx:94](app/(admin)/orders/page.tsx:94) — 主按钮阴影
    - [components/public-booking-panel.tsx:214](components/public-booking-panel.tsx:214) — 日期选中阴影
    - [components/public-booking-panel.tsx:578](components/public-booking-panel.tsx:578) — 提交按钮阴影
    - [components/status-badge.tsx:8](components/status-badge.tsx:8) — booked 状态边框
    - [components/status-badge.tsx:16](components/status-badge.tsx:16) — privacy 状态边框
    - [components/vehicle-orders-export-button.tsx:209](components/vehicle-orders-export-button.tsx:209) — 导出按钮阴影
  - 影响:这些视觉细节(柔和紫色边框/阴影)目前在浏览器里看不到。修复后整体设计会更统一立体。
  - 修复成本:**极低**,一次 search-and-replace 就能搞定。**性价比最高的 UI 修复**。

- [ ] **三套色彩系统并存,不一致**
  - `app/login/page.tsx` / `app/register/page.tsx`:纯黑白(`bg-black`、`text-black`、`border-black/15`)
  - `app/(admin)/dashboard/page.tsx`、`app/share/[token]/page.tsx`:`slate-50`/`slate-500`/`slate-900` 等 Tailwind 默认色
  - `components/app-shell.tsx`、`components/calendar-view.tsx`、大部分 admin 页面:CSS 变量 `var(--ink)`、`var(--ink-soft)`、`var(--line)`、`var(--page)`、`var(--accent)`
  - 影响:深浅色调对不齐、颜色管理分散,后续做 dark mode 或品牌调色会很痛。
  - 修复:确定唯一的真理之源(推荐 CSS 变量,因为已经定义最多),把 dashboard / share / login 里的 `slate-*` 和 `bg-black` 替换为 `var(--ink)` / `var(--page)` 等;同时去掉硬编码的 `#593cfb`(`components/public-booking-panel.tsx:214,578`)。

### 单页面机会

- [ ] **Dashboard 信息密度低、缺乏关键 KPI** — [app/(admin)/dashboard/page.tsx](app/(admin)/dashboard/page.tsx)
  - 当前只有"今日租出/取车/还车/冲突/最后同步"5 个数字 + upcoming + 活动日志。
  - 缺:本月 GMV、本月净收益、车辆使用率(占用天 ÷ 在役天)、对比上月趋势、活跃车辆 Top N。
  - 修复方向:加一行"本月概览"卡片,新增图表(可考虑 Recharts/Tremor)。

- [ ] **Orders 页 432 行**,纯 server component 渲染了搜索、筛选、列表、表单 — [app/(admin)/orders/page.tsx](app/(admin)/orders/page.tsx)
  - 没有分页,长用户上千条订单会渲染卡顿。
  - 修复:加 `?page=N` 分页(prisma `take/skip`)+ 筛选(状态、车辆、日期范围)。

- [ ] **没有全局搜索 / Command-K**
  - 12 个 admin 页面 + 大量列表数据,用户找一个特定订单/车牌只能逐页点。

### 公开页面

- [ ] **`/share/[token]` 错误状态用 `bg-rose-50/text-rose-700`**(line 86)与整体设计语言不符,色调突兀。
- [ ] **`/share/[token]` 标题 `text-5xl`** 在窄屏可能溢出,值得 `sm:text-5xl` 降级处理。
- [ ] **`/reserve/[vehicleId]`**(直接预订落地页)还可以加车辆图片、品牌 logo、用户评价,提升可转化性。

---

## ✨ 新功能候选(按业务价值排序)

### 高价值

- [ ] **忘记密码 / 重置密码** — 上面 P1 提过,生产必备
- [ ] **密码登录 + Email 二步验证** — User 表已有 email,EmailVerification 已可复用,加一个登录 OTP / 受信任设备记忆即可
- [ ] **Activity Log 后台浏览页** — schema 已建表,但管理员看不到。加个 `/activity` 页(可筛选 actor/entityType/日期)
- [ ] **报表中心 `/reports`** — 月度 GMV、按车的 ROI 趋势、按 owner 的应分账,直接复用 ROI 已有逻辑
- [ ] **租客提醒**(取车前 24h、归还后 1h)— 直接复用 [lib/email.ts](lib/email.ts) Resend wrapper

### 中价值

- [ ] **批量操作**:订单批量取消、批量导出、批量改状态
- [ ] **日历拖拽改期** — 现在的 calendar 是只读视图([components/calendar-view.tsx:1401 行](components/calendar-view.tsx))
- [ ] **车辆图片管理** — 当前 schema 没图,直接预订页很苍白
- [ ] **客服工单/留言**:租客通过 share 链接给 owner 留言

### 低价值 / 可后置

- [ ] 角色分级:目前所有 user 都是 admin;若以后多人协作要加 role 字段
- [ ] Webhook 给 owner 推送(Slack / 微信通知)

---

## 🔧 重构 / 升级

### 高 ROI

- [ ] **`lib/i18n.ts` 拆分**(1448 行单文件)— [lib/i18n.ts](lib/i18n.ts)
  - 改成 `lib/i18n/dashboard.ts`、`lib/i18n/orders.ts` 等模块化结构,每加一个语言或修一句话不用滚 1500 行。
  - 现有 `sc-to-tc.ts` 简繁转换逻辑保留。

- [ ] **`components/calendar-view.tsx` 拆分**(1401 行单文件)— [components/calendar-view.tsx](components/calendar-view.tsx)
  - 至少抽出 `<DateScrubber>`、`<CalendarRow>`、`<OrderBar>`、`<MobileCalendarLane>`。

- [ ] **`components/csv-import-panel.tsx` 拆分**(906 行)— [components/csv-import-panel.tsx](components/csv-import-panel.tsx)
  - 抽出 step 1 / step 2 / step 3 各自的子组件,主文件只做编排。

- [ ] **加最小测试套件** — 当前 0 个测试文件
  - 推荐 Vitest(配 happy-dom)做 lib 单测,Playwright 做 1-2 条关键 E2E(登录、CSV 导入、直接预订)。
  - 业务逻辑放 lib(orders / billing / direct-booking 已经在那),测试覆盖收益高。

### 中 ROI

- [ ] **依赖统一升级体检** — `bcryptjs ^2.4.3`(2018 年发布)有更新版本;`zod ^3.24.4` 可考虑 Zod 4;Stripe SDK `^22.0.0` 已有更新。
- [ ] **Stripe SDK 没固定 API version** — [lib/stripe.ts:45](lib/stripe.ts:45) `new Stripe(secretKey)`。建议 pin 一个 `apiVersion`(避免 SDK 升级时 webhook 行为漂移)。
- [ ] **将 SQLite 迁移到 Postgres**(README/CHANGELOG 已多次提到)— 多 worker 并发、`@@index` 真索引、备份恢复都更省心。Prisma 这边只需改 datasource。

### 低 ROI / 可观察

- [ ] middleware 升级到完整 HMAC 验签(P1 里已写)
- [ ] Order 表加 partial index 提速 calendar 范围查询(SQLite 上效果有限,PG 上明显)

---

## 🎯 我的 Top 5 推荐(性价比最高,建议从这里挑)

按"价值 ÷ 工作量"排序,适合下次会话单点深做:

1. **修 `rgba()` 空格 Bug**(UI/视觉,15 分钟,8 个文件 search-and-replace)— 立竿见影统一品牌
2. **修 direct-booking 订单缺 workspaceId**(P0 数据 Bug,30 分钟)— 防止收钱看不到订单的真实事故
3. **加忘记密码流程**(新功能 + 安全,半天)— 复用 EmailVerification,补齐生产必备
4. **登录 / share-link 密码加 rate limit**(P1 安全,1 小时)— 简单 DB 表 + 中间件层
5. **拆 `lib/i18n.ts`**(重构,2-3 小时)— 维护性大幅提升,后续每次加文案都受益

---

## 如何继续

下次会话可以:
- 直接说"做 #1"(或 1+2 一起,都是 UI 范畴)
- 让我跑 `npm install && npm run dev` 实测某条流程,做更深入的运行时验证
- 从清单里自己挑一项,让我深入实现

本机未装依赖,Prisma client 也未 generate;真要本地跑要先 `npm install && npm run prisma:generate && npm run db:push && npm run prisma:seed`(README 已写)。
