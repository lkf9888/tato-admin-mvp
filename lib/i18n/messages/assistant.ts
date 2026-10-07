export const assistantMessages = {
  en: {
    assistantPage: {
      emptyState:
        "Ask anything about your fleet. Answers come from your live data, not from the model's guesses.",
      suggest1: "What's happening today?",
      suggest2: "Any booking conflicts I should fix?",
      suggest3: "Which Turo messages need a reply?",
      suggest4: "How much did I earn this month?",
      inputPlaceholder: "Ask about your fleet…",
      send: "Send",
      sending: "Sending…",
      thinking: "Checking your fleet data…",
      groundedIn: (vehicles: number, trips: number, conflicts: number, emails: number) =>
        `Answered from ${vehicles} vehicles · ${trips} trips this week · ${conflicts} conflicts · ${emails} unread Turo emails`,
      errorGeneric: "The assistant could not answer just now. Please try again.",
      errorRateLimited: "Too many questions in a short time. Give it a minute.",
      errorNotConfigured: "The assistant is not set up on this deployment yet.",
      notConfiguredHint:
        "Set KIMI_API_KEY in your environment to enable the assistant. Get a key at platform.moonshot.ai.",
      alertsTitle: "Alerts",
      alertsCopy: "Detected in code, not guessed by the model. Alerts close themselves when the condition clears.",
      alertsScan: "Rescan",
      alertsScanning: "Scanning…",
      alertsEmpty: "Nothing needs your attention.",
      alertsOpen: "Open",
      alertsAcknowledge: "Got it",
      inboxTitle: "Turo inbox",
      inboxCopy:
        "Messages Turo emailed you, pulled in automatically and sorted by what needs a reply.",
      inboxEmpty: "No Turo emails yet. They appear here once the Gmail sync runs.",
      inboxNotConfigured:
        "Set GMAIL_IMAP_USER and GMAIL_IMAP_PASSWORD (a Gmail App Password) to pull Turo notifications in automatically.",
      needsReply: "Needs reply",
      syncNow: "Sync now",
      syncing: "Syncing…",
      syncProgressStep: "Reading new Turo mail from Gmail",
      syncProgressNote: "Each new mail is read in turn; this can take up to a minute.",
      syncFailed: "Sync failed. Check the Gmail settings.",
      syncedCount: (imported: number) =>
        imported === 0 ? "No new Turo emails." : `Pulled in ${imported} new Turo email(s).`,
    },
  },
  zh: {
    assistantPage: {
      emptyState: "关于车队的问题都可以问。回答来自你的实时数据,不是模型的猜测。",
      suggest1: "今天有什么安排?",
      suggest2: "有需要处理的订单冲突吗?",
      suggest3: "哪些 Turo 消息需要回复?",
      suggest4: "这个月收入多少?",
      inputPlaceholder: "问点关于车队的事…",
      send: "发送",
      sending: "发送中…",
      thinking: "正在查你的车队数据…",
      groundedIn: (vehicles: number, trips: number, conflicts: number, emails: number) =>
        `依据:${vehicles} 台车 · 本周 ${trips} 单行程 · ${conflicts} 个冲突 · ${emails} 封未读 Turo 邮件`,
      errorGeneric: "助理暂时无法回答,请稍后再试。",
      errorRateLimited: "短时间内问得太多了,歇一分钟。",
      errorNotConfigured: "这个部署还没有配置助理。",
      notConfiguredHint:
        "在环境变量里设置 KIMI_API_KEY 以启用助理。到 platform.moonshot.ai 申请密钥。",
      alertsTitle: "提醒",
      alertsCopy: "由代码检测,不是模型猜的。条件消失后提醒会自动关闭。",
      alertsScan: "重新扫描",
      alertsScanning: "扫描中…",
      alertsEmpty: "目前没有需要你处理的事。",
      alertsOpen: "查看",
      alertsAcknowledge: "知道了",
      inboxTitle: "Turo 收件箱",
      inboxCopy: "Turo 发给你的邮件,自动收取并按是否需要回复排序。",
      inboxEmpty: "还没有 Turo 邮件。Gmail 同步跑过之后会出现在这里。",
      inboxNotConfigured:
        "设置 GMAIL_IMAP_USER 和 GMAIL_IMAP_PASSWORD(Gmail 应用专用密码)以自动收取 Turo 通知。",
      needsReply: "待回复",
      syncNow: "立即同步",
      syncing: "同步中…",
      syncProgressStep: "正在从 Gmail 读取新的 Turo 邮件",
      syncProgressNote: "新邮件要逐封读取，可能需要一分钟左右。",
      syncFailed: "同步失败,请检查 Gmail 设置。",
      syncedCount: (imported: number) =>
        imported === 0 ? "没有新的 Turo 邮件。" : `收取了 ${imported} 封新的 Turo 邮件。`,
    },
  },
} as const;
