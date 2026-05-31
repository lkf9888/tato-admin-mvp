import type { PickedPhoto, StaffAppSession, StaffTask, TaskAttachment } from "./types";

export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL || "https://tatocar.co").replace(/\/$/, "");

type ApiOptions = {
  method?: "GET" | "POST" | "PATCH";
  token?: string | null;
  body?: unknown;
};

async function apiRequest<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;

  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(typeof payload.error === "string" ? payload.error : `HTTP_${response.status}`);
    throw error;
  }
  return payload as T;
}

export function loginWithStaffCode(staffCode: string) {
  return apiRequest<StaffAppSession>("/api/staff-app/login", {
    method: "POST",
    body: { staffCode },
  });
}

export function fetchCurrentStaff(token: string) {
  return apiRequest<Omit<StaffAppSession, "token">>("/api/staff-app/me", { token });
}

export function updateTask(
  token: string,
  taskId: string,
  body: Partial<Pick<StaffTask, "title" | "details" | "dueDatetime" | "timeWindow" | "status">> & {
    unassign?: boolean;
  },
) {
  return apiRequest<{ task: StaffTask | null; unassigned?: boolean }>(`/api/staff-app/tasks/${taskId}`, {
    method: "PATCH",
    token,
    body,
  });
}

export async function uploadTaskPhotos(token: string, taskId: string, photos: PickedPhoto[]) {
  const formData = new FormData();
  for (const photo of photos) {
    formData.append("files", {
      uri: photo.uri,
      name: photo.name,
      type: photo.type,
    } as unknown as Blob);
  }

  const response = await fetch(`${API_BASE_URL}/api/staff-app/tasks/${taskId}/attachments`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(payload.attachments)) {
    throw new Error(typeof payload.error === "string" ? payload.error : "UPLOAD_FAILED");
  }
  return payload.attachments as TaskAttachment[];
}
