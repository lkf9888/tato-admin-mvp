export type StaffTaskNotificationAction = "created" | "updated" | "deleted" | "removed";

export type StaffTaskNotificationTemplate = {
  emailSubjectTemplate: string;
  emailBodyTemplate: string;
  smsBodyTemplate: string;
};

type NullableStaffTaskNotificationTemplate = {
  emailSubjectTemplate?: string | null;
  emailBodyTemplate?: string | null;
  smsBodyTemplate?: string | null;
};

export type StaffTaskNotificationTemplateValues = {
  staffName: string;
  taskTitle: string;
  actionLabel: string;
  dueLabel: string;
  timeWindow: string;
  vehicleLabel: string;
  orderLabel: string;
  details: string;
  taskUrl: string;
};

export const STAFF_TASK_NOTIFICATION_DEFAULT_TEMPLATE: StaffTaskNotificationTemplate = {
  emailSubjectTemplate: "TATO {actionLabel}: {taskTitle}",
  emailBodyTemplate:
    "{staffName}，你有一个 TATO 任务通知。\n\n任务：{taskTitle}\n状态：{actionLabel}\n到期：{dueLabel}\n时间：{timeWindow}\n车辆：{vehicleLabel}\n订单：{orderLabel}\n\n{details}\n\n查看任务：{taskUrl}",
  smsBodyTemplate:
    "TATO {actionLabel}: {taskTitle}\n到期: {dueLabel}\n时间: {timeWindow}\n车辆: {vehicleLabel}\n订单: {orderLabel}\n查看: {taskUrl}",
};

export const STAFF_TASK_TEMPLATE_VARIABLES = [
  "staffName",
  "taskTitle",
  "actionLabel",
  "dueLabel",
  "timeWindow",
  "vehicleLabel",
  "orderLabel",
  "details",
  "taskUrl",
] as const;

export function normalizeStaffTaskNotificationTemplate(
  template?: NullableStaffTaskNotificationTemplate | null,
): StaffTaskNotificationTemplate {
  return {
    emailSubjectTemplate:
      cleanTemplateValue(template?.emailSubjectTemplate) ||
      STAFF_TASK_NOTIFICATION_DEFAULT_TEMPLATE.emailSubjectTemplate,
    emailBodyTemplate:
      cleanTemplateValue(template?.emailBodyTemplate) ||
      STAFF_TASK_NOTIFICATION_DEFAULT_TEMPLATE.emailBodyTemplate,
    smsBodyTemplate:
      cleanTemplateValue(template?.smsBodyTemplate) ||
      STAFF_TASK_NOTIFICATION_DEFAULT_TEMPLATE.smsBodyTemplate,
  };
}

export function getStaffTaskActionLabel(action: StaffTaskNotificationAction) {
  return {
    created: "新任务",
    updated: "任务更新",
    deleted: "任务删除",
    removed: "任务移除",
  }[action];
}

export function buildStaffTaskTemplateValues(input: {
  staffName: string;
  taskTitle: string;
  action: StaffTaskNotificationAction;
  dueLabel?: string | null;
  timeWindow?: string | null;
  vehicleLabel?: string | null;
  orderLabel?: string | null;
  details?: string | null;
  taskUrl?: string | null;
}): StaffTaskNotificationTemplateValues {
  return {
    staffName: input.staffName,
    taskTitle: input.taskTitle,
    actionLabel: getStaffTaskActionLabel(input.action),
    dueLabel: input.dueLabel ?? "",
    timeWindow: input.timeWindow ?? "",
    vehicleLabel: input.vehicleLabel ?? "",
    orderLabel: input.orderLabel ?? "",
    details: input.details ?? "",
    taskUrl: input.taskUrl ?? "",
  };
}

export function renderStaffTaskTemplate(
  template: string,
  values: StaffTaskNotificationTemplateValues,
) {
  const rendered = template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key: string) => {
    return values[key as keyof StaffTaskNotificationTemplateValues] ?? "";
  });

  return cleanRenderedTemplate(rendered);
}

function cleanTemplateValue(value?: string | null) {
  return value?.trim() || "";
}

function cleanRenderedTemplate(value: string) {
  return value
    .split("\n")
    .map((line) => line.replace(/\s+$/g, ""))
    .filter((line) => !/^[^:：\n]{1,28}[：:]\s*$/.test(line.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
