# SpeedX Monthly — 业务模式（讨论稿）

最后更新：2026-11-14。来源：2026-10-30 至 11-14 的讨论，法规和公告逐条核对过原文（见文末「来源」）。

这**不是**法律、税务或保险意见。标 **【待确认】** 的地方，答案取决于 broker、BC 财政部、会计师或律师；
要问的问题按人列在 [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md) 第四节。文中的金额凡是标「假设」的，只是为了把账算通。

---

## 1. 谁在这件事里

| 角色 | 举例 | 身份 |
|---|---|---|
| 车主 | Kevin（私人车主），车 A，公允市场价值 $10,000 | 把车以书面租约**长期租给** SpeedX Monthly，按月收租金 |
| 运营方 | SpeedX Monthly（新设，见第 8 节） | 车辆登记上的 **lessee**，以自己名义投保；再把车整月**转租**给租客 |
| 租客 | 小林，留学生，持 BC 驾照或外国驾照 | **sublessee**，不用写进保单，受法规保障（见第 2 节） |
| 软件 | TATO | 只提供系统，**不进合同、不过手资金**。钱直接进运营方的 Stripe；TATO 向运营方收软件费 |

TATO 是平台，SpeedX 是第一个客户。以后卖给别的公司，同样是「运营方签合同、收钱、担风险，TATO 只卖软件」。

## 2. 法律结构的依据（已核对原文）

| 规则 | 出处 | 对这个模式意味着什么 |
|---|---|---|
| **leased vehicle**：以书面协议租赁、期限不少于一个月的车。**lessee**：以书面协议承租不少于一个月，**并在车辆登记里被列为 lessee** 的人 | Motor Vehicle Act s.1 | Kevin 和 SpeedX 之间**必须**有书面租约，且登记上要写 SpeedX 是 lessee。只签「代租分成协议」不行 |
| 申请租赁车的保险证书时，车主名后写「lessor」，承租人名后写「lessee」，并写承租人在 BC 的地址；车辆登记里列 lessee 的规定在 Motor Vehicle Act s.3 | Insurance (Vehicle) Regulation s.8 | 所有权不变，车还是 Kevin 的 |
| 车主保单的保障延伸到「保单上登记的 lessee 的 sublessee 及其家人」 | Insurance (Vehicle) Regulation s.53(1)(a) | 小林以 sublessee 身份受保，不用加名字。前提是驾照有效、用途符合保单 |
| fleet = 至少 5 辆、登记在**同一个人**名下，或**从以租车为业的人那里**租来、租给同一个人的车；母公司和子公司可以合成一个车队；车辆还要属于 ICBC 指定的费率类别 | Insurance (Vehicle) Regulation s.155；Basic Tariff §2.D.1 | **Kevin 不是以租车为业的人，他租给 SpeedX 的车很可能算不进 SpeedX 的车队**，只能单车投保。公司自有车、从租赁公司租来的车可以算。SpeedX Studio 把自有车租给 Monthly 时，Studio 算不算以租车为业 **【待确认：broker】** |
| 租赁车不能算进出租方的车队，符合 s.155 的可以算进承租方的车队；申请车队必须包含**所有**符合条件的车；超过 19 辆合资格车辆**必须**申请 | 同上 s.156；Basic Tariff §2.D.1 | 一旦加入，名下所有符合条件的车都得进来 |
| 车队运营方视为车主的代理人，对 ICBC 同等负责 | 同上 s.161 | 母公司做车队运营方，就要对整个车队负责 |
| ICBC 的 P2P blanket 保单只适用于不满一个月的出租 | Insurance (Vehicle) Regulation Part 11 Div 3（执行计划 §2.1） | 每份转租合同至少一个完整日历月；不能用短合同拼长租 |

**对执行计划的修正：** 执行计划 §2.2 写「Fleetplan 车队保险，≥5 辆车」，好像不够 5 辆就做不了。实际上这个模式依赖的是「书面租约 + 登记 lessee」，
Fleetplan 只是一种按车队整体出险记录算保费的方案：5–19 辆可以自愿加入，超过 19 辆必须加入（Basic Tariff §2.D.1）。
而且按 s.155，**私人车主租来的车很可能根本进不了车队**，每辆都以 SpeedX 作为 lessee 单车投保。所以月租的主力车源（私人车主的车）本来就不走 Fleetplan。

