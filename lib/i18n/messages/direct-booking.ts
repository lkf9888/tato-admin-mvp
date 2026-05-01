/**
 * Strings for the /direct-booking admin page (per-vehicle public
 * booking page configuration). The renter-facing /reserve/[vehicleId]
 * page lives in `share.ts` since it's grouped with other public
 * surfaces.
 */
export const directBookingMessages = {
  en: {
    directBookingPage: {
      kicker: "Direct booking",
      title: "Shareable booking pages for every vehicle",
      copy:
        "Turn uploaded fleet records into customer-facing booking pages. Set an open-date daily rate, optional insurance fee, and share one public payment link per vehicle.",
      enabledCount: "Live booking pages",
      readyCount: "Share-ready vehicles",
      stripeStatus: "Stripe checkout",
      stripeReady: "Connected",
      stripeMissing: "Not connected",
      emptyState: "Create or import vehicles first. Direct booking controls will appear here once the fleet is available.",
      ownerLabel: "Owner",
      noOwner: "Unassigned owner",
      rateLabel: "Open-date daily price",
      insuranceLabel: "Insurance fee / day",
      depositLabel: "Deposit",
      introLabel: "Booking page intro",
      introPlaceholder: "Short description shown to renters on the public booking page.",
      enableLabel: "Enable public booking page",
      shareLinkLabel: "Shareable renter link",
      shareHintEnabled: "This page is live and ready to share with renters.",
      shareHintDraft: "Save pricing first, then share this link when the page is ready.",
      liveLabel: "Live",
      draftLabel: "Draft",
      openPreview: "Open booking page",
      saveAction: "Save booking settings",
      pricingMissing: "Add a daily rate to make this vehicle bookable.",
      blockedDates: "Upcoming occupied dates",
      blockedDatesEmpty: "No upcoming blocked dates from current orders.",
      pricingSummary: (daily: string, insurance: string, deposit: string) =>
        `${daily} daily · ${insurance} insurance · ${deposit} deposit`,
    },
  },
  zh: {
    directBookingPage: {
      kicker: "在线预定",
      title: "为每台车生成可分享的预定页面",
      copy:
        "把已上传的车辆直接变成公开预定页。后台可以设置空白日期日租、保险费，并为每台车生成一个可直接发给租车人的付款链接。",
      enabledCount: "已上线预定页",
      readyCount: "可分享车辆",
      stripeStatus: "Stripe 支付",
      stripeReady: "已连接",
      stripeMissing: "未连接",
      emptyState: "请先创建或导入车辆。车队准备好后，这里会出现在线预定设置。",
      ownerLabel: "车主",
      noOwner: "未分配车主",
      rateLabel: "空白日期日租价格",
      insuranceLabel: "每日保险费用",
      depositLabel: "押金",
      introLabel: "预定页简介",
      introPlaceholder: "这里可以写给租车人看的简短介绍，会显示在公开预定页上。",
      enableLabel: "开启公开预定页面",
      shareLinkLabel: "可分享给租车人的链接",
      shareHintEnabled: "这个页面已经上线，可以直接发给租车人。",
      shareHintDraft: "先保存价格和文案，准备好后再分享这个链接。",
      liveLabel: "已上线",
      draftLabel: "草稿",
      openPreview: "打开预定页",
      saveAction: "保存预定设置",
      pricingMissing: "请先填写日租价格，这台车才能对外开放预定。",
      blockedDates: "接下来已占用日期",
      blockedDatesEmpty: "当前订单里还没有阻塞这台车的未来日期。",
      pricingSummary: (daily: string, insurance: string, deposit: string) =>
        `${daily} / 天 · 保险 ${insurance} · 押金 ${deposit}`,
    },
  },
} as const;
