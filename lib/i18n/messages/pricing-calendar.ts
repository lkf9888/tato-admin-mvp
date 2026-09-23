/** Strings for the per-day price calendar under Direct booking. */
export const pricingCalendarMessages = {
  en: {
    pricingCalendarPage: {
      kicker: "Price calendar",
      title: "Price individual days",
      copy:
        "A day priced here overrides everything else — the vehicle's own rate and the model's suggestion alike. Leave a day alone and it follows whatever the car charges.",
      baseRateLabel: "Base rate",
      aiPriced: "AI priced",
      weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as readonly string[],
      bookedTag: "booked",
      selectHint: "Tap the days you want to price.",
      selectedCount: (count: number) => `${count} day(s) selected`,
      applyAction: "Set price",
      clearAction: "Clear to base rate",
      deselectAction: "Deselect all",
      priceRequired: "Enter a price above zero, or use Clear.",
      saveFailed: "Those prices could not be saved. Please try again.",
      emptyFleet: "No vehicle has direct booking turned on yet.",
    },
  },
  zh: {
    pricingCalendarPage: {
      kicker: "价格日历",
      title: "按天单独定价",
      copy:
        "在这里定过价的那一天会覆盖其他一切——车辆自己的日价和模型建议价都一样。没动过的日子跟着车辆的价格走。",
      baseRateLabel: "基础日价",
      aiPriced: "AI 定价",
      weekdays: ["一", "二", "三", "四", "五", "六", "日"] as readonly string[],
      bookedTag: "已订",
      selectHint: "点选要改价的日期。",
      selectedCount: (count: number) => `已选 ${count} 天`,
      applyAction: "设置价格",
      clearAction: "恢复基础价",
      deselectAction: "取消选择",
      priceRequired: "请填一个大于 0 的价格，或点「恢复基础价」。",
      saveFailed: "价格没能保存，请重试。",
      emptyFleet: "还没有车辆开启在线预定。",
    },
  },
} as const;
