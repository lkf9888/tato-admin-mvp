/**
 * Strings for the floating ContactButton + feedback modal (added in
 * v0.19.0). All function-valued strings (`filesSelected`, `errorTooManyFiles`,
 * etc) are intentional and must NOT be passed across the React Server
 * Component boundary — see `components/contact-button.tsx` for the
 * `locale: Locale` pattern that keeps function values on the client.
 */
export const contactMessages = {
  en: {
    contact: {
      trigger: "Contact",
      modalTitle: "Send us feedback",
      modalSubtitle: "Talk to the operator",
      fromLabel: "From",
      messageLabel: "Message",
      messagePlaceholder:
        "What happened, what did you expect, and on which page? Screenshots help a lot.",
      attachLabel: "Attachments",
      attachHint: "Up to 5 files. Each ≤ 10 MB, total ≤ 25 MB. Images, video, PDF.",
      filesSelected: (count: number, sizeMb: string) =>
        count === 0
          ? "Add files"
          : `${count} file${count === 1 ? "" : "s"} · ${sizeMb} MB`,
      removeFile: "Remove",
      sendAction: "Send",
      sendingAction: "Sending…",
      cancelAction: "Cancel",
      closeLabel: "Close",
      successTitle: "Sent",
      successCopy:
        "Thanks — your feedback is on its way. We'll reply to your account email if needed.",
      errorGeneric: "Something went wrong sending your message. Please try again.",
      errorMessageTooShort:
        "Add a few words about what happened so we can help.",
      errorTooManyFiles: (max: number) => `Up to ${max} files at a time.`,
      errorFileTooLarge: (filename: string, mb: number) =>
        filename
          ? `${filename} is too large — limit is ${mb} MB per file.`
          : `One of the files exceeds the ${mb} MB per-file limit.`,
      errorFileType: "That file type is not supported. Try an image, video, or PDF.",
      errorTotalTooLarge: (mb: number) =>
        `Total upload exceeds ${mb} MB. Remove a file or compress before sending.`,
      errorNotConfigured:
        "Feedback isn't set up on this deployment yet. Please email the operator directly.",
    },
  },
  zh: {
    contact: {
      trigger: "联系我们",
      modalTitle: "反馈或咨询",
      modalSubtitle: "联系开发者",
      fromLabel: "发件人",
      messageLabel: "留言",
      messagePlaceholder:
        "描述一下发生了什么、你预期是什么样、出问题的页面是哪个。截图能帮上很大的忙。",
      attachLabel: "附件",
      attachHint: "最多 5 个文件，每个 ≤ 10 MB，总共 ≤ 25 MB。支持图片、视频、PDF。",
      filesSelected: (count: number, sizeMb: string) =>
        count === 0 ? "添加文件" : `${count} 个文件 · ${sizeMb} MB`,
      removeFile: "移除",
      sendAction: "发送",
      sendingAction: "发送中…",
      cancelAction: "取消",
      closeLabel: "关闭",
      successTitle: "已发送",
      successCopy: "感谢反馈！我们收到后会尽快回复到你账号绑定的邮箱。",
      errorGeneric: "发送失败，请稍后重试。",
      errorMessageTooShort: "请用几句话描述一下情况，方便我们帮你定位问题。",
      errorTooManyFiles: (max: number) => `每次最多上传 ${max} 个文件。`,
      errorFileTooLarge: (filename: string, mb: number) =>
        filename ? `${filename} 超过单文件 ${mb} MB 上限。` : `有文件超过单文件 ${mb} MB 上限。`,
      errorFileType: "暂不支持这种文件类型，请换图片、视频或 PDF。",
      errorTotalTooLarge: (mb: number) =>
        `总大小超过 ${mb} MB，请删除一个文件或先压缩后再发。`,
      errorNotConfigured: "本服务暂未配置反馈邮箱，请直接联系运营者。",
    },
  },
} as const;