**租金可以按分成算。** Master Lease 的租金条款可以写成固定、分成（当月转租收入 × X%，空置月为 0）或混合（保底 + 分成）。
效果和分成协议一样，法律上仍是 lease。「空置月租金为 0」的租约能否被 ICBC 和税务认可为真实租赁 **【待确认：律师】**。

## 3. 车主上线流程（以 Kevin 和车 A 为例）

**第一阶段：去 ICBC 之前**

1. **查产权**：车是否只登记在 Kevin 一人名下（共同登记要所有人签字）；有贷款或 lease 的，先拿贷款方的书面转租同意书；没有未缴罚单或 ICBC 欠款。
2. **确认 Kevin 要不要注册 PST 号**（见第 5 节）。出租车辆一般要注册，但只做免税租赁的出租方可以不注册，Kevin 可能属于后者 **【待确认：财政部】**。要注册的话，eTaxBC 网上申请，个人可以注册，不收费，之后按期申报。
3. **SpeedX 先拿保险报价**：费率类别、第三者责任额度、Collision 和 Comprehensive 自付额，确认允许整月转租给个人。**报价确认之前，Kevin 不要取消自己的保险。**
4. **签 Master Lease**（律师模板）：期限，明确允许转租；租金方式；保险由 SpeedX 负责且必须买 Collision；Kevin 不承担自付额和保险不赔的部分；保养由谁负责、用哪家修车厂；授权 SpeedX 代 Kevin 收车、报警、理赔；提前退出的通知期，出租中的车不能中途收回；还车车况标准；双方书面确认公允市场价值 $10,000。
5. **交车验车**（SpeedX Auto）：安全检查、基准照片、里程、现有划痕、轮胎刹车，双方签字。
6. **PPR 登记很可能不需要**：Personal Property Security Act 里「超过一年的租约」不包括出租方不以出租为业的租约，Kevin 的 Master Lease 很可能不在其中（见第 7 节）**【待确认：律师】**。

**第二阶段：在 Autoplan broker 一次办完**

7. 带齐材料：Kevin 的身份证件、现有登记和保险单；SpeedX 的公司注册证明、签字人授权和身份证件、BC 营业地址；签好的 Master Lease；贷款方同意书（如有）；双方的 PST 号，或 SpeedX 的转租免税证明（FIN 490）。Kevin 去不了的话，问能否用授权书代办。
8. **改登记**：Kevin（lessor）+ SpeedX（lessee）。这不是过户。
9. **换保险，同一次办完，中间不能断保**：Kevin 的个人保单取消，按比例退保费；SpeedX 作为保单持有人投保，填车队编号（如有）。
10. **车牌**：lessee 同时是车牌持有人。沿用原车牌还是 Kevin 留着自用、SpeedX 另领 **【待确认：broker】**。
11. 拿回新登记和保险单，复印件给 Kevin。

**第三阶段：之后**

12. 交全部钥匙、手册、保养记录、冬胎；Kevin 清空私人物品，退出车机账号和蓝牙配对。
13. Kevin 个人的无事故年数和折扣保留，以后可以用；保留多久 **【待确认：broker】**。之后的事故记在 SpeedX 的保单上。
14. 在 TATO 登记车辆、租约、验车照片、保单、同意书，车 A 进入「可出租」。

**退出时反过来做**：提前通知 → 等当前租客合同结束 → 还车验车 → broker 处去掉 lessee、SpeedX 保单取消、**Kevin 当天重新投保** → 撤销 PPR 登记（如有）。

最容易出错的是第 3 步还没确认保险就先取消 Kevin 的保险，车会有几天没人投保。

## 4. 租客流程和一个月的账

**流程**：选车和租期（1–12 个月）→ 证件上传和身份核验 → 签字确认不跑网约车、遵守里程上限 → SpeedX 审核（许可到期早于租约结束就拦下；人工评定风险等级和押金）→ 锁车 48 小时 → 签 Sublease、付押金和首月 → 交车验车 → 每月自动扣款、月底上传里程照片 → 到期前 30 天提醒续租（新合同从旧合同结束次日开始）或还车验车、结算押金。

**车 A 一个月的账（6 个月租期，全部是假设）**

