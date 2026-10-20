import type { NotificationCategory } from "@/lib/notifications";

/**
 * What to do with each kind of Turo email once TATO has it.
 *
 * The operator wants the mailbox to hold almost nothing: every Turo
 * email is either something TATO already knows (a booking, a trip
 * reminder), something to tell them about on their phone, or a record
 * worth keeping out of sight. Built from a census of the 29,483 Turo
 * emails left in the inbox in October 2026; rules are tried in order.
 *
 * - `trash`: moved to Gmail's Trash (thirty days to undo) once stored.
 * - `archive`: moved under the "Turo客服" label -- support and claim
 *   threads are evidence in disputes, so they leave the inbox but stay.
 * - `trash_later`: security codes, cleared after a day; never pushed.
 * - `keep`: nothing matched; left where it is for a person to see.
 */

export type TuroMailDisposition = "trash" | "archive" | "trash_later" | "keep";

export type TuroMailRule = {
  group: "guest" | "booking" | "action" | "money" | "review" | "support" | "routine" | "security" | "unknown";
  disposition: TuroMailDisposition;
  /** Pushed to devices that chose this category, when it is new mail. */
  notify: NotificationCategory | null;
  /** What the notification calls it, in Chinese. */
  label: string;
};

type Rule = { test: RegExp } & TuroMailRule;

const RULES: Rule[] = [
  { test: /has sent you a message about your/i, group: "guest", disposition: "trash", notify: null, label: "客人消息" },
  { test: /\b(?:security|verification|confirmation) code\b|new device log|phone update|password update|verify your email|hosting team permissions/i, group: "security", disposition: "trash_later", notify: null, label: "验证码" },

  // Support threads and claims: kept, out of the inbox. Mail-client
  // prefixes only appear on threads a person answered.
  {
    test: /^(?:\([^)]*\)\s*[-–—]\s*)?(?:re|fwd?|fw)\s*:|\bclaim\b|relisted|ineligible vehicle|notice of|issue with your account|review (?:removal|policy)|vehicle swap|action required for your vehicle|support call|verification agent|damage reporting|following up on your|about your reported|didn.t comply|escalated reimbursement|escalated invoice|disputed invoice|regarding your (?:vehicle|current trip)|additional info needed|relisting evidence|roadside|immediate response|issue reported|^turo\s+trip\b/i,
    group: "support",
    disposition: "archive",
    notify: "turo_support",
    label: "Turo 客服与理赔",
  },

  // Insurance documents: kept with the support records, no push.
  { test: /insurance documents/i, group: "support", disposition: "archive", notify: null, label: "保险文件" },

  // Things only the host can do on Turo.
  { test: /requested a change to their trip/i, group: "action", disposition: "trash", notify: "alerts", label: "客人申请改行程（需处理）" },
  { test: /still need to confirm your guest/i, group: "action", disposition: "trash", notify: "alerts", label: "还没确认客人驾照（需处理）" },
  { test: /has not responded to your reimbursement invoice/i, group: "action", disposition: "trash", notify: "alerts", label: "报销单客人未回应（需处理）" },
  { test: /inspections? (?:are|is) due|annual (?:vehicle )?inspection|safety inspection|action required|update your vehicle listing|^your vehicle listing|additional usage/i, group: "action", disposition: "trash", notify: "alerts", label: "Turo 要求处理" },
  { test: /wants to book|requested to book|booking request/i, group: "action", disposition: "trash", notify: "alerts", label: "预订申请（需处理）" },
  { test: /inviting you to be a co-host/i, group: "action", disposition: "trash", notify: "alerts", label: "共管邀请（需处理）" },
  { test: /guest may need to cancel/i, group: "action", disposition: "trash", notify: "alerts", label: "客人可能要取消（需处理）" },

  // Bookings. New and cancelled ones are announced from the orders they
  // create (richer: car and dates); the mail itself only for changes.
  { test: /trip with your .+ is booked/i, group: "booking", disposition: "trash", notify: null, label: "新预订" },
  { test: /cancell?ed (?:their|the) trip|cancell?ed .+[’']s trip|trip with your .+ (?:has been |was )?cancell?ed/i, group: "booking", disposition: "trash", notify: null, label: "预订取消" },
  { test: /cancell?ed their request to change/i, group: "booking", disposition: "trash", notify: null, label: "客人撤回改行程申请" },
  { test: /confirmed .+ change request/i, group: "booking", disposition: "trash", notify: null, label: "已确认改行程" },
  { test: /has changed their trip|has been (?:changed|modified|extended)|trip (?:change|extension)/i, group: "booking", disposition: "trash", notify: "bookings", label: "行程已变更" },
  { test: /added another driver/i, group: "booking", disposition: "trash", notify: "bookings", label: "加了驾驶员" },

  // Money.
  {
    test: /reimbursement|earnings are on the way|invoice approved|incidental charge|payout|payment information|(?:cleaning|smoking) report|cleaning\/smoking|refund/i,
    group: "money",
    disposition: "trash",
    notify: "payments",
    label: "收入与报销",
  },

  { test: /rated their trip|left you a review/i, group: "review", disposition: "trash", notify: "reviews", label: "客人评分" },

  // Already on TATO's calendar, or nothing to act on.
  {
    test: /upcoming trip|has (?:returned|picked up) (?:your|.+[’']s )|starts soon|^reminder|protection plan|earnings plan|congratulations|how would you rate|host event|post visit summary|tell us what you thought|newsletter|tips for|welcome to turo|demand surge|long weekend|recent turo experience|snooze ends|shape the future|roundtable|community event|host release|take a stand|boost your listing|delivery setting|success manager|how did we do|love your feedback|you.re invited/i,
    group: "routine",
    disposition: "trash",
    notify: null,
    label: "提醒",
  },
];

const UNKNOWN: TuroMailRule = { group: "unknown", disposition: "keep", notify: null, label: "Turo 邮件" };

export function turoMailRule(subject: string): TuroMailRule {
  const rule = RULES.find((candidate) => candidate.test.test(subject));
  if (!rule) return UNKNOWN;
  const { test: _test, ...rest } = rule;
  return rest;
}

/** The Gmail label support threads are filed under. */
export const TURO_ARCHIVE_LABEL = "Turo客服";
