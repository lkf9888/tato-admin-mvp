import type { Shot } from "./types";

const TAB = (zh: string, en: string) => ({ role: "tab" as const, name: { zh, en } });

export const bookingShots: Shot[] = [
  {
    id: "booking-vehicles",
    path: "/direct-booking",
    marks: [
      { step: 1, target: TAB("车辆", "Vehicles") },
      { step: 2, target: { css: 'main input[type="search"]' } },
      { step: 3, target: { css: 'main button:has-text("已上架"), main button:has-text("Live")', nth: 0 } },
      { step: 4, target: { css: 'main label:has(input[aria-label="上架"]), main label:has(input[aria-label="Listed"])', nth: 0 } },
      { step: 5, target: { role: "link", name: { zh: "预览", en: "Preview" }, exact: true } },
      { step: 6, target: { role: "button", name: { zh: "编辑", en: "Edit" }, exact: true } },
    ],
  },
  {
    id: "booking-vehicle-edit",
    path: "/direct-booking",
    setup: [{ click: { role: "button", name: { zh: "编辑", en: "Edit" }, exact: true } }, { wait: 900 }],
    clip: { dialog: true },
    marks: [{ step: 1, target: { css: '[role="dialog"] input', nth: 0 } }],
  },
  {
    id: "booking-pricing-rules",
    path: "/direct-booking",
    setup: [{ click: TAB("定价规则", "Pricing rules") }, { wait: 700 }],
    marks: [
      { step: 1, target: TAB("定价规则", "Pricing rules") },
      { step: 2, target: { text: { zh: "最短租期（天）", en: "Minimum rental days" } } },
      { step: 3, target: { text: { zh: "两单之间的缓冲（小时）", en: "Buffer between trips (hours)" } } },
      { step: 4, target: { text: { zh: "保险 / 天", en: "Insurance / day" }, exact: true } },
      { step: 5, target: { text: { zh: "取消政策", en: "Cancellation policy" }, exact: true } },
      { step: 6, target: { role: "button", name: { zh: "保存车队政策", en: "Save fleet policy" } } },
    ],
  },
  {
    id: "booking-locations",
    path: "/direct-booking",
    setup: [{ click: TAB("取还车地点", "Pickup & return") }, { wait: 700 }],
    marks: [
      { step: 1, target: TAB("取还车地点", "Pickup & return") },
      { step: 2, target: { role: "button", name: { zh: "添加地点", en: "Add a location" } } },
    ],
  },
  {
    id: "booking-email",
    path: "/direct-booking",
    setup: [{ click: TAB("确认邮件", "Confirmation email") }, { wait: 700 }],
    marks: [
      { step: 1, target: TAB("确认邮件", "Confirmation email") },
      { step: 2, target: { css: 'main input[type="checkbox"]', nth: 0 } },
      { step: 3, target: { css: "main textarea", nth: 0 } },
      { step: 4, target: { css: 'main button:has-text("{renterName}")', nth: 0 } },
    ],
  },
  {
    id: "booking-agreement",
    path: "/direct-booking",
    setup: [{ click: TAB("租车协议", "Rental agreement") }, { wait: 700 }],
    marks: [
      { step: 1, target: TAB("租车协议", "Rental agreement") },
      { step: 2, target: { css: "main textarea", nth: 0 } },
      { step: 3, target: { css: 'main button:has-text("↓")', nth: 0 } },
      { step: 4, target: { role: "button", name: { zh: "保存协议", en: "Save agreement" } } },
    ],
  },
  {
    id: "booking-requests",
    path: "/direct-booking/requests",
    marks: [{ step: 1, target: { role: "link", name: { zh: "变更申请", en: "Change requests" } } }],
  },
  {
    id: "booking-deposits",
    path: "/direct-booking/deposits",
    marks: [
      { step: 1, target: { role: "link", name: { zh: "押着的", en: "Held" }, exact: true } },
      { step: 2, target: { css: 'main input[type="search"]' } },
      { step: 3, target: { role: "button", name: { zh: "详情", en: "Details" }, exact: true } },
      { step: 4, target: { role: "button", name: { zh: "标记已退", en: "Mark returned" } } },
    ],
  },
  {
    id: "booking-dynamic",
    path: "/direct-booking/pricing",
    marks: [
      { step: 1, target: { css: 'main input[type="checkbox"]', nth: 0 } },
      { step: 2, target: { css: "main details summary", nth: 0 } },
      { step: 3, target: { role: "button", name: { zh: "保存设置", en: "Save settings" } } },
      { step: 4, target: { role: "button", name: { zh: "计算建议", en: "Compute suggestions" } } },
      { step: 5, target: { role: "button", name: { zh: "撤掉动态价格", en: "Remove dynamic prices" } } },
    ],
  },
  {
    id: "booking-ads",
    path: "/direct-booking/ads",
    marks: [
      { step: 1, target: { css: "main select", nth: 0 } },
      { step: 2, target: { role: "button", name: { zh: "AI 润色", en: "Rewrite with AI" } } },
      { step: 3, target: { role: "button", name: { zh: "复制", en: "Copy" }, exact: true } },
    ],
  },
  {
    id: "booking-site",
    path: "/direct-booking/site",
    viewportHeight: 1250,
    marks: [
      { step: 1, target: { role: "link", name: { zh: "打开网站", en: "Open site" } } },
      { step: 2, target: { role: "button", name: { zh: "复制", en: "Copy" }, exact: true } },
      { step: 3, target: { css: "main details summary", nth: 0 } },
      { step: 4, target: { css: 'main button:has-text("简体中文")' } },
    ],
  },
  {
    id: "booking-turo-photos",
    path: "/direct-booking/turo-photos",
    marks: [{ step: 1, target: { role: "link", name: { zh: "导入到 TATO", en: "Import to TATO" } } }],
  },
];
