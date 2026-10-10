import type { Shot } from "./types";

export const teamShots: Shot[] = [
  {
    id: "staff-board",
    path: "/staff-schedule",
    marks: [
      { step: 1, target: { role: "button", name: { zh: "新增员工", en: "Add staff" } } },
      { step: 2, target: { css: "main select", nth: 0 } },
      { step: 3, target: { role: "button", name: { zh: "复制链接", en: "Copy link" } } },
      { step: 4, target: { role: "button", name: { zh: "+子任务", en: "+ Subtask" }, nth: 0 } },
      { step: 5, target: { role: "button", name: { zh: "完成", en: "Complete" }, exact: true, nth: 0 } },
    ],
  },
  {
    id: "staff-add",
    path: "/staff-schedule",
    setup: [{ click: { role: "button", name: { zh: "新增员工", en: "Add staff" } } }, { wait: 700 }],
    clip: { dialog: true },
    marks: [
      { step: 1, target: { css: '[role="dialog"] input, [role="dialog"] textarea', nth: 0 } },
      { step: 2, target: { css: '[role="dialog"] button:not(.btn-secondary)', last: true } },
    ],
  },
  {
    id: "staff-templates",
    path: "/staff-schedule",
    setup: [{ click: { role: "button", name: { zh: "通知模板", en: "Templates" } } }, { wait: 700 }],
    clip: { dialog: true },
    marks: [{ step: 1, target: { css: '[role="dialog"] textarea, [role="dialog"] input', nth: 0 } }],
  },
  {
    id: "staff-pay",
    path: "/staff-schedule/payouts/staff_dev_wei",
    marks: [
      { step: 1, target: { css: 'main input[type="number"]', nth: 0 } },
      { step: 2, target: { css: 'main button:has-text("任务"), main button:has-text("Tasks")', nth: 0 } },
      { step: 3, target: { css: 'main button:has-text("付款记录"), main button:has-text("Payments")', nth: 0 } },
      { step: 4, target: { css: 'main button:has-text("报销"), main button:has-text("Reimbursements")', nth: 0 } },
    ],
  },
  {
    id: "contracts-main",
    path: "/contracts",
    marks: [
      { step: 1, target: { role: "link", name: "+ 创建合约模板" } },
      { step: 2, target: { role: "link", name: "编辑模板" } },
      { step: 3, target: { css: "main select", nth: 0 } },
      { step: 4, target: { role: "button", name: "+ 添加签署人" } },
      { step: 5, target: { role: "button", name: "发送签约邮件" } },
    ],
  },
  {
    id: "contracts-new",
    path: "/contracts/templates/new",
    marks: [
      { step: 1, target: { css: "main input", nth: 0 } },
      { step: 2, target: { css: 'main input[type="file"]' } },
      { step: 3, target: { role: "button", name: "+ 添加签署人" } },
      { step: 4, target: { role: "button", name: "上传文件并创建模板" } },
    ],
  },
  {
    id: "inspections-main",
    path: "/inspections",
    marks: [
      { step: 1, target: { text: { zh: "还没拍的", en: "Waiting for photos" } } },
      { step: 2, target: { text: { zh: "窗口已关闭", en: "Window closed" } } },
    ],
  },
  {
    id: "inspections-recent",
    path: "/inspections",
    setup: [{ scrollTo: { text: { zh: "最近的绕车记录", en: "Recent walk" } } }],
    marks: [{ step: 1, target: { role: "link", name: { zh: "查看", en: "Open" }, exact: true } }],
  },
  {
    id: "inspections-session",
    path: "/inspections/cmu9g4oyw0001bovh9d9krnav",
    marks: [{ step: 1, target: { role: "link", name: { zh: "原始文件", en: "Original file" }, nth: 0 } }],
  },
  {
    id: "photos-main",
    path: "/photos",
    marks: [
      { step: 1, target: { css: "main select, main button[aria-haspopup]", nth: 0 } },
      { step: 2, target: { css: 'main input[type="search"], main input', nth: 0 } },
      { step: 3, target: { text: { zh: "打包下载 ZIP", en: "Download as ZIP" } } },
    ],
  },
  {
    id: "documents-main",
    path: "/documents",
    marks: [
      { step: 1, target: { css: "main select, main button[aria-haspopup]", nth: 0 } },
      { step: 2, target: { role: "link", name: { zh: "打开文件", en: "Open file" }, nth: 0 } },
      { step: 3, target: { text: { zh: "打包下载 ZIP", en: "Download as ZIP" } } },
    ],
  },
  {
    id: "activity-main",
    path: "/activity",
    marks: [
      { step: 1, target: { css: "main details summary", nth: 0 } },
      { step: 2, target: { text: { zh: "元数据", en: "METADATA" }, nth: 0 } },
    ],
  },
  {
    id: "trash-main",
    path: "/trash",
    marks: [
      { step: 1, target: { role: "button", name: { zh: "恢复", en: "Restore" }, exact: true, nth: 0 } },
      { step: 2, target: { css: 'main input[type="checkbox"]', nth: 0 } },
    ],
  },
];

