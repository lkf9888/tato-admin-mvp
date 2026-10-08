/**
 * Strings for the /imports CSV upload page and the import-billing
 * modal flow. Includes the long-form guide steps array (rendered as
 * the four-step "How to import" panel at the top of the page) and
 * the deeply-nested billing modal copy.
 */
export const importsMessages = {
  en: {
    imports: {
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
          title: "Choose the file and its account",
          body: "Choose the CSV, then say which Turo account it was exported from. Every column is read; Reservation ID is the key that tells a new trip from one already imported.",
        },
        {
          title: "Run the import",
          body: "Click Start import. Cars your fleet does not have yet are listed for you to confirm before any is created; offline conflicts are flagged for you to review.",
        },
      ],
      unconfirmedKicker: "Check these",
      unconfirmedTitle: (count: number) =>
        count === 1
          ? "1 upcoming trip has no plate-confirmed car"
          : `${count} upcoming trips have no plate-confirmed car`,
      unconfirmedCopy:
        "Booking email names a model, never a plate, so the car on these trips was worked out by matching that model against your fleet. That only holds while the fleet is complete: if the real car is missing, the model can still match exactly one car — the wrong one — and nothing about the result looks uncertain. Import the CSV covering these dates and the plates settle it.",
      unconfirmedSiblings: (count: number) =>
        `${count} cars in the fleet share this model and year`,
      unconfirmedUnknownVehicles: (list: string) =>
        `Past imports named cars your fleet does not have: ${list}. Until they exist here, booking email for their model matches one car fewer than really exists — and can land on the wrong one. Import that file again and confirm the new cars it lists, or add them by hand.`,
      unconfirmedShowList: (count: number) => `Show the ${count}`,
      logShowAll: (count: number) => `Show ${count} older import(s)`,
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
        uploadTitle: "Choose the Turo CSV",
        uploadHint: "The export from Turo's earnings page. Every column in it is kept on each order.",
        openTuroPage: "Open Turo earnings page",
        chooseFile: "Choose file",
        chooseAnother: "Choose another file",
        reading: "Reading the file…",
        fileSummary: (rows: number, cars: number, range: string) =>
          `${rows} row(s) · ${cars} car(s)${range ? ` · ${range}` : ""}`,
        previewToggle: (columns: number) => `Show the file (first 5 rows, ${columns} columns)`,
        notTuroFile: (missing: string) =>
          `This does not look like a Turo earnings export: no ${missing} column. Export it again from Turo's earnings page.`,
        parseFailed: "The file could not be read. Is it a CSV?",
        oneVehicleIdentifier: "vehicle",
        accountStep: "Which Turo account is this file from?",
        turoAccountHint:
          "An export only holds one account's cars. Pick the wrong one and its cars are filed under another account, and stop matching their own Turo mail.",
        turoAccountPlaceholder: "e.g. kevin",
        turoAccountMain: "Main account",
        turoAccountOther: "Another account…",
        importStep: "Import",
        importStepHint: "New cars are listed for you to confirm before any is created.",
        runImport: "Start import",
        needsFile: "Choose a file first",
        needsAccount: "Pick the account first",
        progressSteps: ["Read the file", "Check the cars", "Import the trips"],
        progressNote: (rows: number) =>
          `${rows} row(s). A big file takes a few tens of seconds — please don't refresh or close the page.`,
        newVehiclesKicker: "New cars",
        newVehiclesTitle: (count: number) =>
          count === 1 ? "1 car in this file is not in your fleet" : `${count} cars in this file are not in your fleet`,
        newVehiclesCopy:
          "The ticked cars are created and their trips imported. Trips of unticked cars are left out this time; add the car later and import the same file again.",
        newVehiclesPlanNote:
          "New cars have no Turo plan % yet. Until it is filled in, owner payouts that convert Boost, discounts or extra distance back to the guest's price assume 75%. Set it under Turo plan % when editing the car.",
        newVehiclesQuota: (count: number) =>
          count === 0
            ? "Your plan has no room for another car. Buy more slots to add these."
            : `Your plan has room for ${count} more car(s). Buy more slots to add the rest.`,
        newVehicleTrips: (count: number) => (count === 1 ? "1 trip" : `${count} trips`),
        confirmCreate: (count: number) => `Add ${count} car(s) and import`,
        skipCreate: "Don't add cars, import the rest",
        cancel: "Cancel",
        genericFailure: "Import failed",
        importSuccessTitle: "Import complete",
        importFailureTitle: "Import failed",
        importAlertClose: "Close",
        failureBreakdown: "Why rows failed",
        failureRows: (count: number) => `${count} row(s)`,
        failureSampleRows: "sample rows",
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
          `Imported ${successRows} row(s), added ${createdVehicles} car(s), skipped ${skippedRows} row(s); ${failedRows} row(s) need review.`,
        reclaimedIdentifiers: (pairs: string) =>
          `Took back VIN / Turo vehicle id held by the wrong car: ${pairs}. Those identifiers outrank the plate on every import, so the trips were filing against the wrong vehicle until now.`,
      },
    },
    turoCsvFields: {
      title: "Turo CSV",
      hint: "Every column of this trip's row in the Turo export. Choose which ones show; the choice applies to every order.",
      edit: "Choose fields",
      done: "Done",
      showAll: "Show all",
      hiddenCount: (count: number) => (count === 1 ? "1 field hidden" : `${count} fields hidden`),
      emptyHidden: "(empty)",
      saveFailed: "Could not save. Try again.",
    },
  },
  zh: {
    imports: {
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
          title: "选择文件和账户",
          body: "选择 CSV，再选它是从哪个 Turo 账户导出的。文件里的每一列都会读入；Reservation ID 用来判断订单是不是已经导入过。",
        },
        {
          title: "执行导入",
          body: "点击「开始导入」。车队里没有的车会先列出来让你确认，再新建；与线下订单冲突的记录会被标记等你处理。",
        },
      ],
      unconfirmedKicker: "需要核对",
      unconfirmedTitle: (count: number) => `${count} 个即将开始的订单,车辆未经车牌确认`,
      unconfirmedCopy:
        "预订邮件里只有车型,从来没有车牌,所以这些订单的车辆是拿车型去车队里匹配出来的。只有在车队完整时这才成立:如果真正那台车不在车队里,车型仍然可能唯一匹配到另一台车——错的那台——而结果看上去和正确答案没有任何区别。导入覆盖这些日期的 CSV,车牌就能定案。",
      unconfirmedSiblings: (count: number) => `车队里有 ${count} 台同款同年份`,
      unconfirmedUnknownVehicles: (list: string) =>
        `以前的导入里出现过车队中没有的车:${list}。只要它们不在车队里,这些车型的预订邮件能匹配到的车就比实际少一台,就可能落到错误的车上。重新导入那份文件，确认它列出的新车，或者手动把它们加进来。`,
      unconfirmedShowList: (count: number) => `查看这 ${count} 笔`,
      logShowAll: (count: number) => `显示更早的 ${count} 次导入`,
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
        uploadTitle: "选择 Turo CSV 文件",
        uploadHint: "Turo 收入页导出的 CSV。文件里的每一列都会存进对应的订单。",
        openTuroPage: "打开 Turo 下载页",
        chooseFile: "选择文件",
        chooseAnother: "换一个文件",
        reading: "正在读取文件…",
        fileSummary: (rows: number, cars: number, range: string) =>
          `${rows} 行 · ${cars} 台车${range ? ` · ${range}` : ""}`,
        previewToggle: (columns: number) => `查看文件内容（前 5 行，共 ${columns} 列）`,
        notTuroFile: (missing: string) =>
          `这份文件不像 Turo 收入导出：找不到「${missing}」列。请从 Turo 收入页重新导出。`,
        parseFailed: "文件读不出来，请确认是 CSV 格式。",
        oneVehicleIdentifier: "车辆",
        accountStep: "这份文件属于哪个 Turo 账户？",
        turoAccountHint:
          "一份导出只包含一个账户的车。选错了，这些车会记到别的账户下，之后再也匹配不上自己的 Turo 邮件。",
        turoAccountPlaceholder: "例如 kevin",
        turoAccountMain: "主账户",
        turoAccountOther: "其他账户…",
        importStep: "开始导入",
        importStepHint: "如果有车队里没有的车，会先列出来让你确认，再新建。",
        runImport: "开始导入",
        needsFile: "先选择文件",
        needsAccount: "先选择账户",
        progressSteps: ["读取文件", "核对车辆", "导入订单"],
        progressNote: (rows: number) => `共 ${rows} 行，文件大要几十秒，请不要刷新或关闭页面`,
        newVehiclesKicker: "发现新车",
        newVehiclesTitle: (count: number) => `这份文件里有 ${count} 台车队里还没有的车`,
        newVehiclesCopy:
          "勾选的车会新建，并把它们的订单一起导入。没勾的车，订单这次先不导入；以后把车加上，再导入同一份文件就行。",
        newVehiclesPlanNote:
          "新车还没填 Turo 计划比例。补上之前，车主分成按客人价还原 Boost、折扣、超里程时，会先按 75% 算。请到车辆编辑里的「Turo 计划比例 %」补上。",
        newVehiclesQuota: (count: number) =>
          count === 0
            ? "当前名额已用完，不能再加车。要新增这些车，请先购买名额。"
            : `当前名额只够再加 ${count} 台。要加更多，请先购买名额。`,
        newVehicleTrips: (count: number) => `${count} 笔订单`,
        confirmCreate: (count: number) => `新增 ${count} 台并导入`,
        skipCreate: "不新增，只导入已有车辆",
        cancel: "取消",
        genericFailure: "导入失败",
        importSuccessTitle: "导入完成",
        importFailureTitle: "导入失败",
        importAlertClose: "关闭",
        failureBreakdown: "失败原因分类",
        failureRows: (count: number) => `${count} 行`,
        failureSampleRows: "示例行号",
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
          `已导入 ${successRows} 行，新增 ${createdVehicles} 台车，跳过 ${skippedRows} 行，另有 ${failedRows} 行待人工检查。`,
        reclaimedIdentifiers: (pairs: string) =>
          `已从错误的车辆上收回 VIN / Turo 车辆 ID:${pairs}。这两个标识在导入时优先级高于车牌,在收回之前行程一直被归到错误的车上。`,
      },
    },
    turoCsvFields: {
      title: "Turo CSV 数据",
      hint: "这笔订单在 Turo 导出文件里那一行的全部字段。可以选择显示哪些，所有订单一起生效。",
      edit: "选择字段",
      done: "完成",
      showAll: "全部显示",
      hiddenCount: (count: number) => `已隐藏 ${count} 个字段`,
      emptyHidden: "（空）",
      saveFailed: "没保存上，请再试一次。",
    },
  },
} as const;
