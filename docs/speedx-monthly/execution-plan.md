# SpeedX Monthly — 温哥华月租转租平台执行文件

> **给 Claude Code 的说明**
> 本文件是这个项目的唯一需求来源。请按「第 6 节 实施阶段」逐阶段实现，每个阶段完成后对照验收标准自测，再进入下一阶段。
> 遇到本文件标注为 **[待确认]** 的业务或法律规则时，**不要自行编造**。请做成可配置参数或占位符，并在代码注释和 `docs/OPEN_QUESTIONS.md` 中记录。
> 所有合同文本只生成**模板占位符**，最终条款由律师提供。

---

## 1. 项目概述

### 1.1 一句话定位
在大温哥华地区，把车主的车辆以「平台承租 → 按月转租」的方式租给**没有信用记录或 BC 驾驶记录的人群**（新移民、留学生、工签持有人、外派员工）。租期从 1 个月到 12 个月，可以续租，**月租已包含保险**，租期越长折扣越高。

### 1.2 核心价值
- 不查信用分（改为核实身份、收入或学业，并收押金）
- 保险包含在月租里，平台以 ICBC Fleetplan 车队方式投保，**保费不按租客个人驾驶记录计算**
- 灵活租期，可以续租，长租有折扣
- 支持中英双语

### 1.3 运营主体
- 运营公司：SPEEDX STUDIO LTD.（或另设的子公司，**[待确认]**）
- 现有资源：Turo 代管业务（车主资源）、自营修车厂（维护和定损）

---

## 2. 业务模型与法律结构（必须遵守的硬性规则）

### 2.1 为什么不用 P2P blanket 保险
- ICBC 的 P2P blanket 保单（APV383）只适用于**租期不满一个月**的出租（BC Insurance (Vehicle) Regulation 第 154.8 条）。
- ICBC 对 U-Drive 的定义也是不满一个月。
- **本平台所有租约最短为 1 个完整日历月，不提供日租或周租。**
- **禁止**用连续的短期合同拼成长租来套用 P2P 保险。

### 2.2 采用的结构
```
车主 ──(长期租赁合同 Master Lease)──▶ 平台公司（ICBC 保单上登记为 lessee）
平台公司 ──(按月转租合同 Sublease)──▶ 租客（sublessee）
平台公司 ──(Fleetplan 车队保险，≥5 辆车)──▶ ICBC
```
- 依据：BC Insurance (Vehicle) Regulation 第 8 条（租赁车辆登记 lessee）和第 53 条（车主保单对 sublessee 提供保障）。
- 平台需要在 ICBC 保单上登记为 lessee，具体操作由 broker 办理。**[待确认：费率类别、是否适用 Fleetplan]**

### 2.3 系统必须强制执行的规则
| 规则 | 系统实现 |
|---|---|
| 最短租期 1 个完整日历月 | 合同开始和结束日期校验；不允许少于 1 个月的合同或续约 |
| 续约必须无缝衔接 | 续约合同的开始日 = 上一份合同结束日的次日 |
| 禁止用于网约车（Uber/Lyft）或商业载客 | 合同条款 + 申请时勾选确认 |
| 每辆车上线前必须有车主贷款方或出租方的转租书面同意（如车辆有贷款或 lease） | 车辆状态机：没有同意书文件就不能进入 `AVAILABLE` |
| 只接受乘用车和 5,000 kg 以下的轻型车 | 车辆录入时校验 |
| 每份租约有每月里程上限，超出收费 | 定价参数 |

### 2.4 税费
| 税种 | 规则 | 系统实现 |
|---|---|---|
| GST | 5% | 可配置税率 |
| PST（乘用车租赁） | 按车辆价值分档，价值低于 $55,000 时为 7% **[待确认最新分档税率]** | 每辆车存储「首次出租时的公允市场价值」，按分档表计算 |
| PVRT（乘用车租车税 $1.50/天） | 只适用于 28 天或以下的租期 | 本平台租期均超过 28 天，**不收取**；如果将来加入短租功能，必须重新计算 |

> 税率表必须做成数据库配置表，不要硬编码。

---

## 3. 用户角色

| 角色 | 说明 |
|---|---|
| `RENTER` 租客 | 浏览车辆、提交申请、签合同、付款、续租、报告事故 |
| `OWNER` 车主 | 登记车辆、上传文件、签 Master Lease、查看收益报表 |
| `ADMIN` 运营人员 | 审核车主和租客、管理车辆、处理事故和维护、生成报表 |
| `SUPER_ADMIN` | 配置税率、定价参数、合同模板版本 |

