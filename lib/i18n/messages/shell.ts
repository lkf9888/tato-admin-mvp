/**
 * Strings for the page-level chrome: HTML meta tags, the admin layout
 * wrapper copy, the desktop sidebar / mobile bottom-nav strings, and
 * shared workspace badges. Loaded by `lib/i18n.ts` and spread into the
 * top-level `messages` object under the keys `meta`, `adminLayout`,
 * `shell`.
 */
export const shellMessages = {
  en: {
    meta: {
      title: "TATO | Turo Fleet Calendar",
      description: "Rental operations hub for Turo bookings, offline orders, and owner calendar sharing.",
    },
    adminLayout: {
      title: "Operations control room",
      description:
        "Keep Turo imports, offline rentals, vehicle utilization, and owner-facing share links in one operating system.",
    },
    shell: {
      brandKicker: "Turo Ops",
      brandTitle: "TATO",
      brandCopy: "One operating view for imported Turo trips, offline orders, and owner sharing.",
      nav: {
        dashboard: "Dashboard",
        vehicles: "Vehicles",
        vehicleRoi: "Vehicle ROI",
        ownerStatements: "Owner Statements",
        directBooking: "Direct Booking",
        owners: "Owners",
        orders: "Orders",
        calendar: "Calendar",
        imports: "CSV Imports",
        activity: "Activity log",
        billing: "Buy Quota",
        payouts: "Payouts",
        shareLinks: "Share Links",
        groupOperations: "Operations",
        groupFleet: "Fleet",
        groupBookings: "Customer Booking",
        groupBilling: "Billing",
      },
      // Mobile bottom tab bar — five primary destinations modeled on
      // the iOS HIG. The first four are the highest-frequency surfaces
      // (verified against existing sidebar grouping); "More" opens the
      // full drawer for the remaining seven entries. Labels are kept
      // short so they fit a ~75px tab cell on a 375px-wide phone.
      bottomNav: {
        home: "Home",
        calendar: "Calendar",
        orders: "Orders",
        fleet: "Fleet",
        more: "More",
        moreTitle: "All sections",
      },
      signOut: "Sign out",
      workspaceKicker: "Operations workspace",
      workspaceBadge: "Turo admin MVP · SQLite + Prisma + manual CSV sync",
      languageLabel: "Language",
      languageHint: "Choose Auto to follow the browser language, or lock the interface to English or Chinese.",
      languageAutoLabel: "Auto",
      versionLabel: "Version",
    },
  },
  zh: {
    meta: {
      title: "TATO 租车运营后台",
      description: "用于管理 Turo 订单、线下订单和车主共享日历的运营后台。",
    },
    adminLayout: {
      title: "运营控制台",
      description: "把 Turo 导入订单、线下订单、车辆利用率和车主共享链接统一放在一个后台里管理。",
    },
    shell: {
      brandKicker: "Turo 运营",
      brandTitle: "TATO",
      brandCopy: "用一个运营视图统一管理 Turo 行程、线下订单和车主共享。",
      nav: {
        dashboard: "仪表盘",
        vehicles: "车辆",
        vehicleRoi: "车辆投资回报分析",
        ownerStatements: "车主分成",
        directBooking: "在线预定",
        owners: "车主",
        orders: "订单",
        calendar: "日历",
        imports: "CSV 导入",
        activity: "操作日志",
        billing: "购买额度",
        payouts: "收款账户",
        shareLinks: "共享链接",
        groupOperations: "运营",
        groupFleet: "车队",
        groupBookings: "客户接入",
        groupBilling: "账务",
      },
      bottomNav: {
        home: "首页",
        calendar: "日历",
        orders: "订单",
        fleet: "车队",
        more: "更多",
        moreTitle: "所有功能",
      },
      signOut: "退出登录",
      workspaceKicker: "运营工作台",
      workspaceBadge: "Turo 管理后台 MVP · SQLite + Prisma + 手动 CSV 同步",
      languageLabel: "语言",
      languageHint: "选择“自动”时会跟随浏览器语言，也可以手动固定为英文或中文。",
      languageAutoLabel: "自动",
      versionLabel: "版本号",
    },
  },
} as const;
