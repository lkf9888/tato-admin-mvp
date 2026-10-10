import type { Shot } from "./types";

const OWNER = "/owners/cmt21pjru0000bon9dx97ecoh";

export const fleetShots: Shot[] = [
  {
    id: "orders-list",
    path: "/orders",
    marks: [
      { step: 1, target: { css: "main details summary", nth: 0 } },
      { step: 2, target: { placeholder: { zh: "搜索租客", en: "Search renter" } } },
      { step: 3, target: { css: "main details summary", nth: 1 } },
      { step: 4, target: { role: "link", name: { zh: "导出 Excel", en: "Export to Excel" } } },
      { step: 5, target: { css: 'main button:has-text("TV951F")', nth: 0 } },
    ],
  },
  {
    id: "orders-create",
    path: "/orders",
    setup: [{ click: { css: "main details summary", nth: 0 } }, { wait: 500 }],
    clip: { element: { css: "main details[open]", nth: 0 }, pad: 8 },
    marks: [
      { step: 1, target: { css: "main details[open] textarea", nth: 0 } },
      { step: 2, target: { role: "button", name: { zh: "识别", en: "Read message" }, exact: true } },
      { step: 3, target: { placeholder: { zh: "租客姓名", en: "Renter name" } } },
      { step: 4, target: { placeholder: "yyyy/mm/dd", nth: 0 } },
      { step: 5, target: { role: "button", name: { zh: "创建线下订单", en: "Create offline order" } } },
    ],
  },
  {
    id: "orders-bulk",
    path: "/orders",
    setup: [
      { check: { css: 'main input[type="checkbox"][aria-label]', nth: 0 } },
      { check: { css: 'main input[type="checkbox"][aria-label]', nth: 1 } },
      { wait: 400 },
    ],
    marks: [
      { step: 1, target: { css: 'main input[type="checkbox"][aria-label]', nth: 0 } },
      { step: 2, target: { role: "button", name: { zh: "同步给车主", en: "Sync to owners" } } },
      { step: 3, target: { role: "button", name: { zh: "标记已收款", en: "Mark paid" } } },
      { step: 4, target: { role: "button", name: { zh: "删除", en: "Delete" }, exact: true } },
    ],
  },
  {
    id: "orders-detail",
    path: "/orders/cmuxuxif20001botzls9dmr0l",
    marks: [
      { step: 1, target: { role: "link", name: { zh: "导航", en: "Get directions" } } },
      { step: 2, target: { role: "link", name: { zh: "在 Turo 上查看", en: "View on Turo" } } },
    ],
  },
  {
    id: "imports-steps",
    path: "/imports",
    marks: [
      { step: 1, target: { role: "link", name: { zh: "打开 Turo 下载页", en: "Open Turo earnings page" } } },
      { step: 2, target: { text: { zh: "选择文件", en: "Choose file" }, exact: true } },
      { step: 3, target: { css: 'main button:has-text("主账户"), main button:has-text("Main account")' } },
      { step: 4, target: { role: "button", name: { zh: "先选择文件", en: "Choose a file first" } } },
      { step: 5, target: { css: "main details summary", nth: 1 } },
    ],
  },
  {
    id: "imports-sync",
    path: "/imports",
    setup: [{ click: { css: "main details summary", nth: 0 } }, { wait: 500 }],
    clip: { element: { css: "main details[open]", nth: 0 }, pad: 8 },
    marks: [
      { step: 1, target: { css: "main details[open] textarea", nth: 0 } },
      { step: 2, target: { css: 'main details[open] input[type="text"]', nth: 0 } },
      { step: 3, target: { role: "button", name: { zh: "保存同步设置", en: "Save sync settings" } } },
    ],
  },
  {
    id: "vehicles-list",
    path: "/vehicles",
    marks: [
      { step: 1, target: { css: "main details summary", nth: 0 } },
      { step: 2, target: { css: 'main input[type="search"]' } },
      { step: 3, target: { css: 'main button:has-text("编辑车辆"), main button:has-text("Edit vehicle")', nth: 0 } },
      { step: 4, target: { role: "button", name: { zh: "归档车辆", en: "Archive vehicle" }, nth: 0 } },
    ],
  },
  {
    id: "vehicles-create",
    path: "/vehicles",
    setup: [{ click: { css: "main details summary", nth: 0 } }, { wait: 500 }],
    clip: { element: { css: "main details[open]", nth: 0 }, pad: 8 },
    marks: [
      { step: 1, target: { placeholder: { zh: "车牌号", en: "Plate number" } } },
      { step: 2, target: { placeholder: { zh: "品牌", en: "Brand" } } },
      { step: 3, target: { role: "button", name: { zh: "未分配车主", en: "Unassigned owner" } } },
      { step: 4, target: { placeholder: { zh: "TATO 佣金比例", en: "TATO commission" } } },
      { step: 5, target: { placeholder: { zh: "洗车费", en: "Cleaning fee" } } },
      { step: 6, target: { placeholder: { zh: "Turo 计划比例", en: "Turo plan" } } },
      { step: 7, target: { role: "button", name: { zh: "添加车辆", en: "Add vehicle" }, exact: true } },
    ],
  },
  {
    id: "vehicles-edit",
    path: "/vehicles",
    setup: [{ click: { css: 'main button:has-text("编辑车辆"), main button:has-text("Edit vehicle")', nth: 0 } }, { wait: 800 }],
    clip: { dialog: true },
    marks: [
      { step: 1, target: { css: '[role="dialog"] input', nth: 0 } },
      { step: 2, target: { css: '[role="dialog"] form button:not([type="button"])', last: true } },
    ],
  },
  {
    id: "roi-fleet",
    path: "/vehicle-roi",
    marks: [
      { step: 1, target: { role: "link", name: { zh: "车队表现", en: "Fleet" }, exact: true } },
      { step: 2, target: { css: 'main input[type="search"]' } },
      { step: 3, target: { role: "button", name: { zh: "近 12 个月", en: "12 mo" } } },
      { step: 4, target: { placeholder: { zh: "填写价格", en: "Add price" }, nth: 0 } },
    ],
  },
  {
    id: "roi-estimate",
    path: "/vehicle-roi/estimate",
    marks: [
      { step: 1, target: { css: "main select", nth: 0 } },
      { step: 2, target: { css: "main select", nth: 1 } },
      { step: 3, target: { css: "main select", nth: 2 } },
      { step: 4, target: { role: "button", name: { zh: "预估方法", en: "method" } } },
    ],
  },
  {
    id: "roi-ranking",
    path: "/vehicle-roi/ranking",
    marks: [
      { step: 1, target: { role: "button", name: { zh: "TATO 自己买车", en: "TATO buys the car" } } },
      { step: 2, target: { css: "main select", nth: 0 } },
      { step: 3, target: { css: 'main input[type="number"]', nth: 1 } },
      { step: 4, target: { role: "button", name: { zh: "成本假设", en: "Cost assumptions" } } },
    ],
  },
  {
    id: "owners-list",
    path: "/owners",
    marks: [
      { step: 1, target: { role: "link", name: { zh: "+ 新建车主", en: "+ New owner" } } },
      { step: 2, target: { role: "button", name: { zh: "+ 快速添加报销", en: "+ Quick reimbursement" } } },
      { step: 3, target: { css: 'main input[type="search"]' } },
      { step: 4, target: { css: 'main a:has-text("Henry Chan")' } },
    ],
  },
  {
    id: "owners-new",
    path: "/owners/new",
    marks: [
      { step: 1, target: { placeholder: { zh: "输入车主姓名", en: "owner" } } },
      { step: 2, target: { css: 'main input[type="email"]' } },
      { step: 3, target: { role: "button", name: { zh: "创建车主", en: "Create owner" } } },
    ],
  },
  {
    id: "owners-profile",
    path: OWNER,
    marks: [
      { step: 1, target: { role: "link", name: { zh: "打开对账单", en: "Open ledger" } } },
      { step: 2, target: { css: "main input", nth: 0 } },
      { step: 3, target: { role: "button", name: { zh: "保存", en: "Save" }, exact: true } },
    ],
  },
  {
    id: "owners-terms",
    path: OWNER,
    setup: [{ scrollTo: { text: { zh: "管理佣金", en: "Management commission" } } }],
    marks: [
      { step: 1, target: { css: 'main input[type="number"]', nth: 0 } },
      { step: 2, target: { css: 'main input[type="date"]', nth: 0 } },
      { step: 3, target: { css: 'main input[type="radio"]', nth: 0 } },
      { step: 4, target: { role: "button", name: { zh: "保存这套条款", en: "Save these terms" } } },
    ],
  },
  {
    id: "owners-fees",
    path: OWNER,
    setup: [{ scrollTo: { role: "button", name: { zh: "保存这套条款", en: "Save these terms" } } }],
    marks: [
      { step: 1, target: { text: { zh: "分给车主", en: "Owner's" }, exact: true, nth: 0 } },
      { step: 2, target: { text: { zh: "按客人付的价格", en: "At the price the guest paid" } } },
      { step: 3, target: { role: "button", name: { zh: "保存费用共享设置", en: "Save fee sharing" } } },
      { step: 4, target: { role: "button", name: { zh: "把这个口径应用到所有车主", en: "Use this for every owner" } } },
    ],
  },
  {
    id: "owners-share",
    path: OWNER,
    setup: [{ scrollTo: { role: "button", name: { zh: "创建共享链接", en: "Create share link" } } }, { wait: 300 }],
    marks: [
      { step: 1, target: { role: "button", name: { zh: "创建共享链接", en: "Create share link" } } },
      { step: 2, target: { role: "button", name: { zh: "已选择", en: "selected" } } },
      { step: 3, target: { role: "button", name: { zh: "保存车辆绑定", en: "Save vehicle assignments" } } },
      { step: 4, target: { role: "button", name: { zh: "删除车主", en: "Delete owner" } } },
    ],
  },
  {
    id: "owners-ledger",
    path: `${OWNER}/ledger`,
    marks: [
      { step: 1, target: { role: "button", name: { zh: "添加报销", en: "Add reimbursement" } } },
      { step: 2, target: { role: "button", name: { zh: "记录收款", en: "Record payment" } } },
      { step: 3, target: { role: "button", name: { zh: "手动调整", en: "Manual adjustment" } } },
      { step: 4, target: { role: "button", name: { zh: "重新同步自动行", en: "Resync auto rows" } } },
      { step: 5, target: { role: "button", name: { zh: "通知车主对账单已出", en: "Tell the owner" } } },
      { step: 6, target: { css: 'main input[type="date"]', nth: 0 } },
    ],
  },
  {
    id: "owners-reimburse",
    path: "/owners",
    setup: [{ click: { role: "button", name: { zh: "+ 快速添加报销", en: "+ Quick reimbursement" } } }, { wait: 700 }],
    clip: { dialog: true },
    marks: [
      { step: 1, target: { css: '[role="dialog"] label', nth: 0 } },
      { step: 2, target: { css: '[role="dialog"] label', nth: 1 } },
      { step: 3, target: { css: '[role="dialog"] button:not([type="button"])', last: true } },
    ],
  },
];