---

## 4. 技术栈（建议，可调整）

- **前端 + 后端**：Next.js（App Router）+ TypeScript
- **数据库**：PostgreSQL + Prisma ORM
- **认证**：Auth.js（邮箱 + Google 登录），角色权限控制（RBAC）
- **支付**：Stripe（Subscriptions 月租扣款、押金、退款）；车主收款使用 Stripe Connect（Canada）或手动 EFT 导出
- **身份核验**：Stripe Identity（证件 + 自拍比对）
- **电子签名**：Dropbox Sign 或 DocuSign API（先做 adapter 接口，可替换）
- **文件存储**：S3 兼容存储（私有 bucket，签名 URL 访问）
- **邮件和短信**：Resend（邮件）、Twilio（短信）
- **多语言**：next-intl，支持 `en` 和 `zh-CN`
- **部署**：Vercel + 托管 PostgreSQL（如 Neon 或 Supabase）
- **测试**：Vitest（单元测试）+ Playwright（端到端测试）

所有外部服务通过 `lib/integrations/*` 下的 adapter 接入，开发环境使用 mock 实现。

---

## 5. 数据模型（Prisma 草案）

> Claude Code 可以根据实现需要调整字段，但下列实体和关键字段必须保留。

```prisma
enum Role { RENTER OWNER ADMIN SUPER_ADMIN }

model User {
  id            String   @id @default(cuid())
  email         String   @unique
  phone         String?
  name          String
  role          Role
  locale        String   @default("en")
  createdAt     DateTime @default(now())
  ownerProfile  OwnerProfile?
  renterProfile RenterProfile?
}

model OwnerProfile {
  id          String    @id @default(cuid())
  userId      String    @unique
  user        User      @relation(fields: [userId], references: [id])
  legalName   String
  payoutMethod String   // STRIPE_CONNECT | EFT
  vehicles    Vehicle[]
  leases      MasterLease[]
}

enum VehicleStatus {
  DRAFT            // 车主录入中
  PENDING_REVIEW   // 待平台审核
  NEEDS_DOCUMENTS  // 缺少文件（如贷款方同意书）
  APPROVED         // 审核通过，待签 Master Lease
  ONBOARDED        // Master Lease 已签，已加入 ICBC 车队保单
  AVAILABLE        // 可出租
  RESERVED         // 已有租客申请锁定
  RENTED           // 出租中
  MAINTENANCE      // 维护中
  OFFBOARDED       // 已退出平台
}

model Vehicle {
  id               String        @id @default(cuid())
  ownerId          String
  owner            OwnerProfile  @relation(fields: [ownerId], references: [id])
  vin              String        @unique
  plate            String?
  make             String
  model            String
  year             Int
  vehicleType      String        // 乘用车 / 轻型商用车
  gvwKg            Int?
  fairMarketValue  Decimal       // 用于 PST 分档
  hasLien          Boolean
  lienConsentDocId String?       // 贷款方或出租方的转租同意书
  odometerKm       Int
  monthlyBaseRate  Decimal       // 基础月租
  monthlyKmCap     Int           // 每月里程上限
  overageFeePerKm  Decimal
  depositAmount    Decimal
  status           VehicleStatus @default(DRAFT)
  photos           Document[]    @relation("VehiclePhotos")
  contracts        RentalContract[]
  inspections      Inspection[]
  maintenance      MaintenanceRecord[]
  incidents        Incident[]
}

model MasterLease {            // 车主 → 平台
  id               String   @id @default(cuid())
  ownerId          String
  vehicleId        String
  startDate        DateTime
  endDate          DateTime?
  payoutModel      String   // FIXED_MONTHLY | REVENUE_SHARE | HYBRID  [待确认]
  fixedMonthly     Decimal?
  revenueSharePct  Decimal?
  templateVersion  String
  signedDocId      String?
  status           String   // DRAFT | SENT | SIGNED | TERMINATED
}

model RenterProfile {
  id                String   @id @default(cuid())
  userId            String   @unique
  user              User     @relation(fields: [userId], references: [id])
  legalName         String
  dateOfBirth       DateTime
  licenceCountry    String
  licenceNumber     String   // 加密存储
  licenceExpiry     DateTime
  bcLicenceExchanged Boolean @default(false)
  statusInCanada    String   // CITIZEN | PR | WORK_PERMIT | STUDY_PERMIT | VISITOR | OTHER
  permitExpiry      DateTime?
  identityVerified  Boolean  @default(false)
  riskTier          String?  // A | B | C，由审核得出
  applications      RentalApplication[]
}

enum ApplicationStatus {
  SUBMITTED  ID_PENDING  UNDER_REVIEW  APPROVED  REJECTED  WITHDRAWN  EXPIRED
}

model RentalApplication {
  id              String   @id @default(cuid())
  renterId        String
  vehicleId       String
  requestedStart  DateTime
  termMonths      Int      // 1–12
  status          ApplicationStatus
  incomeProofDocId String?
  enrolmentDocId  String?
  permitDocId     String?
  reviewerId      String?
  reviewNotes     String?
  riskTier        String?
  createdAt       DateTime @default(now())
}

model RentalContract {          // 平台 → 租客（Sublease）
  id                  String   @id @default(cuid())
  vehicleId           String
  renterId            String
  applicationId       String
  previousContractId  String?  // 续约链
  startDate           DateTime
  endDate             DateTime
  termMonths          Int
  monthlyRate         Decimal  // 折扣后月租（税前）
  discountPct         Decimal
  monthlyKmCap        Int
  depositAmount       Decimal
  pstRate             Decimal
  gstRate             Decimal
  stripeSubscriptionId String?
  templateVersion     String
  signedDocId         String?
  status              String   // DRAFT | PENDING_SIGNATURE | ACTIVE | ENDED | TERMINATED_EARLY | DEFAULTED
}

model Invoice {
  id          String   @id @default(cuid())
  contractId  String
  periodStart DateTime
  periodEnd   DateTime
  rentAmount  Decimal
  overageKm   Int      @default(0)
  overageFee  Decimal  @default(0)
  pstAmount   Decimal
  gstAmount   Decimal
  total       Decimal
  status      String   // DRAFT | OPEN | PAID | OVERDUE | VOID
  stripeInvoiceId String?
}

model Deposit {
  id          String   @id @default(cuid())
  contractId  String
  amount      Decimal
  status      String   // HELD | PARTIALLY_APPLIED | REFUNDED
  deductions  Json?
}

model Inspection {              // 交车和还车检查
  id          String   @id @default(cuid())
  vehicleId   String
  contractId  String?
  type        String   // CHECK_OUT | CHECK_IN | MONTHLY
  odometerKm  Int
  fuelOrCharge Int?
  photos      Document[] @relation("InspectionPhotos")
  damageNotes String?
  performedBy String
  createdAt   DateTime @default(now())
}

model Incident {
  id            String   @id @default(cuid())
  vehicleId     String
  contractId    String?
  type          String   // COLLISION | THEFT | NON_RETURN | VANDALISM | OTHER
  occurredAt    DateTime
  policeReportNo String?
  icbcClaimNo   String?
  description   String
  status        String   // REPORTED | ICBC_FILED | IN_REPAIR | CLOSED
  documents     Document[] @relation("IncidentDocs")
}

model MaintenanceRecord {
  id          String   @id @default(cuid())
  vehicleId   String
  type        String
  odometerKm  Int
  cost        Decimal
  performedAt DateTime
  shop        String   // 默认自营修车厂
}

model Document {
  id          String   @id @default(cuid())
  ownerUserId String
  kind        String   // ID | LICENCE | PERMIT | INCOME | ENROLMENT | LIEN_CONSENT | REGISTRATION | CONTRACT | PHOTO | POLICE_REPORT | OTHER
  storageKey  String
  mimeType    String
  createdAt   DateTime @default(now())
}

model PricingConfig {           // 期限折扣
  id           String  @id @default(cuid())
  minMonths    Int
  maxMonths    Int
  discountPct  Decimal
  active       Boolean @default(true)
}

model TaxConfig {               // 税率表
  id          String   @id @default(cuid())
  taxType     String   // GST | PST_PASSENGER
  minValue    Decimal?
  maxValue    Decimal?
  rate        Decimal
  effectiveFrom DateTime
}

model AuditLog {
  id        String   @id @default(cuid())
  actorId   String
  action    String
  entity    String
  entityId  String
  diff      Json?
  createdAt DateTime @default(now())
}
```

