/**
 * Strings for the public rental website and the admin page that
 * configures it.
 *
 * `rentalSitePage` is the operator-facing settings screen; `sitePublic`
 * is everything a renter reads. They live together because they
 * describe the same feature from two sides, and a label changed on one
 * side almost always needs the other.
 */
export const rentalSiteMessages = {
  en: {
    rentalSitePage: {
      kicker: "Rental website",
      title: "Your own booking site, on your own domain",
      copy:
        "Everything already on the direct-booking pages, gathered behind one address a stranger can find. Same fleet, same availability, same checkout — your brand on top.",
      statusPublished: "Published",
      statusDraft: "Draft",
      previewAction: "Open site",
      saveAction: "Save site settings",
      savedNotice: "Site settings saved.",
      createTitle: "Set up your rental website",
      createCopy: "Pick a name and an address. Nothing goes public until you publish.",
      createAction: "Create site",

      sectionAddress: "Address",
      sectionBrand: "Brand",
      sectionContact: "Contact",
      sectionTracking: "Tracking",

      brandNameLabel: "Site name",
      brandNameHint: "Shown in the header, the browser tab, and Google results.",
      slugLabel: "TATO address",
      slugHint: "Always works, even before a domain is bound.",
      slugTakenError: "That address is already taken.",
      slugReservedError: "That address is reserved. Pick another.",
      slugInvalidError: "Use letters, numbers and hyphens only.",
      domainLabel: "Custom domain",
      domainPlaceholder: "rentals.example.com",
      domainHint:
        "Point a CNAME at this app, then enter the domain here. Leave empty to stay on the TATO address.",
      domainTakenError: "That domain is already bound to another site.",
      publishedLabel: "Publish this site",
      publishedHint:
        "A site with no priced vehicles is worse than no site. Publish once at least one car is bookable.",
      publishBlocked: "Add a daily rate to at least one vehicle before publishing.",

      taglineLabel: "Tagline",
      taglineHint: "One line under the name.",
      descriptionLabel: "Homepage introduction",
      descriptionHint: "Also used as the search-result description when nothing better is available.",
      accentColorLabel: "Accent colour",
      accentColorHint: "Hex, like #1f6feb. Used for buttons and links.",
      logoLabel: "Logo",
      logoHint: "PNG, JPG, WEBP or SVG, up to 2MB. Replaces the initial in the header.",
      logoRemoveLabel: "Remove logo",

      contactEmailLabel: "Contact email",
      contactPhoneLabel: "Contact phone",
      contactAddressLabel: "Address",
      footerNoteLabel: "Footer notice",
      footerNoteHint: "Cancellation terms, insurance notes, licence numbers.",

      analyticsIdLabel: "Google tag ID",
      analyticsIdHint: "G- or AW- measurement ID. Left empty, no tracking script loads at all.",

      bookableCount: "Bookable vehicles",
      liveAddress: "Live address",
      noBookableVehicles:
        "No vehicle is bookable yet. Set a daily rate on the Direct booking page first.",
    },
    sitePublic: {
      searchTitle: "Find a car",
      pickupLabel: "Pick-up",
      returnLabel: "Return",
      searchAction: "Search",
      clearAction: "Clear dates",
      fleetTitle: "Our fleet",
      availableBadge: "Available",
      unavailableBadge: "Booked for these dates",
      perDay: "/ day",
      viewDetails: "View & book",
      depositLabel: "Deposit",
      insuranceLabel: "Insurance / day",
      emptyFleet: "No vehicles are listed right now. Please check back soon.",
      emptyResults: "No car is free for those dates. Try a different range.",
      resultsSummary: (available: number, total: number) =>
        `${available} of ${total} vehicles free for these dates`,
      fleetSummary: (total: number) => `${total} vehicles available to book`,
      backToFleet: "All vehicles",
    },
  },
  zh: {
    rentalSitePage: {
      kicker: "租车网站",
      title: "你自己的预订网站，挂在你自己的域名上",
      copy:
        "把已有的单车预订页收拢到一个陌生人能搜到的地址后面。同一批车、同一套档期、同一个收银台，换上你的品牌。",
      statusPublished: "已发布",
      statusDraft: "草稿",
      previewAction: "打开网站",
      saveAction: "保存网站设置",
      savedNotice: "网站设置已保存。",
      createTitle: "创建你的租车网站",
      createCopy: "先取个名字和地址。在你点发布之前，外部看不到任何东西。",
      createAction: "创建网站",

      sectionAddress: "地址",
      sectionBrand: "品牌",
      sectionContact: "联系方式",
      sectionTracking: "转化追踪",

      brandNameLabel: "网站名称",
      brandNameHint: "显示在页头、浏览器标签页和 Google 搜索结果里。",
      slugLabel: "TATO 地址",
      slugHint: "始终可用，绑定域名之前就能打开。",
      slugTakenError: "这个地址已被占用。",
      slugReservedError: "这是保留地址，请换一个。",
      slugInvalidError: "只能用字母、数字和连字符。",
      domainLabel: "自定义域名",
      domainPlaceholder: "rentals.example.com",
      domainHint: "先把 CNAME 指向本应用，再把域名填到这里。留空就继续用 TATO 地址。",
      domainTakenError: "这个域名已经绑定到另一个网站。",
      publishedLabel: "发布这个网站",
      publishedHint: "一辆定价车都没有的网站，比没有网站更糟。至少有一辆车可订之后再发布。",
      publishBlocked: "发布前，至少给一辆车设置日租价。",

      taglineLabel: "一句话简介",
      taglineHint: "显示在名称下方的一行字。",
      descriptionLabel: "首页介绍",
      descriptionHint: "没有更合适的内容时，也会用作搜索结果里的描述。",
      accentColorLabel: "主题色",
      accentColorHint: "十六进制，例如 #1f6feb。用在按钮和链接上。",
      logoLabel: "Logo",
      logoHint: "PNG、JPG、WEBP 或 SVG，2MB 以内。会替换页头的首字母。",
      logoRemoveLabel: "移除 Logo",

      contactEmailLabel: "联系邮箱",
      contactPhoneLabel: "联系电话",
      contactAddressLabel: "地址",
      footerNoteLabel: "页脚声明",
      footerNoteHint: "取消条款、保险说明、牌照号，这类必须写明的内容。",

      analyticsIdLabel: "Google 跟踪 ID",
      analyticsIdHint: "G- 或 AW- 开头的衡量 ID。留空则完全不加载跟踪脚本。",

      bookableCount: "可预订车辆",
      liveAddress: "当前地址",
      noBookableVehicles: "还没有可预订的车辆。请先在「在线预定」页给车设置日租价。",
    },
    sitePublic: {
      searchTitle: "查找车辆",
      pickupLabel: "取车",
      returnLabel: "还车",
      searchAction: "查询",
      clearAction: "清除日期",
      fleetTitle: "全部车辆",
      availableBadge: "可预订",
      unavailableBadge: "该时段已被预订",
      perDay: "/ 天",
      viewDetails: "查看并预订",
      depositLabel: "押金",
      insuranceLabel: "保险 / 天",
      emptyFleet: "目前还没有上架车辆，请稍后再来。",
      emptyResults: "所选日期没有空车。换个时间段试试。",
      resultsSummary: (available: number, total: number) =>
        `${total} 辆车中有 ${available} 辆在所选日期可用`,
      fleetSummary: (total: number) => `${total} 辆车可预订`,
      backToFleet: "全部车辆",
    },
  },
} as const;