export const accountShots: Shot[] = [
  {
    id: "billing-main",
    path: "/billing",
    marks: [
      { step: 1, target: { css: 'main input[type="number"]', nth: 0 } },
      { step: 2, target: { role: "button", name: { zh: "前往 Stripe 支付", en: "Continue to Stripe" } } },
      { step: 3, target: { role: "button", name: { zh: "应用 coupon", en: "Apply coupon" } } },
    ],
  },
  {
    id: "payouts-main",
    path: "/payouts",
    marks: [
      { step: 1, target: { role: "button", name: { zh: "加拿大", en: "Canada" } } },
      { step: 2, target: { role: "button", name: { zh: "开始 Stripe 开通", en: "Start Stripe onboarding" } } },
    ],
  },
  {
    id: "invoices-list",
    path: "/invoices",
    marks: [
      { step: 1, target: { role: "button", name: { zh: "+ 新建发票", en: "+ New invoice" } } },
      { step: 2, target: { role: "button", name: { zh: "收据", en: "Receipt" }, exact: true } },
      { step: 3, target: { role: "button", name: { zh: "发邮件", en: "Email" }, exact: true, nth: 0 } },
      { step: 4, target: { role: "link", name: { zh: "打印 / PDF", en: "Print / PDF" }, nth: 0 } },
      { step: 5, target: { role: "button", name: { zh: "标记已付", en: "Mark paid" }, nth: 0 } },
    ],
  },
  {
    id: "invoices-editor",
    path: "/invoices",
    setup: [{ click: { role: "button", name: { zh: "+ 新建发票", en: "+ New invoice" } } }, { wait: 800 }],
    clip: { element: { css: "div.fixed.inset-0 > div", last: true }, pad: 8 },
    marks: [
      { step: 1, target: { text: { zh: "开给（姓名或公司）", en: "Recipient" }, exact: true } },
      { step: 2, target: { text: { zh: "明细", en: "Items" }, exact: true } },
      { step: 3, target: { text: { zh: "加一行", en: "Add line" } } },
      { step: 4, target: { css: "div.fixed.inset-0 button", last: true } },
    ],
  },
  {
    id: "settings-profile",
    path: "/account-settings",
    marks: [
      { step: 1, target: { role: "button", name: { zh: "保存资料", en: "Save profile" } } },
      { step: 2, target: { role: "button", name: { zh: "更新邮箱", en: "Update email" } } },
      { step: 3, target: { role: "button", name: { zh: "更新密码", en: "Update password" } } },
    ],
  },
  {
    id: "settings-team",
    path: "/account-settings",
    viewportHeight: 1100,
    setup: [{ scrollTo: { css: 'main h2:text-is("团队成员"), main h2:text-is("Team"), main p:text-is("团队成员"), main p:text-is("Team")' } }],
    marks: [
      { step: 1, target: { role: "button", name: { zh: "+ 添加成员", en: "+ Add a member" } } },
      { step: 2, target: { role: "button", name: { zh: "保存分账规则", en: "Save revenue split" } } },
    ],
  },
  {
    id: "settings-app",
    path: "/account-settings",
    viewportHeight: 1300,
    setup: [{ scrollTo: { role: "button", name: { zh: "繁中", en: "繁中" } } }],
    marks: [
      { step: 1, target: { role: "button", name: { zh: "中文", en: "中文" }, exact: true } },
      { step: 2, target: { role: "link", name: { zh: "去设置读取器", en: "Set up the reader" } } },
      { step: 3, target: { role: "link", name: { zh: "签发 API 令牌", en: "Get an API token" } } },
      { step: 4, target: { css: 'main button:text-is("深色"), main button:text-is("Dark")' } },
    ],
  },
  {
    id: "settings-agent",
    path: "/agent",
    marks: [
      { step: 1, target: { role: "button", name: "签发新令牌" } },
      { step: 2, target: { role: "link", name: "读取 Turo 会话" } },
      { step: 3, target: { role: "button", name: "签发只读令牌" } },
    ],
  },
];
