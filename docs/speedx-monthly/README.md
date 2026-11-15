# SpeedX Monthly — 温哥华月租转租（在 TATO 上做实验）

平台承租车主的车，再按整月转租给没有信用记录或 BC 驾驶记录的人（新移民、留学生、工签、外派）。
1–12 个月，可续租，月租含保险（运营方以 lessee 身份投保），租得越长越便宜。

| 文件 | 内容 |
|---|---|
| [execution-plan.md](execution-plan.md) | 原始需求（2026-10-30 收到，**原文不改**）。其中几处假设已被讨论修正，见 business-model §9 |
| [business-model.md](business-model.md) | 业务模式讨论稿：三方关系、法律依据、车主上线流程、账、税、保险和事故、收车、公司架构 |
| [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md) | 所有 [待确认] 项、上线前人工事项，以及带去问 broker、财政部、会计师、律师的问题清单 |
| 本文件 | 计划怎么落到 TATO 上：哪些现成、哪些要新做、按什么顺序 |

业务规则以 business-model.md 为准；它和 execution-plan.md 冲突时，按 business-model.md。

## 为什么放在 TATO 上做，而不是新开一个项目

计划第 4 节的技术栈是给一个全新应用写的（PostgreSQL、Auth.js、Vercel、next-intl）。
TATO 已经有其中大半：车主、车辆、电子合同、Stripe 收款和押金、拍照验车、发票、多语言、操作日志。
在 TATO 上做，试点期只需要补「月租」特有的那部分；技术栈沿用 TATO 的（Railway 上的 SQLite、TATO 自己的登录和 i18n），
不按计划第 4 节另起。

## 计划中的实体 ↔ TATO 已有的东西

| 计划（§5） | TATO 现在有 | 要补的 |
|---|---|---|
| User / Role | `User` + `Workspace`（多租户） | 租客不是 TATO 用户。试点期租客走公开网站加专属链接，不做租客账号 |
| OwnerProfile | `Owner`（分享链接或账号登录） | 收款方式：`lib/stripe-connect.ts` 已有 |
| Vehicle | `Vehicle` | 公允市场价值（现在只有 `purchasePrice`）、是否有贷款、转租同意书、月租价、每月里程上限、月租上线状态机（现在 `status` 只有 available / maintenance / inactive） |
| MasterLease | `OwnerCommissionRule` + 车主账本 + `ContractEnvelope` 电子签 | Master Lease 记录本身（分成模式、期限、签署文件） |
| RenterProfile / RentalApplication | 没有。直订只存一次性的客人信息和驾照上传（`DirectBookingDocument`） | 新建：租客资料、申请、审核、风险分级 |
| RentalContract | `Order`（直订）+ `ContractEnvelope` | 整月校验、续约链（`previousContractId`）、合同状态 |
| Invoice | `Invoice` / `InvoiceItem` | 每期账单挂到合同上，超里程费进下期 |
| Deposit | `lib/direct-booking-deposits.ts`、`stripe-refunds.ts` | 复用 |
| Inspection | `InspectionSession`（Walkaround 拍照）+ `TripHandover` | 月检（每月里程表照片） |
| Incident | 没有 | 新建：事故报告 → ICBC 报案 → 维修 → 结案 |
| MaintenanceRecord | `VehicleServiceRecord` | 复用 |
| Document | uploads、`OrderAttachment`、`DirectBookingDocument` | 复用存储，加证件种类 |
| PricingConfig | `BookingPricingPolicy`（只有满 7 天的周折扣） | 月租期限折扣分档 |
| TaxConfig | `taxLines`（统一税率） | PST 按车辆价值分档 |
| AuditLog | `ActivityLog`、`ContractAuditLog` | 复用 |
| Stripe Subscription / Identity | 一次性收款、Connect、退款 | 新接：按月自动扣款、身份核验 |

## 落地顺序（按 TATO 的现状重排计划第 6 节）

