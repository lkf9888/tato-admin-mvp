import type { Shot } from "./types";

const ORDER_BAR = '[data-calendar-order-bar][title*="Mei Chen"][title*="Toyota Sienna"]';

export const operationsShots: Shot[] = [
  {
    id: "dashboard-today",
    path: "/dashboard",
    marks: [
      { step: 1, target: { text: { zh: "今日在租", en: "Today in use" } } },
      { step: 2, target: { text: { zh: "冲突订单", en: "Conflicts" } } },
      { step: 3, target: { text: { zh: "取车/还车订单", en: "Pickup & return orders" }, nth: 0 } },
      { step: 4, target: { role: "button", name: { zh: "快速导入 CSV", en: "Quick CSV import" } } },
    ],
  },
  {
    id: "dashboard-start",
    path: "/dashboard",
    marks: [
      { step: 1, target: { role: "link", name: { zh: "邀请团队成员", en: "Invite your team" } } },
      { step: 2, target: { role: "button", name: { zh: "隐藏", en: "Hide" }, exact: true } },
      { step: 3, target: { text: { zh: "最近查看", en: "Recently viewed" } } },
      { step: 4, target: { css: "details summary", nth: 0 } },
    ],
  },
  {
    id: "assistant-main",
    path: "/assistant",
    marks: [
      { step: 1, target: { role: "link", name: { zh: "查看", en: "Open" }, exact: true } },
      { step: 2, target: { role: "button", name: { zh: "知道了", en: "Got it" }, exact: true } },
      { step: 3, target: { role: "button", name: { zh: "重新扫描", en: "Rescan" } } },
      { step: 4, target: { role: "button", name: { zh: "今天有什么安排", en: "What's happening today" } } },
      { step: 5, target: { role: "button", name: { zh: "记住", en: "Remember" }, exact: true } },
      { step: 6, target: { role: "button", name: { zh: "立即同步", en: "Sync now" } } },
    ],
  },
  {
    id: "messages-main",
    path: "/messages",
    marks: [
      { step: 1, target: { role: "button", name: { zh: "待回复", en: "Needs reply" } } },
      { step: 2, target: { text: "Amarpreet S.", nth: 0 } },
      { step: 3, target: { css: 'main a:has-text("Turo")', nth: 0 } },
      { step: 4, target: { role: "button", name: { zh: "逐字翻译", en: "Translation" } } },
      { step: 5, target: { role: "button", name: { zh: "标记已处理", en: "Mark handled" } } },
    ],
  },
  {
    id: "updates-main",
    path: "/updates",
    marks: [
      { step: 1, target: { role: "button", name: { zh: "新订单", en: "New booking" } } },
      { step: 2, target: { css: 'main a:text-is("订单"), main a:text-is("Order")' } },
      { step: 3, target: { css: 'main a:text-is("会话"), main a:text-is("Conversation")' } },
      { step: 4, target: { role: "link", name: { zh: "去 Turo 查看", en: "Open on Turo" } } },
    ],
  },
  {
    id: "calendar-toolbar",
    path: "/calendar",
    clip: { element: { css: "main section", nth: 0 }, pad: 10 },
    marks: [
      { step: 1, target: { role: "button", name: { zh: "今天", en: "Today" }, exact: true } },
      { step: 2, target: { role: "button", name: { zh: "新建", en: "New" }, exact: true } },
      { step: 3, target: { role: "button", name: { zh: "新建维修记录", en: "New service record" } } },
      { step: 4, target: { role: "button", name: { zh: "筛选", en: "Filters" }, exact: true } },
      { step: 5, target: { placeholder: { zh: "搜索租客", en: "Search" } } },
      { step: 6, target: { text: { zh: "未同步给车主", en: "Not with owner yet" } } },
    ],
  },
  {
    id: "calendar-grid",
    path: "/calendar",
    marks: [
      { step: 1, target: { text: { zh: "今天", en: "Today" }, exact: true, nth: 1 } },
      { step: 2, target: { css: "[data-calendar-order-bar]", nth: 2 } },
      { step: 3, target: { css: 'button[aria-label^="CX18AA"]' } },
      { step: 4, target: { css: "[data-calendar-service]", nth: 0 } },
    ],
  },
  {
    id: "calendar-pick-days",
    path: "/calendar",
    setup: [{ pickDays: { plate: "DJ15BB", days: [1, 2] } }, { wait: 600 }],
    marks: [
      { step: 1, target: { css: "div.bg-\\[rgba\\(245\\,158\\,11\\,0\\.22\\)\\]", nth: 0 } },
      { step: 2, target: { role: "button", name: { zh: "新建订单", en: "Create order" }, exact: true } },
      { step: 3, target: { role: "button", name: { zh: "新建维修记录", en: "New service record" }, nth: 1 } },
      { step: 4, target: { role: "button", name: { zh: "调价", en: "Adjust prices" } } },
      { step: 5, target: { placeholder: { zh: "例如", en: "e.g." } } },
    ],
  },
  {
    id: "calendar-order",
    path: "/calendar",
    viewportHeight: 1400,
    setup: [{ click: { css: ORDER_BAR } }, { wait: 1200 }],
    clip: { dialog: true },
    marks: [
      { step: 1, target: { css: '[role="dialog"] h3 + div' } },
      { step: 2, target: { role: "link", name: { zh: "查看Turo订单收据", en: "View Turo receipt" } } },
      { step: 3, target: { role: "button", name: { zh: "同步给车主共享", en: "Sync to owner share" } } },
      { step: 4, target: { css: '[role="dialog"] button[aria-label="编辑"], [role="dialog"] button[aria-label="Edit"]' } },
      { step: 5, target: { text: { zh: "净收入", en: "Net income" }, exact: true } },
      { step: 6, target: { css: '[role="dialog"] button.border-dashed', nth: 0 } },
      { step: 7, target: { role: "button", name: { zh: "删除订单", en: "Delete order" } } },
    ],
  },
  {
    id: "calendar-new-order",
    path: "/calendar",
    setup: [
      { click: { role: "button", name: { zh: "新建", en: "New" }, exact: true } },
      { click: { text: { zh: "手动创建订单", en: "Create manual order" } } },
      { wait: 900 },
    ],
    clip: { dialog: true },
    marks: [
      { step: 1, target: { css: '[role="dialog"] form label', nth: 0 } },
      { step: 2, target: { css: '[role="dialog"] form label', nth: 1 } },
      { step: 3, target: { css: '[role="dialog"] form label', nth: 4 } },
      { step: 4, target: { css: '[role="dialog"] form button[type="submit"]' } },
    ],
  },
  {
    id: "calendar-service",
    path: "/calendar",
    setup: [{ click: { role: "button", name: { zh: "新建维修记录", en: "New service record" } } }, { wait: 900 }],
    clip: { dialog: true },
    marks: [
      { step: 1, target: { css: '[role="dialog"] label', nth: 0 } },
      { step: 2, target: { css: '[role="dialog"] input[type="date"]', nth: 0 } },
      { step: 3, target: { css: '[role="dialog"] input[type="number"]', nth: 0 } },
      { step: 4, target: { css: '[role="dialog"] button[type="submit"]' } },
    ],
  },
  {
    id: "calendar-month",
    path: "/calendar",
    setup: [{ click: { css: 'button[aria-label^="SD102C"]' } }, { wait: 2500 }],
    clip: { dialog: true },
    marks: [
      { step: 1, target: { role: "button", name: { zh: "更早的月份", en: "Earlier months" } } },
      { step: 2, target: { css: '[role="dialog"] button[title*=" · "]', nth: 0 } },
    ],
  },
  {
    id: "calendar-tools",
    path: "/calendar",
    setup: [{ click: { role: "button", name: { zh: "工具", en: "Tools" }, exact: true } }, { wait: 500 }],
    marks: [
      { step: 1, target: { text: { zh: "选择", en: "Select" }, exact: true } },
      { step: 2, target: { text: { zh: "订阅链接", en: "Subscribe" }, exact: true } },
      { step: 3, target: { text: { zh: "下载车辆订单", en: "Download vehicle orders" }, exact: true } },
      { step: 4, target: { css: "[data-calendar-menu-open] input[type=range]" } },
    ],
  },
  {
    id: "calendar-filters",
    path: "/calendar",
    setup: [{ click: { role: "button", name: { zh: "筛选", en: "Filters" }, exact: true } }, { wait: 500 }],
    marks: [
      { step: 1, target: { css: "[data-calendar-menu-open] input, [data-calendar-menu-open] button", nth: 0 } },
    ],
  },
];