| 项目 | 金额/月 |
|---|---|
| 租客付（税前），6 个月档九折 | $990 |
| − 保险 | −$300（最大的未知数，等 broker 报价） |
| − 给 Kevin（固定模式） | −$350 |
| − 保养预留 | −$60 |
| − Stripe 手续费 | −$32 |
| − TATO 软件费 | −$29 |
| **SpeedX 毛利** | **≈ $219** |

租客另付 PST 7%（$69.30）和 GST 5%（$49.50），是代收代缴，不算收入。

**空置是关键**：没租出去的月份，保险照付，固定模式下还要付 Kevin，一个月亏约 $650。分成模式决定空置风险由谁承担：

| 模式 | Kevin 拿 | 空置风险 |
|---|---|---|
| 固定月租 | 每月固定额 | 全在 SpeedX |
| 收入分成 | 转租租金的 35–40%，空置月为 0 | 双方分担 |
| 混合 | 保底 + 小比例分成 | 大部分在 SpeedX |

试点期倾向分成或低保底混合，跑出真实出租率再改。

## 5. 税（2026-11-11 按 BC 财政部公告核对，11-14 经 Codex 复核后修正）

| 税 | Kevin → SpeedX | SpeedX → 小林 |
|---|---|---|
| **PST** | 在 BC 出租车辆一般要注册 PST（PST 001），出租方不能按小商户免注册（PST 003）。但 SpeedX 是**专门为转租而承租**，这笔租赁免 PST（PST 116：SpeedX 给 PST 号或 FIN 490 免税证明），Kevin 这一层收 0；而**只出租免税物品的出租方不用注册**（PST 法 s.169(2)(b)）。两条合起来，Kevin 可能不用注册 **【待确认：财政部，最先问】** | 车值低于 $55,000 按 7%，按每期租金收（PST 116 表 1）。PVRT（每天 $1.50）适用于 28 天及以下的租期：**非闰年 2 月的整月合同正好 28 天，要收**；其他整月合同都超过 28 天，不收。PVRT 本身不收 PST，但要收 GST（PST 116 第 20 页） |
| **GST** | Kevin 若没有别的应税业务，年租金远低于 $30,000，一般是小供应商、不用注册；要把他全部应税收入和关联方一起算 **【待确认：会计师】** | SpeedX 收 5% |
| **加 lessee 时** | 不是过户，不按私人买卖交 PST；ICBC 不收 GST。broker 说出租方没有 PST 号就要按车值一次性交 PST。我们找到的依据（PST 116 第 18 页、车队登记指南）讲的都是**外省租入**的车，不能直接套到 BC 本地车上 **【待确认：财政部】** | — |

如果真要一次性交：按 PST 116 表 1 的租赁税率，$10,000 的乘用车是 7%，约 $700（12% 是私人买卖的税率，不适用于租赁）。

**2026-11-11 broker 的两条说法核对结果：**

| broker 说 | 结果 |
|---|---|
| 个人要有 PST 号和 GST 号才能把车租给公司 | PST 号：**一般情况下对**，但出租给为转租而承租的公司可能是免税租赁，Kevin 可能不用注册（待确认）。GST 号：**一般不对**（小供应商不用注册）。「不能租」说过头了 |
| 加 lessee 时要交全部 PST 加 GST | GST：**不对**（ICBC 不收）。PST：BC 本地车的情况没找到直接依据，待财政部确认 |

**还没定的：**

- 上面两处「待确认：财政部」，以及个人只把一台车租给一家公司算不算「ordinary course of business」。
- **股东的个人车要小心 GST**：小供应商门槛要合并关联方的收入。能控制 SpeedX Monthly 的股东把车租给它，可能不再是小供应商，要注册 GST **【待确认：会计师】**。
- 月租的最短租期是一个完整日历月；2 月的单月合同要收 PVRT，定价和合同模板要考虑这一点。
- **不要用「代管 + PST 指定代理协议（FIN 406）」绕开车主注册**：那样 SpeedX 不是 lessee，第 2 节 s.53 的转租人保障就不成立了。

## 6. 保险和事故

**先看车走哪种保险**：按第 2 节，私人车主租来的车很可能进不了 Fleetplan，只能单车投保；公司自有车才涉及 Fleetplan。