---

## 6. 实施阶段

> 每个阶段完成后提交一次 commit，标题格式：`phase-N: <简述>`。

### Phase 0：项目初始化
- 建立 Next.js + TypeScript + Prisma + PostgreSQL 项目
- 配置 ESLint、Prettier、Vitest、Playwright
- 配置 next-intl（`en`、`zh-CN`），所有页面文案走翻译文件
- 建立 `lib/integrations/` adapter 结构，开发环境用 mock 实现
- `.env.example` 列出所有需要的密钥
- 建立 `docs/OPEN_QUESTIONS.md`，把本文件中所有 **[待确认]** 项列进去

**验收**：`npm run dev` 能启动；`npm test` 通过；中英文切换生效。

### Phase 1：认证与权限
- 邮箱和 Google 登录
- 四种角色与路由守卫（`/renter/*`、`/owner/*`、`/admin/*`）
- AuditLog 中间件：所有写操作自动记录

**验收**：不同角色只能访问自己的页面；越权请求返回 403 并写入日志。

### Phase 2：车主与车辆上线流程
- 车主注册，填写资料
- 车辆录入表单：VIN、品牌型号、年份、里程、照片、公允市场价值
- 有贷款或 lease 的车辆必须上传 `LIEN_CONSENT` 文件
- 管理员审核页：通过 / 退回补件 / 拒绝
- Master Lease 电子签署（模板 + 占位符）
- 车辆状态机，按第 5 节 `VehicleStatus` 实现，非法状态转换抛错
- 管理员手动标记「已加入 ICBC 车队保单」后，车辆才能进入 `AVAILABLE`

