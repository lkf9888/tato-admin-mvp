/**
 * Strings for the /imports CSV upload page and the import-billing
 * modal flow. Includes the long-form guide steps array (rendered as
 * the four-step "How to import" panel at the top of the page) and
 * the deeply-nested billing modal copy.
 */
export const importsMessages = {
  en: {
    imports: {
      pageKicker: "CSV import",
      pageTitle: "Import Turo trips",
      pageSubtitle: "Sync your Turo earnings export into this workspace in four short steps.",
      guideTitle: "How to import",
      guideSteps: [
        {
          title: "Download your Turo CSV",
          body: "Open the Turo earnings page, pick the date range you want, and click Export to download the CSV to your computer.",
        },
        {
          title: "Check your quota",
          body: "Make sure your allowed vehicle total on the right covers your fleet. If it's not enough, buy more slots or apply a coupon first.",
        },
        {
          title: "Upload and map",
          body: "Click Choose file to upload the CSV. We auto-map common columns — review the dropdowns if any required fields are still missing.",
        },
        {
          title: "Run the import",
          body: "Click Run import. New vehicles will be auto-created (unless you opt out) and offline conflicts will be flagged for you to review.",
        },
      ],
      logKicker: "Import log",
      logTitle: "Recent CSV batches",
      sampleFile: "Sample file lives in `/sample-data/turo-sample.csv`",
      table: {
        file: "File",
        importedBy: "Imported by",
        importedAt: "Imported at",
        rows: "Rows",
        result: "Result",
        batchResult: (successRows: number, failedRows: number) =>
          `${successRows} success / ${failedRows} failed`,
      },
      panel: {
        uploadKicker: "1. Upload CSV",
        uploadTitle: "Preview before importing",
        openTuroPage: "Open Turo earnings page",
        chooseFile: "Choose file",
        emptyState:
          "Upload the sample CSV in `/sample-data/turo-sample.csv` or a real Turo export to see mapped rows here.",
        mappingKicker: "2. Field mapping",
        importKicker: "3. Import",
        ignoreColumn: "Ignore column",
        rowsDetected: "Rows detected",
        requiredMappingLeft: "Required mapping left",
        none: "none",
        oneVehicleIdentifier: "one vehicle identifier",
        autoCreateTitle: "Auto-create missing vehicles from CSV",
        autoCreateHint: "Recommended for first imports from a real Turo earnings export.",
        runImport: "Run import",
        importing: "Importing...",
        genericFailure: "Import failed",
        billing: {
          kicker: "0. Subscription",
          title: "Vehicle subscription",
          copy: "The first 5 vehicles are free. After that, each additional vehicle costs $1 USD per month. CSV imports are locked until your paid vehicle limit covers the fleet count.",
          currentVehicles: "Current vehicles",
          freeIncluded: "Free included",
          paidSlots: "Paid vehicle slots",
          allowedTotal: "Allowed total",
          subscriptionStatus: "Subscription status",
          desiredSlots: "Paid vehicle quantity",
          priceHint: (value: string) => `${value} / month beyond the 5 free vehicles`,
          payAction: "Pay with Stripe",
          manageAction: "Update in Stripe",
          redirecting: "Redirecting to Stripe...",
          notConfigured: "Stripe billing is not configured yet. Add Stripe keys before using this feature.",
          genericError: "We could not start billing right now. Please try again.",
          projectionTitle: "Import billing check",
          projectedVehicles: (count: number) => `Projected vehicles after import: ${count}`,
          projectedNewVehicles: (count: number) => `New vehicles from this file: ${count}`,
          projectedPaidSlots: (count: number) => `Paid slots required after import: ${count}`,
          checkingImport: "Checking CSV against your paid vehicle limit...",
          limitExceeded: "Vehicle limit exceeded. Please buy more vehicle slots before importing.",
          limitExceededDetail: (projected: number, allowed: number, extra: number) =>
            `This CSV would bring you to ${projected} vehicles, but your current limit is ${allowed}. Buy ${extra} more paid slot(s) to continue.`,
          modalKicker: "Billing required",
          modalTitle: "Buy more vehicle slots",
          modalCopy: (projected: number, allowed: number) =>
            `This import would increase your fleet to ${projected} vehicles while your current paid limit only allows ${allowed}. Complete payment first, then rerun the import.`,
          projectedVehiclesLabel: "Projected vehicles",
          additionalNeededLabel: "Extra paid slots needed",
          modalPriceHint: (value: string) => `Recurring charge: ${value} per month`,
          closeModal: "Close",
          openBillingPage: "Open quota page",
          checkoutSuccess: "Stripe confirmed the payment. Refresh billing if you changed the purchased slot quantity.",
          checkoutCancelled: "Stripe checkout was cancelled. No billing changes were made.",
          checkoutUpdated: "Stripe billing was updated. You can retry the CSV import now.",
        },
        importResult: (
          successRows: number,
          createdVehicles: number,
          failedRows: number,
          skippedRows = 0,
        ) =>
          `Imported ${successRows} row(s), auto-created ${createdVehicles} vehicle(s), skipped ${skippedRows} row(s), ${failedRows} row(s) need review. Refresh logs below to inspect the new batch.`,
        selectedVehiclesSummary: (selected: number, max: number) =>
          `Selected ${selected} / ${max} new vehicle(s) to fit within the current quota.`,
        selectedVehiclesHint:
          "Existing vehicles in this CSV will still sync normally. Only new vehicles count toward the remaining quota.",
        chooseVehiclesTitle: "Choose which new vehicles to import",
        chooseVehiclesCopy: (max: number) =>
          `This file contains more new vehicles than your remaining quota allows. Pick up to ${max} new vehicle(s) to import now, or buy more quota.`,
        chooseVehiclesLabel: "New vehicles found in this CSV",
        importSelectedAction: "Import selected vehicles",
        selectionLimitNotice: (max: number) => `You can select up to ${max} new vehicle(s).`,
        selectionNoneAvailable:
          "No new-vehicle quota is left right now. You can still import existing vehicles from this file, or buy more quota first.",
      },
    },
  },
  zh: {
    imports: {
      pageKicker: "CSV 导入",
      pageTitle: "导入 Turo 行程",
      pageSubtitle: "按四个步骤，把 Turo 收益导出文件同步进这个工作台。",
      guideTitle: "导入步骤",
      guideSteps: [
        {
          title: "从 Turo 下载 CSV",
          body: "打开 Turo 的 Earnings 页面，选择你想导入的时间范围，点击 Export 把 CSV 下载到电脑。",
        },
        {
          title: "确认名额够用",
          body: "先看右侧「当前可用总名额」是否覆盖车队数量。不够的话，先去购买更多名额或输入 coupon 解锁。",
        },
        {
          title: "上传并映射字段",
          body: "点击「选择文件」上传 CSV，系统会自动匹配常见列名。若提示仍有必填字段，请在字段映射里手动选择。",
        },
        {
          title: "执行导入",
          body: "点击「执行导入」。新车辆会自动建档（除非关闭该选项），与线下订单冲突的记录会被标记等你处理。",
        },
      ],
      logKicker: "导入日志",
      logTitle: "最近 CSV 批次",
      sampleFile: "示例文件位于 `/sample-data/turo-sample.csv`",
      table: {
        file: "文件",
        importedBy: "导入人",
        importedAt: "导入时间",
        rows: "行数",
        result: "结果",
        batchResult: (successRows: number, failedRows: number) =>
          `${successRows} 成功 / ${failedRows} 失败`,
      },
      panel: {
        uploadKicker: "1. 上传 CSV",
        uploadTitle: "导入前预览",
        openTuroPage: "打开 Turo 下载页",
        chooseFile: "选择文件",
        emptyState: "上传 `/sample-data/turo-sample.csv` 示例文件，或真实的 Turo 导出文件后，这里会显示映射预览。",
        mappingKicker: "2. 字段映射",
        importKicker: "3. 开始导入",
        ignoreColumn: "忽略该列",
        rowsDetected: "识别到行数",
        requiredMappingLeft: "仍缺少的必填映射",
        none: "无",
        oneVehicleIdentifier: "至少一个车辆标识字段",
        autoCreateTitle: "自动从 CSV 创建缺失车辆",
        autoCreateHint: "首次导入真实 Turo earnings 导出时建议开启。",
        runImport: "执行导入",
        importing: "导入中...",
        genericFailure: "导入失败",
        billing: {
          kicker: "0. 订阅计费",
          title: "车辆名额订阅",
          copy: "前 5 台车辆免费。超过后，每多 1 台车辆收费 $1 USD / 月。只有已购买名额覆盖车辆总数后，才允许导入 CSV。",
          currentVehicles: "当前车辆数",
          freeIncluded: "免费名额",
          paidSlots: "已付费名额",
          allowedTotal: "当前可用总名额",
          subscriptionStatus: "订阅状态",
          desiredSlots: "想购买的车辆名额数",
          priceHint: (value: string) => `超出免费 5 台后的月费：${value}`,
          payAction: "前往 Stripe 支付",
          manageAction: "去 Stripe 修改名额",
          redirecting: "正在跳转到 Stripe...",
          notConfigured: "Stripe 计费尚未配置，暂时无法启用这个功能。",
          genericError: "暂时无法发起支付，请稍后再试。",
          projectionTitle: "导入前计费检查",
          projectedVehicles: (count: number) => `导入后预计车辆数：${count}`,
          projectedNewVehicles: (count: number) => `本次文件新增车辆数：${count}`,
          projectedPaidSlots: (count: number) => `导入后所需付费名额：${count}`,
          checkingImport: "正在检查这份 CSV 是否超过已购车辆名额...",
          limitExceeded: "车辆数量将超过当前已购名额，请先补交费用再导入。",
          limitExceededDetail: (projected: number, allowed: number, extra: number) =>
            `这份 CSV 会让车辆总数达到 ${projected} 台，但你当前只允许 ${allowed} 台。请先补购 ${extra} 个付费名额。`,
          modalKicker: "需要补交费用",
          modalTitle: "购买更多车辆名额",
          modalCopy: (projected: number, allowed: number) =>
            `这次导入会让你的车辆总数达到 ${projected} 台，而当前已付费上限只支持 ${allowed} 台。请先完成支付，再重新执行导入。`,
          projectedVehiclesLabel: "预计导入后车辆数",
          additionalNeededLabel: "还需补购名额",
          modalPriceHint: (value: string) => `循环月费：${value}`,
          closeModal: "关闭",
          openBillingPage: "前往购买额度",
          checkoutSuccess: "Stripe 已确认支付。若你修改了付费名额数量，现在可以重新尝试导入 CSV。",
          checkoutCancelled: "Stripe 支付已取消，本次未变更任何计费信息。",
          checkoutUpdated: "Stripe 订阅已更新，现在可以重新尝试导入 CSV。",
        },
        importResult: (
          successRows: number,
          createdVehicles: number,
          failedRows: number,
          skippedRows = 0,
        ) =>
          `已导入 ${successRows} 行，自动创建 ${createdVehicles} 台车辆，跳过 ${skippedRows} 行，另有 ${failedRows} 行待人工检查。可刷新下方日志查看新批次。`,
        selectedVehiclesSummary: (selected: number, max: number) =>
          `已选择 ${selected} / ${max} 台新车辆，符合当前额度上限。`,
        selectedVehiclesHint:
          "这份 CSV 里已存在于系统中的车辆仍会正常同步，只有新车辆会占用剩余额度。",
        chooseVehiclesTitle: "选择本次要导入的新车辆",
        chooseVehiclesCopy: (max: number) =>
          `这份文件里的新车辆数量超过了当前剩余额度。你现在可以先勾选最多 ${max} 台新车辆导入，或者先补购更多额度。`,
        chooseVehiclesLabel: "这份 CSV 识别到的新车辆",
        importSelectedAction: "导入已选车辆",
        selectionLimitNotice: (max: number) => `当前最多可选择 ${max} 台新车辆。`,
        selectionNoneAvailable:
          "当前没有可用的新车辆额度。你仍然可以导入这份文件里已存在于系统中的车辆，或者先去补购额度。",
      },
    },
  },
} as const;
