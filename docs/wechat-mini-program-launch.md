# 微信小程序上线清单

从「什么都没有」到「员工在微信里收到派单」。

顺序是有依赖的。**阶段 0 那个决定会影响后面一半的步骤**，先定它。

涉及的代码：`lib/notify-hub/`、`lib/notify-client.ts`、`scripts/notify-hub.ts`、
`wechat-miniprogram/`。背景和设计说明在 [README 的「通知中枢」一节](../README.md#通知中枢notify-hub)。

> **这份清单有两个副本。** 这里是 Markdown 版；
> [`wechat-mini-program-launch.html`](wechat-mini-program-launch.html)
> 是发布成 Artifact 页面的那一份，能勾选、能存进度。
>
> 改动要两边都改：`npm run check:docs` 会核对步骤、阶段和 errcode 表是否一致，
> CI 每次也跑。新增步骤时，Markdown 那一项末尾要加 `<!-- id:xxx -->`，和 HTML 里的
> `data-id` 对上——这是两边配对的依据，所以措辞可以不同。
>
> 改完 HTML 之后还得手动重新发布 Artifact。**那一步 CI 检查不到**：
> 已发布的页面在 claude.ai 上，CI 没有能访问它的地址。

平台规则（认证要求、模板字段编号、各种限制）以微信公众平台后台当时显示的为准——
下面写的是本文档成稿时的情况，微信改过不止一次。

---

## 0 · 先定主体

注册时选个人还是企业，决定了消息点开之后能看到什么。这个选完很难改。

| | 企业主体 | 个人主体 |
| --- | --- | --- |
| 营业执照 | 需要 | 不需要 |
| 订阅消息 | 能发 | 能发 |
| `web-view` | **可以用** | **不能用** |
| 业务域名 | 要配（多一步校验文件） | 配不了 |

个人主体的实际后果：`pages/webview` 那个页面是死的，员工点开消息只能看到中枢存的
那几个字段，进不了 `/staff-share` 任务详情页，也传不了照片。

- [ ] 确认用哪个主体注册 <!-- id:s0a -->
- [ ] 确认微信认证要不要做 —— 订阅消息本身不需要认证。先按不认证跑通，需要了再补 <!-- id:s0b -->

## 1 · 注册与域名

在微信公众平台（mp.weixin.qq.com）。

- [ ] 注册小程序，记下 AppID（形如 `wx1a2b3c4d5e6f7890`） <!-- id:s1a -->
- [ ] 生成 AppSecret 并立刻存好 —— 开发管理 → 开发设置 → 开发者 ID。 <!-- id:s1b -->
      **只显示一次**，关掉就要重置
- [ ] 配服务器域名 —— 开发管理 → 开发设置 → 服务器域名，三项都加 `https://tatocar.co`： <!-- id:s1c -->
      - `request` 合法域名：小程序所有接口调用都走它，不配全部失败
      - `uploadFile` / `downloadFile`：老任务页传照片、看附件要用
- [ ] 配业务域名（**仅企业主体**）—— 加 `tatocar.co`，下载校验文件传到服务器根目录再校验。 <!-- id:s1d -->
      这是 `web-view` 能打开详情页的前提

## 2 · 订阅消息模板

在微信公众平台，功能 → 订阅消息。

- [ ] 添加一个任务提醒模板 —— 从公共模板库挑任务/待办类。需要五个字段： <!-- id:s2a -->
      任务内容、时间、车辆、状态、备注
- [ ] 抄下模板 ID 和每个字段的编号 <!-- id:s2b -->

      ```
      thing1   任务内容
      time2    到期时间
      thing3   车辆信息
      phrase4  任务状态
      thing5   备注
      ```

      编号是微信分配的，不一定和上面一样。以后台实际显示为准。

- [ ] 确认字段类型的长度限制 <!-- id:s2c -->

      中枢按字段名推长度限制（`lib/notify-hub/wechat.ts` 的 `FIELD_LIMITS`），
      所以类型不能记错：

      | 类型 | 上限 |
      | --- | --- |
      | `phrase` | **5 个字** |
      | `thing` | 20 个字 |
      | `character_string` | 32 位 |
      | `number` / `letter` | 32 位 |
      | `name` | 10 个字 |

      超了微信整条退回 `47003`，不是截断。

## 3 · 环境变量

在 Railway Variables。

- [ ] 必需的四个 <!-- id:s3a -->

      ```env
      WECHAT_MINIPROGRAM_APP_ID=wx...
      WECHAT_MINIPROGRAM_APP_SECRET=...
      NOTIFY_HUB_SESSION_SECRET=      # 随机长字符串
      WECHAT_TASK_TEMPLATE_ID=        # 老任务页还在用
      ```

      `NOTIFY_HUB_SESSION_SECRET` 不设会回落到 `SESSION_SECRET`，
      但生产环境两个都没有会直接抛错。

- [ ] 确认时区 —— 不设 `NOTIFY_TIMEZONE` 会回落到 `CSV_IMPORT_TIMEZONE`， <!-- id:s3b -->
      再不设是 `America/Vancouver`。**绝不能用服务器本地时区**：Railway 跑在 UTC，
      会让每条提醒差七八个小时，而且看起来完全正常
- [ ] 确认 `WECHAT_API_BASE` 是空的 —— 这个只在测试时指向假服务器用 <!-- id:s3c -->
- [ ] 别配 `WECHAT_TASK_MESSAGE_FIELDS` —— 已经没有代码在读它。 <!-- id:s3d -->
      字段映射归中枢的 `NotifyTemplate.fieldMap` 管，见下一阶段

## 4 · 初始化中枢

在终端，按顺序跑——后面的命令依赖前面建出来的记录。

- [ ] 登记小程序 <!-- id:s4a -->

      ```bash
      npm run notify-hub -- mini-program:add \
        --app-id wx1a2b3c4d5e6f7890 \
        --name "Ops"
      ```

      密钥不存数据库，只记变量名，默认就是 `WECHAT_MINIPROGRAM_APP_SECRET`。

- [ ] 登记模板和字段映射 <!-- id:s4b -->

      ```bash
      npm run notify-hub -- template:set \
        --mini-program wx1a2b3c4d5e6f7890 \
        --key task \
        --template-id <模板ID> \
        --fields '{"title":"thing1","due":"time2","vehicle":"thing3","action":"phrase4","details":"thing5"}'
      ```

      左边是调用方用的逻辑名，右边是阶段 2 抄下来的真实编号。

- [ ] 建 TATO 这个应用 <!-- id:s4c -->

      ```bash
      npm run notify-hub -- app:add \
        --key tato --name "TATO" \
        --mini-program wx1a2b3c4d5e6f7890
      ```

      `--key tato` 要跟 `NOTIFY_APP_KEY` 对上（默认就是 `tato`）。

- [ ] 回填员工频道 <!-- id:s4d -->

      ```bash
      npm run notify-hub -- tato:sync
      ```

      给每个在职员工建一个频道。额度不会回填——没人做过的授权造不出来。

- [ ] 检查一遍 <!-- id:s4e -->

      ```bash
      npm run notify-hub -- status
      ```

      密钥那行要显示 `✓ present`。显示 `✗ MISSING` 就是 Railway 变量没生效，重新部署一次。

## 5 · 小程序发布

在微信开发者工具。

- [ ] 换掉占位的 AppID —— 打开 `wechat-miniprogram/`，把 `project.config.json` 里的 <!-- id:s5a -->
      `wx-your-app-id` 改成真的
- [ ] 确认接口地址 —— `app.js` 的 `apiBaseUrl` 应该是 `https://tatocar.co`， <!-- id:s5b -->
      和阶段 1 配的 request 合法域名一致
- [ ] 真机走一遍完整流程 —— 模拟器发不出订阅消息。顺序： <!-- id:s5c -->
      打开小程序 → 输绑定码 → 授权提醒 → 让 admin 派个任务 → 微信里收到
- [ ] 上传、提审、发布 <!-- id:s5d -->
- [ ] 把发送状态切到对的档位 <!-- id:s5e -->

      `miniprogram_state` 决定消息能发到哪种版本的小程序。审核通过前是体验版，
      要设 `trial`，否则消息发不到；发布之后切回 `formal`。

      ```bash
      npm run notify-hub -- mini-program:set \
        --app-id wx1a2b3c4d5e6f7890 --state trial
      ```

      **这不是环境变量。** 以前是 `WECHAT_MINIPROGRAM_STATE`，现在是
      `NotifyMiniProgram` 上的一列，没有代码再读那个变量了——设了不生效。

## 6 · 交给员工

- [ ] 拿绑定码 —— 排班页展开员工卡片的「Code / 员工备注」，点绑定码就复制 <!-- id:s6a -->
- [ ] 让员工绑定 —— 打开小程序 → 添加频道 → 输码。一个人可以加多个频道， <!-- id:s6b -->
      以后接 HostHub 和洗车系统就是再给一个码
- [ ] **交代他们勾「总是保持以上选择」** —— 最容易漏，也最要紧。微信一次授权只够收 <!-- id:s6c -->
      **一条**消息。勾了这个框，以后每次打开小程序会静默补额度，这是余额能自动恢复的
      唯一办法。不勾就得每次手动点
- [ ] 派一个真任务验收 —— 回排班页看那一行，应该显示「N 人已绑定 · 还能收 N 条」。 <!-- id:s6d -->
      显示红字就是额度用完了

---

## 额度是这套系统的核心约束

微信的一次性订阅是「一次授权换一条消息」，授权可以累积，但服务端查不到余额。
所以中枢自己记账：员工每次授权上报一次，发送成功扣一格，收到 `43101` 就清零。

三个地方都会显示余额：

- 排班页员工那一行
- 小程序首页的横幅（为 0 时变红）
- 发送接口按订阅者返回的 `no_quota`

哪个都别忽略——「收不到」以前是静默的，现在不是了。

## 收不到消息时对照

| errcode | 意思 | 怎么办 |
| --- | --- | --- |
| `43101` | 用户没有未使用的授权了 | 正常现象。让员工打开小程序重新授权，并勾上「总是保持以上选择」 |
| `47003` | 字段超长或格式不对 | 多半是 `phrase` 超了 5 个字。检查阶段 2 记的字段类型 |
| `41030` | page 路径不对 | 小程序没发布，或 `pages/message/index` 不在 `app.json` 里 |
| `40001` | access_token 失效 | 中枢用的是 `stable_token`，正常不该出现。真出现了检查 AppSecret 是不是被重置过 |
| `40003` | openid 不合法 | 该 openid 属于别的小程序。换过 appid 的话员工要重新绑定 |
| — | 完全没反应 | 先跑 `status` 看密钥在不在，再看日志里有没有 `MINI_PROGRAM_SECRET_MISSING` |
