export type Locale = "en" | "zh";

export type StaffTaskStatus = "todo" | "in_progress" | "done" | "cancelled";

export type StaffMember = {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  color: string;
  pinnedMessage: string | null;
  miniProgramCode: string | null;
};

export type TaskAttachment = {
  id: string;
  filename: string | null;
  contentType: string | null;
  size: number | null;
  uploadedAt: string;
  url: string;
};

export type StaffTask = {
  id: string;
  staffId: string | null;
  parentTaskId: string | null;
  vehicleId: string | null;
  orderId: string | null;
  staffLabel: string | null;
  vehicleLabel: string | null;
  orderLabel: string | null;
  title: string;
  details: string | null;
  dueDatetime: string | null;
  timeWindow: string | null;
  status: StaffTaskStatus;
  priority: string;
  category: string | null;
  sortOrder: number;
  completedAt: string | null;
  vehicle: { id: string; plateNumber: string; nickname: string } | null;
  order: {
    id: string;
    renterName: string;
    pickupDatetime: string;
    returnDatetime: string;
  } | null;
  attachments: TaskAttachment[];
};

export type StaffAppSession = {
  token: string;
  staff: StaffMember;
  tasks: StaffTask[];
};

export type PickedPhoto = {
  uri: string;
  name: string;
  type: string;
};