**验收**：没有转租同意书的贷款车无法上线；状态转换有单元测试覆盖。

### Phase 3：租客浏览与申请
- 公开车辆列表：筛选（车型、月租、可用日期），显示 1/3/6/12 个月的价格
- 租客申请流程：
  1. 选车、开始日期、租期（1–12 个月）
  2. 身份核验（Stripe Identity）
  3. 上传驾照（含外国驾照）、在加身份文件、收入证明或在读证明
  4. 勾选确认：不用于网约车、遵守里程上限
- 提醒：如果持外国驾照，提示 BC 的驾照转换要求 **[待确认具体时限和规则，只显示提示，不做硬性校验]**
- 申请状态通知（邮件 + 短信）

**验收**：完整申请流程端到端测试通过；未完成身份核验的申请不能进入审核。

### Phase 4：审核与风控
- 管理员审核队列
- 风险分级（A/B/C）是**人工评定**，系统只提供参考信息：身份核验结果、文件完整度、许可到期日与租期的关系
- **规则**：租客签证或许可的到期日早于租约结束日时，自动标红并阻止批准，除非管理员填写备注覆盖
- 按风险等级设置押金倍数（可配置，**[待确认具体倍数]**）
- 审核通过后锁定车辆（`RESERVED`），48 小时内未签约则自动释放

**验收**：许可到期规则有测试覆盖；锁车超时自动释放。

### Phase 5：定价与合同
- 定价引擎 `lib/pricing.ts`：
  - 输入：车辆基础月租、租期、风险等级
  - 输出：折扣后月租、押金、每月税额（PST 按车辆价值分档 + GST）、总价
  - 折扣按 `PricingConfig` 表查询，示例初始值 **[待确认]**：1–2 个月 0%，3–5 个月 5%，6–11 个月 10%，12 个月 15%
- 合同生成：从模板生成 Sublease，填入车辆、租客、价格、里程上限和押金
- 电子签署完成后，合同状态改为 `ACTIVE`，车辆状态改为 `RENTED`
- **校验**：合同期限必须 ≥ 1 个完整日历月

**验收**：定价引擎有完整单元测试，覆盖各个折扣档和 PST 分档的边界值；不足一个月的合同无法创建。

### Phase 6：支付与账单
- 签约时收取：押金 + 首月租金
- Stripe Subscription 每月自动扣款，每期生成 Invoice
- 月底根据还车检查或月检里程计算超里程费，加到下期账单
- 逾期处理：
  - 逾期 1 天：邮件 + 短信提醒
  - 逾期 3 天：管理员告警
  - 逾期 7 天：合同标记为 `DEFAULTED`，触发车辆回收流程（第 7 阶段）
  - 具体天数做成配置项 **[待确认]**
- 押金退还：还车检查完成后，扣除损坏和欠费，剩余部分退款

**验收**：用 Stripe 测试模式跑通「签约 → 3 期扣款 → 1 次逾期 → 还车 → 押金部分退还」完整流程。

### Phase 7：运营管理
- **交车和还车检查**：手机端友好的拍照检查表（车身四周、内饰、里程表、油量或电量），照片带时间戳
- **月检**：每月提醒租客上传里程表照片
- **续租**：合同到期前 30 天通知租客；续约生成新合同，`previousContractId` 指向旧合同，开始日为旧合同结束日次日，不允许中断
- **事故报告**：租客在 App 内报告，填写时间、地点、警察报告编号、照片；系统生成待办，提醒管理员向 ICBC 报案并记录理赔编号
- **不还车或失联**：从 `DEFAULTED` 或 `NON_RETURN` 事故触发回收待办，记录处理步骤
- **维护**：按里程或时间生成保养提醒，默认指派给自营修车厂
- **GPS**：只预留接口 `lib/integrations/gps.ts`，暂不接入具体供应商 **[待确认]**

