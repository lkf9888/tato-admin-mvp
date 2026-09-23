/**
 * Strings for the renter's own booking page at /booking/<token> and
 * the operator's queue of the requests it produces.
 */
export const bookingMessages = {
  en: {
    bookingPage: {
      notFoundTitle: "Booking not found",
      notFoundCopy:
        "This link is no longer valid. If you still have the confirmation email, check the address, or contact the host directly.",
      kicker: "Your booking",
      referenceLabel: "Reference",
      pickupLabel: "Pick-up",
      returnLabel: "Return",
      statusLabel: "Status",
      paidLabel: "Paid",
      outstandingLabel: "Still to pay",
      depositLabel: "Deposit",
      scheduleTitle: "Payment schedule",
      schedulePaid: "Paid",
      scheduleDue: "Due",
      cancelledNotice: "This booking has been cancelled.",

      pendingTitle: "Request received",
      pendingCancel: "You asked to cancel this booking. The host will be in touch.",
      pendingReschedule: (from: string, to: string) =>
        `You asked to move this booking to ${from} – ${to}. The host will be in touch.`,
      declinedNotice: "Your last request was declined. Contact the host if you need to discuss it.",

      changeTitle: "Need to change something?",
      changeCopy: "Send a request and the host will confirm it.",
      cancelHeading: "Cancel this booking",
      cancelFreeCopy: (amount: string) =>
        `Cancelling now refunds ${amount} in full.`,
      cancelLateCopy: (refund: string, penalty: string) =>
        `Pick-up is less than 48 hours away, so one day's rent (${penalty}) is kept. You would be refunded ${refund}.`,
      cancelStartedCopy:
        "This booking has already started, so it cannot be cancelled here. Contact the host.",
      cancelAction: "Request cancellation",
      cancelConfirm: "Are you sure? The host will be asked to cancel this booking.",

      rescheduleHeading: "Move the dates",
      rescheduleCopy: "Pick the dates you would prefer. Any price difference is settled with the host.",
      newPickupLabel: "New pick-up",
      newReturnLabel: "New return",
      rescheduleAction: "Request new dates",
      rescheduleUnavailable: "The car is already booked for those dates. Try a different range.",
      noteLabel: "Anything the host should know",
      notePlaceholder: "Optional",

      invalidRange: "The return date must be after the pick-up date.",
      submitError: "That request could not be sent. Please try again.",
      helpTitle: "Contact the host",
    },
    bookingRequestsPage: {
      title: "Change requests",
      empty: "No renter has asked to change a booking.",
      kindCancel: "Cancellation",
      kindReschedule: "Date change",
      requestedLabel: "Requested",
      quotedRefundLabel: "Refund under policy",
      approveAction: "Approve",
      declineAction: "Decline",
      approvedLabel: "Approved",
      declinedLabel: "Declined",
      refundedLabel: "Refunded",
      refundFailed: "The refund could not be sent. Check Stripe and try again.",
      conflictBlocked: "Those dates are no longer free, so this cannot be approved.",
    },
  },
  zh: {
    bookingPage: {
      notFoundTitle: "找不到这个预订",
      notFoundCopy: "这个链接已失效。如果你还留着确认邮件，请核对地址，或者直接联系车主。",
      kicker: "你的预订",
      referenceLabel: "订单号",
      pickupLabel: "取车",
      returnLabel: "还车",
      statusLabel: "状态",
      paidLabel: "已付",
      outstandingLabel: "待付",
      depositLabel: "押金",
      scheduleTitle: "付款计划",
      schedulePaid: "已付",
      scheduleDue: "应付",
      cancelledNotice: "这个预订已取消。",

      pendingTitle: "申请已收到",
      pendingCancel: "你提交了取消申请，车主会与你联系。",
      pendingReschedule: (from: string, to: string) =>
        `你申请把预订改到 ${from} – ${to}，车主会与你联系。`,
      declinedNotice: "你上一次的申请被拒绝了。需要沟通请联系车主。",

      changeTitle: "需要改动？",
      changeCopy: "提交申请，由车主确认。",
      cancelHeading: "取消这个预订",
      cancelFreeCopy: (amount: string) => `现在取消可全额退还 ${amount}。`,
      cancelLateCopy: (refund: string, penalty: string) =>
        `距取车不到 48 小时，需扣一天租金（${penalty}），可退还 ${refund}。`,
      cancelStartedCopy: "这个预订已经开始，无法在此取消，请联系车主。",
      cancelAction: "申请取消",
      cancelConfirm: "确定吗？系统会向车主提交取消申请。",

      rescheduleHeading: "更改日期",
      rescheduleCopy: "选择你希望的新日期。差价与车主结算。",
      newPickupLabel: "新取车日",
      newReturnLabel: "新还车日",
      rescheduleAction: "申请新日期",
      rescheduleUnavailable: "该时段这辆车已被预订，请换一个时间。",
      noteLabel: "想让车主知道的事",
      notePlaceholder: "选填",

      invalidRange: "还车日期必须晚于取车日期。",
      submitError: "申请没能提交，请重试。",
      helpTitle: "联系车主",
    },
    bookingRequestsPage: {
      title: "变更申请",
      empty: "还没有租客提出变更。",
      kindCancel: "取消",
      kindReschedule: "改期",
      requestedLabel: "申请于",
      quotedRefundLabel: "按政策应退",
      approveAction: "同意",
      declineAction: "拒绝",
      approvedLabel: "已同意",
      declinedLabel: "已拒绝",
      refundedLabel: "已退款",
      refundFailed: "退款没能发出，请到 Stripe 查看后重试。",
      conflictBlocked: "这些日期已经不空了，无法批准。",
    },
  },
} as const;
