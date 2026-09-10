/**
 * Strings for the public rental-income estimator at /rental-estimate.
 *
 * Every value here is a plain string — no getters — because the whole
 * block is handed to a client component, and function values do not
 * survive the RSC boundary (see the note in `contact.ts`). Anything
 * that needs a number substituted uses a `{token}` placeholder and is
 * filled in on the client by `fill()`.
 */
export const rentalEstimateMessages = {
  en: {
    rentalEstimate: {
      metaTitle: "What could your car earn? · TATO",
      metaDescription:
        "Estimate what your car could earn on Turo in Vancouver, month by month, from 5,789 real trips run by TATO.",

      kicker: "Vancouver · Lower Mainland",
      title: "What could your car earn?",
      intro:
        "Pick your car and see twelve months of projected rental income — built from what our own fleet actually earned in this city, not a national average.",

      makeLabel: "Make",
      modelLabel: "Model",
      yearLabel: "Year",
      makePlaceholder: "Select a make",
      modelPlaceholder: "Select a model",
      modelNeedsMake: "Pick a make first",
      yearHint: "Turo Canada lists cars up to 12 years old — {oldest} and newer.",

      emptyTitle: "Choose a car to see the numbers",
      emptyCopy:
        "360 Canadian-market models are priced in, back to the oldest year Turo Canada will still list.",

      headlineLabel: "Projected first-year earnings",
      headlineRange: "Typically {low} – {high}",
      grossLabel: "Turo gross",
      netLabel: "You keep",
      commissionLabel: "TATO management share",
      commissionHint:
        "Drag to match the terms you're being offered. Your share is what lands with you before your own costs — insurance, financing, maintenance, depreciation.",

      chartTitle: "Projected monthly income",
      chartHint: "Bars are Turo gross. The darker section is your share.",

      statPeak: "Best month",
      statTrough: "Slowest month",
      statAverage: "Monthly average",
      statValue: "Estimated car value",
      statPeakRatio: "{ratio}× the slowest month",

      evidenceDirectTitle: "We run this model",
      evidenceDirect:
        "This estimate is anchored on {months} months of our own operating history for the {model}, on top of the fleet-wide pattern.",
      evidenceSegmentTitle: "Estimated from comparable cars",
      evidenceSegment:
        "We haven't run a {model} ourselves. The estimate comes from how cars of its value and body style perform across our fleet — the relationship that predicts held-out cars within 20% for {within} of them.",
      evidenceExtrapolated:
        "This car sits outside the value range we have operated, so treat the figure as a rough indication rather than a quote.",

      methodTitle: "How this is calculated",
      methodToggleOpen: "Show the method",
      methodToggleClose: "Hide the method",
      methodBasis:
        "Built from {trips} completed Turo trips across {vehicles} cars and {models} models, {from} to {to}, every one of them rented in Metro Vancouver.",
      methodPoint1Title: "Value sets the level — but weakly",
      methodPoint1:
        "Monthly earnings rise with what a car is worth at an elasticity of 0.42: double the value and earnings rise about 34%, not 100%. This is why inexpensive vans and pickups return more per dollar invested than luxury SUVs.",
      methodPoint2Title: "Body style shifts it again",
      methodPoint2:
        "At equal value, minivans and pickups earn about 9% above the fleet line, while luxury sedans come in 11% below it and EVs 17% below.",
      methodPoint3Title: "Vancouver's season is the biggest single factor",
      methodPoint3:
        "July and August run about 1.9× an average month; November runs about half of one. The same shape repeated in 2024, 2025 and 2026, which is why a single annual figure misleads and this page draws twelve bars.",
      methodPoint4Title: "Accuracy",
      methodPoint4:
        "Holding out one car at a time and predicting it from the rest: median error on the first-year total is {error}, and {within} of cars land within 20%. Individual months swing wider — one booking moves one month a lot.",

      assumptionsTitle: "What the estimate assumes",
      assumption1: "The car is listed and available essentially full-time, managed by TATO.",
      assumption2:
        "Pricing follows the dynamic rates we run today, including airport delivery where it applies.",
      assumption3:
        "Figures are gross rental income in Canadian dollars. They exclude insurance, financing, maintenance, cleaning, parking, depreciation and tax.",
      assumption4:
        "Past performance is not a promise. Demand, competition and platform terms all move.",


      statsBadge: "{trips} trips · {vehicles} cars · {from} – {to}",
    },
  },
  zh: {
    rentalEstimate: {
      metaTitle: "车辆租金预估 · TATO",
      metaDescription:
        "输入车型和年份，查看你的车在温哥华出租的未来 12 个月月度收入预估。基于 TATO 自营车队 5,789 笔真实订单。",

      kicker: "温哥华 · 大温地区",
      title: "你的车能赚多少？",
      intro:
        "选择车型，查看未来 12 个月的租金收入预估。数据来自我们自己的车队在温哥华的真实成交记录，不是全国平均值。",

      makeLabel: "品牌",
      modelLabel: "车型",
      yearLabel: "年份",
      makePlaceholder: "选择品牌",
      modelPlaceholder: "选择车型",
      modelNeedsMake: "请先选择品牌",
      yearHint: "Turo 加拿大只接受车龄 12 年以内的车，即 {oldest} 年及以后。",

      emptyTitle: "选择车型后显示预估结果",
      emptyCopy: "已收录 360 款加拿大在售车型，覆盖 Turo 加拿大允许上架的全部年份。",

      headlineLabel: "预计第一年收入",
      headlineRange: "通常在 {low} – {high} 之间",
      grossLabel: "Turo 平台总收入",
      netLabel: "车主到手",
      commissionLabel: "TATO 管理分成",
      commissionHint:
        "拖动以匹配你拿到的合作条件。「车主到手」是打给你的金额，尚未扣除你自己的成本——保险、贷款、保养、折旧。",

      chartTitle: "未来 12 个月月度收入预估",
      chartHint: "柱高为 Turo 平台总收入，深色部分为车主到手。",

      statPeak: "旺季月份",
      statTrough: "淡季月份",
      statAverage: "月均收入",
      statValue: "车辆估值",
      statPeakRatio: "是淡季的 {ratio} 倍",

      evidenceDirectTitle: "这款车我们在运营",
      evidenceDirect:
        "该预估基于我们自己运营 {model} 的 {months} 个「车-月」实际数据，并结合全车队规律校准。",
      evidenceSegmentTitle: "由同类车型推算",
      evidenceSegment:
        "我们没有运营过 {model}。该预估来自同等价值、同类车身的车辆在我们车队中的表现规律——这套规律在留一验证中，{within} 的车年度误差在 20% 以内。",
      evidenceExtrapolated: "这款车的价值超出我们实际运营过的区间，结果仅供参考，不构成报价。",

      methodTitle: "预估方法",
      methodToggleOpen: "查看计算方法",
      methodToggleClose: "收起计算方法",
      methodBasis:
        "基于 {trips} 笔已完成的 Turo 订单，覆盖 {vehicles} 台车、{models} 款车型，时间跨度 {from} 至 {to}，全部为大温地区实际出租记录。",
      methodPoint1Title: "车辆价值决定基准，但影响远小于直觉",
      methodPoint1:
        "月收入随车辆价值上升的弹性系数为 0.42：车价翻倍，收入只增加约 34%，而不是翻倍。这就是为什么便宜的 MPV 和皮卡的投资回报率高于豪华 SUV。",
      methodPoint2Title: "车身类型再做一次修正",
      methodPoint2:
        "在同等价值下，MPV 和皮卡比车队基准线高约 9%，豪华轿车低 11%，电动车低 17%。",
      methodPoint3Title: "温哥华的季节性是最大的单一变量",
      methodPoint3:
        "7、8 月约为平均月份的 1.9 倍，11 月只有一半左右。这个形状在 2024、2025、2026 三年完全重复出现——所以只给一个年度数字会误导，这个页面画 12 根柱子。",
      methodPoint4Title: "准确度",
      methodPoint4:
        "采用留一交叉验证（每次剔除一台车，用其余车辆预测它）：第一年总收入的中位误差为 {error}，{within} 的车落在 20% 误差以内。单个月份波动更大——一笔长租就能显著改变某个月。",

      assumptionsTitle: "预估的前提假设",
      assumption1: "车辆由 TATO 托管，基本全时段上架可租。",
      assumption2: "定价采用我们目前实际执行的动态价格策略，含适用情况下的机场送取车。",
      assumption3:
        "金额为加元计价的租金总收入，未扣除保险、贷款、保养、清洁、停车、折旧与税费。",
      assumption4: "历史表现不构成承诺。市场需求、同行竞争和平台政策都会变化。",


      statsBadge: "{trips} 笔真实订单 · {vehicles} 台车 · {from} 至 {to}",
    },
  },
} as const;