**Fleetplan 怎么算保费**：看整个车队过去 **3 年**的赔付率（有责事故赔付 ÷ 打折前保费），不看谁开的车。赔付率越低折扣越大，ICBC 写最高 63%；赔付率高就加费。
分档表、各险种计入上限、大额损失的特殊规则都在 Basic Tariff 的 Schedule I 和 §2.D.7 **【待确认：broker 解读】**。

**谁的记录受影响（更正）：**

| 车的保险方式 | 有责事故算在谁头上 |
|---|---|
| 在 Fleetplan 里 | 只算车队赔付率，**不影响司机个人保费** |
| 不在 Fleetplan 里 | 可能影响司机个人和列有该司机的其他非车队保单；ICBC 写明影响**取决于费率类别**等条件 |

早先说「小林有 BC 驾照，有责事故会记到小林个人记录」，在 Fleetplan 下是错的。单车投保的转租车，保单上的「司机」怎么认定、租客的事故算租客还是算 SpeedX，ICBC 页面没写到租赁的情况 **【待确认：broker，最先问】**。
私人车主的车本来就单车投保，如果答案是「跟着租客走」，租客出事就不会推高公司车队的保费，这正是我们想要的。

**用假设数字示意一次事故的冲击**（每台车年保费 $3,600，一次 $30,000 的有责事故，简单相除；Schedule I 对各险种计入金额有上限，实际评级用的赔付率会更低）：

| | 3 年保费 | 简单赔付率 |
|---|---|---|
| 20 台车一个车队 | $216,000 | 14% |
| 5 台车一个车队 | $54,000 | 56% |

道理不变：车队越小，一次事故的冲击越大。最贵的通常是人伤，不是车损，车 A 撞烂最多赔 $10,000。

**能挡住保费上涨的办法：**

1. **小事故自费修、不索赔**：小刮蹭在 SpeedX Auto 按成本价修，从押金里扣。但出事后**及时书面通知 ICBC 的义务仍要遵守**（Insurance (Vehicle) Regulation s.73），不能用「不报案」来省保费。通知但不索赔会不会计入记录 **【待确认：broker】**。
2. **理赔还款**：把 ICBC 已赔的金额还回去，可以不计入评级；ICBC 写明车队车主同样适用。但要满足条件（确认不会再赔付、还没被用来算保费等，见 Basic Tariff Schedule I）**【待确认：broker】**。
3. Sublease 写明有责事故由租客承担自付额，另加一笔固定的「保费影响费」，从押金扣（金额 **【待确认：律师】**）。
4. 按风险等级定价和定押金。
5. 提高 Collision 自付额。
6. 审核、GPS、里程监控；ICBC 的 Fleetplan 另有 telematics 项目。

**Collision 必须买**，并写进 Master Lease，否则租客撞坏车 A，Kevin 的车就没人赔。

**租客违规用途（比如偷跑网约车）导致拒赔：**

| 受损方 | 一般会怎样 | 最终谁承担 |
|---|---|---|
| 被撞的第三方 | Basic 第三者责任通常先赔受害人，再向违约的人追讨 | 小林 |
| 车 A 自己 | Collision 拒赔 | 合同链：小林 → SpeedX；Master Lease 承诺 Kevin 不承担，所以追不回来的落在 SpeedX |
| 车队记录 | 可能计入赔付率；追讨回来的钱会不会冲减 **【待确认：broker】** | SpeedX |

SpeedX 不知情时会不会连带失去保障：安大略省判例（Pridmore v Drenth, 2023）倾向不会，BC 的对应条文没找到 **【待确认：律师】**。
防范：签字确认加违约金；里程上限（跑网约车每月常见 3,000–5,000 km）；GPS 轨迹；每月里程照片。

## 7. 违约和收车