**验收**：续约链无缝且有测试；事故从报告到结案的状态流可走通。

### Phase 8：报表
- **车主月结单**：每辆车的收入、平台分成、维护扣款、应付金额（按 Master Lease 的 payoutModel 计算）
- **ICBC 车队清单**：当前在保车辆列表（VIN、车牌、状态、加入日期），导出 CSV 给 broker
- **税务报表**：按月汇总 PST 和 GST 应缴金额
- **运营看板**：出租率、平均租期、逾期率、违约率、每辆车月均利润

**验收**：报表数字与测试数据手工核对一致。

### Phase 9：试点上线准备
- 上线检查清单页面（仅 SUPER_ADMIN 可见），列出第 7 节所有人工前置事项，全部勾选后才能关闭 `MAINTENANCE_MODE` 功能开关
- 隐私政策与服务条款页面（占位，由律师提供）
- 生产环境部署、数据库备份、错误监控（Sentry）

---

## 7. 上线前的人工前置事项（不是代码任务）

Claude Code 不需要实现这些，但系统上线前必须完成，并在 Phase 9 的检查清单中体现。

| # | 事项 | 负责人 | 状态 |
|---|---|---|---|
| 1 | 找商业保险 broker 确认：平台作为 lessee 转租车辆时的 ICBC 费率类别；能否使用 Fleetplan；转租人出事故时的保障范围；Optional 车损险和超额责任险报价 | 咖啡 | ☐ |
| 2 | 律师起草：Master Lease（车主 → 平台）、Sublease（平台 → 租客）、隐私政策、服务条款；确认 BC 消费者租赁合同的披露要求 | 咖啡 | ☐ |
| 3 | 决定运营主体（SPEEDX 或新设子公司），考虑两层控股结构下的风险隔离 | 咖啡 + 会计师 | ☐ |
| 4 | 办理 BC PST 登记（作为车辆出租方），确认 GST 登记 | 会计师 | ☐ |
| 5 | 设计车主贷款方或出租方的「转租同意书」模板 | 律师 | ☐ |
| 6 | 确定车主分成模式（固定月租 / 收入分成 / 混合） | 咖啡 | ☐ |
| 7 | 确定押金倍数、逾期处理天数、里程上限和超里程费 | 咖啡 | ☐ |
| 8 | 选定 GPS 供应商 | 咖啡 | ☐ |
| 9 | 招募首批 5–10 辆试点车辆（Turo 代管车主优先） | 咖啡 | ☐ |

---

## 8. 试点阶段的关键指标

试点期 6 个月，每月从报表中检查：
- 出租率（目标 **[待确认]**）
- 违约率和不还车事件数（**最关键的指标**）
- 每辆车月均净利润 = 租金收入 − 车主分成 − 保险 − 维护 − 坏账
- 平均租期和续约率

如果违约率过高或单车净利润为负，暂停扩张，先调整审核规则和押金。

---

## 9. 开放问题汇总

以下事项必须由人工确认，Claude Code 只做成可配置参数：

1. ICBC 费率类别与 Fleetplan 是否适用于平台转租的车辆
2. PST 乘用车租赁的最新分档税率
3. 期限折扣的具体百分比
4. 押金倍数与风险分级规则
5. 逾期处理的天数节点
6. 车主分成模式与比例
7. 每月里程上限与超里程费
8. 外国驾照转换 BC 驾照的规则提示文案
9. GPS 供应商
10. 运营主体公司

---

## 10. 参考依据

- BC Insurance (Vehicle) Regulation，Part 11 Division 3（P2P blanket 只适用于不满一个月的租期）、第 8 条（租赁车辆登记）、第 53 条（转租人保障）：https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/447_83_11
- ICBC Basic Insurance Tariff（Fleetplan 保费公式、P2P 日费率）：https://www.icbc.com/assets/pa/6PyY5DEcoIT7z2ujjlwb3d/basic-tariff.pdf
- ICBC Optional Policy Wording（U-Drive 定义为不满一个月）：https://www.icbc.com/assets/en/1Am2v2SW6tsvroaMBLWEd0/APG33N.pdf
- BC PST 小企业指南（PVRT 只适用于 28 天或以下的租期）