计划的 Phase 0、1 在 TATO 里基本已有，不重做。每一步做完都能单独验收、单独上线。

| 步 | 内容 | 对应计划 | 动 schema |
|---|---|---|---|
| 1 | 月租规则的纯函数：整月校验、续约日期、期限折扣、PST 分档、月度账单金额。带单元测试（`npm test`） | Phase 5 定价引擎 + §2.3 规则 | 否 |
| 2 | 配置表：期限折扣、PST 分档、押金倍数、逾期天数、里程上限，管理页可改 | §2.4、Phase 4–6 的配置项 | 是 |
| 3 | 车辆月租上线：新字段、状态机、贷款车必须有转租同意书、车主 PST 号（如需要）、管理员标记保单已生效 | Phase 2 | 是 |
| 4 | Master Lease：记录 + 用现有电子合同签署（模板只放占位符） | Phase 2 | 是 |
| 5 | 公开月租页 + 租客申请（证件上传、勾选不做网约车） | Phase 3 | 是 |
| 6 | 审核队列：许可到期早于租约结束则阻止批准、锁车 48 小时 | Phase 4 | 是 |
| 7 | Sublease 合同 + 签约收押金和首月 | Phase 5–6 | 是 |
| 8 | 按月扣款、账单、逾期处理、还车退押金 | Phase 6 | 是 |
| 9 | 月检、续租、事故、维护提醒 | Phase 7 | 是 |
| 10 | 车主月结单、ICBC 车队清单、税务报表、运营看板 | Phase 8 | 否 |
| 11 | 上线检查清单（对应 OPEN_QUESTIONS 第二节） | Phase 9 | 是 |

## 和其他 TATO 会话的交界

月租横跨了现有几个领域：车辆和车主归「运营 · 订单 · 底座」，价格、Stripe、合同归「租车网站 · 定价 · 收款」，拍照归「Walkaround」。
设想：月租自己的代码放进新文件（`lib/monthly-*`、`app/(admin)/monthly/`、`app/api/monthly/`），
需要给 `Vehicle`、`Owner` 加列或改别人的文件时，先在对应会话里说一声。

月租登记在 [`docs/看板.md`](../看板.md) 的 T3。2026-11-14 定为单独的领域会话「TATO · SpeedX 月租」（Kevin：「新文件归月租」），
归它的有 `docs/speedx-monthly/`、`lib/monthly-*`、api `monthly`、页面 `monthly`；动已有文件按根目录 `CLAUDE.md` 的交界规则先说一声。

## 进度

| 日期 | 做了什么 |
|---|---|
| 2026-10-30 | 需求文件从 Downloads 移到这里；建立索引、待确认清单和 TATO 对照 |
| 2026-10-30 至 11-10 | 讨论业务模式：车主上线流程、lessee 的法律依据、事故和拒赔、收车、公司架构、Fleetplan 取舍 |
| 2026-11-11 | 按 BC 财政部公告核对 broker 的两条说法：出租车辆一般要注册 PST；GST 一般不用注册、ICBC 不收 GST |
| 2026-11-14 | 讨论结论写成 business-model.md，待确认清单补上要问各方的问题。Codex 复核后核实原文并更正：私人车主的车很可能进不了 Fleetplan；车主可能因只做免税租赁而不用注册 PST；Kevin 的租约很可能不用 PPR 登记；2 月单月合同要收 PVRT；出事必须通知 ICBC |
| 2026-11-14 | 第 1 步：`lib/monthly-rules.ts` 纯函数 + `tests/monthly-rules.test.ts`（15 项）。整月租期（计费锚点同 Stripe，月底起租按月底计费，续租沿用原锚点）、期限折扣、押金倍数、PST 分档（PST 116 表 1 只作参考常量）、超里程费、每期账单、逾期分级。金额用分，税率和倍数用基点。Kevin 未定的数全部走配置，测试里是示例值。核实 PST 116 第 20 页：PVRT 不收 PST、要收 GST。Codex 审两轮 |