- **可以收车**：车从来不属于租客。Sublease 写明逾期 X 天终止合同、SpeedX 有权收回。
- **用持牌 bailiff**：BC 的收车由 Consumer Protection BC 发牌的 bailiff 执行，按合同违约收车不需要法院命令。自己去拖车，起冲突可能被认定违法。
- **SpeedX 不是车主**：收车权来自 Sublease（对租客）和 Master Lease（Kevin 授权 SpeedX 代他收车、报警）。
- 合同终止后拒不还车可以报警，但警察常说是民事纠纷；终止通知、催告记录、GPS 位置越完整越好。
- 远程锁车：只能在停车时禁止启动，绝不能行驶中断油；在 BC 是否合法 **【待确认：律师】**。
- **PPR 登记（11-14 更正）**：BC 的 Personal Property Security Act 下，「超过一年的租约」的出租方要在 Personal Property Registry 登记，否则承租方破产时车可能被破产受托人拿走（Re Giffen, 1998，凭记忆引用 **【待确认：律师核对】**）。但这个定义：
  - **不包括出租方不以出租为业的租约**（s.1 定义 (d)）。Kevin 是私人车主，他的 Master Lease 很可能不在其中，不用登记 **【待确认：律师】**。
  - **包括**可续租且总期限可能超过一年的租约，以及承租人连续占有超过一年的租约（s.1 定义 (b)(c)）。SpeedX 是以出租为业的，对同一租客连续续租超过一年时可能被算进去，单份合同不超过 12 个月并不能自动避开。SpeedX 要不要为长期租客登记 **【待确认：律师】**。

## 8. 公司架构（建议）

**现状**：SpeedX Auto 只做修车；SpeedX Studio 做 Turo 和租车运营，名下约 20 台公司自有车，代管约 60 台车主托管车，另有股东个人车托管。

**问题**：月租放进 Studio 的话，公司自有车改做月租后的出险会拖累 Turo 车的保费（车队赔付率合并）；Studio 约 20 台车可能已到强制加入 Fleetplan 的门槛（Basic Tariff §2.D.1：超过 19 台合资格车辆必须申请，哪些车合资格问 broker）；月租的合同风险（不还车、违规拒赔、对车主的赔偿）保险不管，会动用 Studio 的资产。

**推荐：**

```
              股东（按现有比例直接持股）
        ┌──────────┼──────────────┐
   SpeedX Auto   SpeedX Studio         SpeedX Monthly（新设，只设一家）
     修车       Turo + 托管 + 自有车      月租：lessee + 转租
```

- **Monthly 是 Studio 的兄弟公司，不是子公司**：s.155 下母子公司的车可能被要求合并成一个车队，兄弟公司没有母子关系。股东相同的兄弟公司会不会被合并 **【待确认：broker】**。
- **现在不设控股公司。** 控股公司真正的好处是公司间分红一般可以免税收取（有 s.55(2) 等限制，问会计师）、把利润搬离风险，要等有可观的留存利润才用得上；而且控股公司作为几家公司的共同母公司，反而可能让 ICBC 把它们看成一个集团。以后需要时，常见做法是**每个股东各设一家个人控股公司**，用免税转让（Section 85）把股份转进去，现在不设不吃亏。
- **不要拆成很多小公司分摊车辆**：子公司会被合并；车队越小一次事故冲击越大，长期总保费仍跟着总赔付走；每家公司每年都有固定成本；同一批人控制、同一套员工，ICBC 可能按实际控制合并 **【待确认：broker】**。最多在 broker 确认兄弟公司可以各自计费后，按风险分两池。
- Monthly 的启动资金由股东按比例直接投入，**不要由 Studio 借给 Monthly**，否则两家又被债务绑在一起。Monthly 单独签股东协议（分工、追加资金、退出）。
- 公司之间签服务协议、按合理价格结算；各自有银行账户、Stripe、PST/GST 号；合同用正确的公司名义签；股东个人不给 Monthly 的债务做担保。
- **Fleetplan**：Monthly 的车大多是私人车主租来的，很可能进不了车队，单车投保。只有公司自有车（或 Studio 租给它的车，待确认）可能凑成车队；不到 20 台时先让 broker 算「加入」和「不加入」两种报价再定。
- **结构解决不了的**：超出保额的赔偿（Monthly 第三者责任买 $2M–$5M）；董事和股东本人的过失；ICBC 按实际控制和用途认定。

每家公司对应 TATO 的一个工作区，账目天然分开。将来别的公司用 TATO 做月租，「运营公司和月租公司分开」可以作为推荐方案。

## 9. 对执行计划的修正汇总

