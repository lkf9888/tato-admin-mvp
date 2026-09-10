/**
 * Strings for /investment-ranking. Plain strings only — the whole block
 * crosses into a client component, and function values do not survive
 * that boundary. `{token}` placeholders are filled on the client.
 */
export const investmentRankingMessages = {
  en: {
    investmentRanking: {
      metaTitle: "Which car to buy · TATO",
      metaDescription:
        "Rank vehicles by return on investment, from our own Vancouver rental history plus running costs.",

      kicker: "Vancouver · Return on investment",
      title: "Which car is worth buying?",
      intro:
        "Every eligible model and year, scored on what it would earn against what it costs to buy, run, repair and eventually sell. Ranked for a fixed budget.",

      budgetLabel: "Budget",
      budgetHint: "Used for the “how many” and total-return columns.",
      perspectiveLabel: "Whose return",
      perspectiveTato: "TATO buys the car",
      perspectiveOwner: "An owner partners with us",
      commissionLabel: "Management share",
      sortLabel: "Rank by",
      sortTotalRoi: "Total ROI",
      sortCashYield: "Cash yield",
      sortNetCash: "Annual net cash",
      sortBudgetReturn: "Return on the whole budget",
      priceRangeLabel: "Price range",
      minPrice: "Min",
      maxPrice: "Max",

      assumptionsToggle: "Cost assumptions",
      insuranceLabel: "Insurance / year",
      parkingLabel: "Parking / year",
      licensingLabel: "Licensing / year",
      assumptionsNote:
        "Per-car costs, so they weigh on cheap cars hardest. They are the reason the ranking does not simply say “buy the cheapest thing that still lists” — set them to what you actually pay.",
      resetAssumptions: "Reset to defaults",

      colRank: "#",
      colVehicle: "Vehicle",
      colPrice: "Price",
      colRevenue: "Revenue",
      colCosts: "Running costs",
      colNet: "Net cash",
      colRoi: "Total ROI",
      colRange: "Worst – best",
      colUnits: "Cars",
      colBudgetReturn: "Budget return",

      detailTitle: "How this number is built",
      detailRevenue: "Gross Turo revenue",
      detailCommission: "Less management share",
      detailMaintenance: "Scheduled maintenance",
      detailRepairs: "Expected repairs",
      detailFixed: "Insurance, parking, licensing",
      detailNetCash: "Annual net cash",
      detailDepreciation: "Depreciation",
      detailTotal: "Total annual return",
      detailKm: "Expected distance",
      detailPayback: "Payback on purchase price",
      detailPaybackYears: "{years} years",
      detailPaybackNever: "Never at this rate",
      detailPriceLabel: "Purchase price",
      detailPriceHint:
        "Modelled from age, brand and original list price. Paste what the car actually costs — the ranking is more sensitive to this than to anything else on the page.",
      detailPriceReset: "Use modelled price",
      detailEvidenceDirect: "We have run this model: {months} months of history.",
      detailEvidenceSegment: "No history for this model; estimated from comparable cars.",

      summaryScored:
        "{scored} model-years scored. {positive} return a profit as expected; {robust} still do in the worst case.",
      emptyTitle: "Nothing matches those filters",
      emptyCopy: "Widen the price range or raise the budget.",

      cautionTitle: "Read this before acting on the ranking",
      caution1:
        "Purchase prices are modelled, not quoted. They are the denominator of every number here — check a real price before buying.",
      caution2:
        "Repair costs come from published brand averages, not from our own invoices. They are the widest source of error, and the worst case is the one to plan against.",
      caution3:
        "Revenue assumes the car is managed by us and available essentially full-time, priced the way we price today.",
      caution4:
        "Buying several cheap cars beats one expensive one on paper. The page charges each car its own insurance and parking, but not your time.",
    },
  },
  zh: {
    investmentRanking: {
      metaTitle: "买哪台车 · TATO",
      metaDescription:
        "基于自有车队温哥华出租数据与运营成本，对车型投资回报率进行排名。",

      kicker: "温哥华 · 投资回报",
      title: "买哪台车最划算？",
      intro:
        "对所有可上架的车型和年份评分：能赚多少，对比买车、养车、修车和最终卖车的代价。按固定预算排名。",

      budgetLabel: "预算",
      budgetHint: "用于计算「可买台数」和「预算总回报」。",
      perspectiveLabel: "算谁的回报",
      perspectiveTato: "TATO 自己买车",
      perspectiveOwner: "车主与我们合作",
      commissionLabel: "管理分成",
      sortLabel: "排序依据",
      sortTotalRoi: "总回报率",
      sortCashYield: "现金回报率",
      sortNetCash: "年净现金",
      sortBudgetReturn: "整个预算的总回报",
      priceRangeLabel: "车价区间",
      minPrice: "最低",
      maxPrice: "最高",

      assumptionsToggle: "成本假设",
      insuranceLabel: "保险 / 年",
      parkingLabel: "停车 / 年",
      licensingLabel: "牌照等 / 年",
      assumptionsNote:
        "这些是每台车的固定成本，对便宜车的压力最大。正因为有它们，排名才不会退化成「无脑买最便宜的车」——请改成你实际支付的金额。",
      resetAssumptions: "恢复默认值",

      colRank: "#",
      colVehicle: "车型",
      colPrice: "车价",
      colRevenue: "年收入",
      colCosts: "运营成本",
      colNet: "年净现金",
      colRoi: "总回报率",
      colRange: "最坏 – 最好",
      colUnits: "台数",
      colBudgetReturn: "预算总回报",

      detailTitle: "这个数字是怎么算出来的",
      detailRevenue: "Turo 总收入",
      detailCommission: "减去管理分成",
      detailMaintenance: "常规保养",
      detailRepairs: "预期维修",
      detailFixed: "保险、停车、牌照",
      detailNetCash: "年净现金",
      detailDepreciation: "折旧",
      detailTotal: "年度总回报",
      detailKm: "预计行驶里程",
      detailPayback: "回本周期",
      detailPaybackYears: "{years} 年",
      detailPaybackNever: "按此速度无法回本",
      detailPriceLabel: "购车价",
      detailPriceHint:
        "由车龄、品牌和原始厂商指导价推算。建议填入你实际看到的报价——整个排名对这个数字的敏感度高于页面上任何其他输入。",
      detailPriceReset: "改用模型估值",
      detailEvidenceDirect: "这款车我们在运营：{months} 个「车-月」实际数据。",
      detailEvidenceSegment: "我们没运营过这款车，由同类车型推算。",

      summaryScored:
        "已评分 {scored} 个「车型+年份」组合。{positive} 个期望回报为正，其中 {robust} 个在最坏情况下仍为正。",
      emptyTitle: "没有符合筛选条件的车型",
      emptyCopy: "放宽车价区间或提高预算。",

      cautionTitle: "看排名之前，先看这几条",
      caution1:
        "车价是模型推算的，不是真实报价。它是所有数字的分母——买车前务必核对实际成交价。",
      caution2:
        "维修成本来自公开的品牌平均值，不是我们自己的维修单据。这是误差最大的一项，做决策请按「最坏情况」那一列考虑。",
      caution3: "收入假设车辆由我们托管、基本全时段可租，并采用我们目前的定价策略。",
      caution4:
        "账面上买几台便宜车一定胜过买一台贵车。页面已经给每台车计入了各自的保险和停车，但没有计入你的时间和精力。",
    },
  },
} as const;