| 执行计划 | 修正 |
|---|---|
| §1.3 运营主体待定 | 建议新设 SpeedX Monthly，股东直接持股，和 Studio 并列 |
| §2.2「Fleetplan ≥5 辆」 | 不是必要条件，必要的是书面租约 + 登记 lessee；而且私人车主租来的车很可能根本进不了车队（s.155），单车投保 |
| §2.4 税 | 补上车主这一层：SpeedX 用转租免税；车主一般要注册 PST，但只做免税租赁可能不用（待确认）；GST 车主一般不用注册；2 月的单月合同要收 PVRT |
| §3 角色 | 试点期租客不做 TATO 账号，走公开网站加专属链接（见 [README.md](README.md)） |
| §4 技术栈 | 沿用 TATO 现有技术栈（见 [README.md](README.md)） |
| §7 第 3 项「决定运营主体」 | 见第 8 节，等会计师和律师确认 |

## 来源

- [Motor Vehicle Act s.1（leased vehicle、lessee 的定义）](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/96318_01)
- [Insurance (Vehicle) Act s.1](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/96231_01)
- [Insurance (Vehicle) Regulation 全文（s.8、s.53）](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/447_83_00_multi)
- [Insurance (Vehicle) Regulation Part 12 — Fleets（s.155–161）](https://free.bcpublications.ca/civix/document/id/complete/statreg/447_83_12)
- [ICBC — Fleetplan](https://icbc.com/fleetplan)
- [ICBC — Drivers of fleet or business vehicles](https://icbc.com/insurance/commercial/drivers-fleet-or-business-vehicles)
- [ICBC — If you are responsible（理赔还款）](https://icbc.com/claims/crash-responsibility-fault/If-you-are-responsible)
- [ICBC — Insurance for leased vehicles](https://icbc.com/insurance/buy-renew-cancel/insurance-leased-vehicles)
- [ICBC — Repossess or seize a vehicle](https://icbc.com/vehicle-registration/sell-vehicle/Repossess-or-seize-a-vehicle)
- [ICBC Basic Tariff](https://www.icbc.com/assets/en/6PyY5DEcoIT7z2ujjlwb3d/basic-tariff.pdf)
- [ICBC Transfer/Tax Form APV9T](https://assets.ctfassets.net/ways6qm8tbfw/26ENfCHcoA8qj6fV8zCFjT/2dbe404125612c873bba42b8529c5308/APV9T.pdf)
- [Personal Property Security Act s.1（lease for a term of more than one year）](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/96359_01)
- [PST Act Part 8 解释（s.169 只做免税销售或租赁的不用注册）](https://www2.gov.bc.ca/gov/content/taxes/tim/pst/parts/pt-8)
- [CRA — When to register for and start charging GST/HST](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/when-register-charge.html)
- [PST 001 Registering to Collect PST](https://www2.gov.bc.ca/assets/gov/taxes/sales-taxes/publications/pst-001-registering-to-collect-pst.pdf)
- [PST 003 Small Sellers](https://www2.gov.bc.ca/assets/gov/taxes/sales-taxes/publications/pst-003-small-sellers.pdf)
- [PST 116 Motor Vehicle Dealers and Leasing Companies](https://www2.gov.bc.ca/assets/gov/taxes/sales-taxes/publications/pst-116-motor-vehicle-dealers-leasing-companies.pdf)
- [PST 308 PST on Vehicles](https://www2.gov.bc.ca/assets/gov/taxes/sales-taxes/publications/pst-308-vehicles.pdf)
- [Canadian Automotive Fleet 2021 Licensing Guide（BC 部分）](https://www.wheels.com/wp-content/uploads/2021/05/2021-Canadian-Automotive-Fleet-Guide.pdf)
- [TaxTips — GST small supplier](https://www.taxtips.ca/gst/small-supplier.htm)
- [Pridmore v Drenth, 2023 ONCA 606 评论](https://www.mondaq.com/canada/insurance-laws-and-products/1403178/nature-of-consent-and-timing-of-a-breach-matters-owner-of-motor-vehicle-granted-coverage-as-breach-of-statutory-condition-did-not-occur-at-time-of-accident-pridmore-v-drenth-2023-onca-606)
- [Clicklaw — Bailiffs and Sheriffs](https://wiki.clicklaw.bc.ca/index.php/Bailiffs_and_Sheriffs)
- [People's Law School — When a creditor wants to repossess](https://www.peopleslawschool.ca/everyday-legal-problems/money-debt/dealing-debt/creditor-wants-repossess-your-property)
