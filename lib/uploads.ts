import path from "path";

const SAFE_FILENAME_PATTERN = /[^a-zA-Z0-9._-]/g;

export function getUploadRoot() {
  if (process.env.TATO_UPLOAD_DIR) {
    return process.env.TATO_UPLOAD_DIR;
  }

  if (process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === "production") {
    return "/app/data/uploads";
  }

  return path.join(process.cwd(), "data", "uploads");
}

export function sanitizeFilename(filename: string) {
  const fallback = "upload.bin";
  const clean = filename.trim().replace(SAFE_FILENAME_PATTERN, "-").replace(/-+/g, "-");
  return clean || fallback;
}

export function extensionFromFilename(filename: string) {
  const ext = path.extname(filename).toLowerCase().replace(/[^a-z0-9.]/g, "");
  return ext || ".bin";
}

export function makeOrderAttachmentPath(orderId: string, filename: string) {
  const ext = extensionFromFilename(filename);
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return path.posix.join("orders", orderId, `${stamp}${ext}`);
}

export function resolveUploadPath(pathname: string) {
  const normalized = path.posix.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "");
  if (normalized.startsWith("/") || normalized.includes("..")) {
    throw new Error("Invalid upload path");
  }
  return path.join(getUploadRoot(), normalized);
}

export function isVideoAttachment(contentType: string | null | undefined, filename: string | null | undefined) {
  const type = (contentType ?? "").toLowerCase();
  const name = (filename ?? "").toLowerCase();
  return type.startsWith("video/") || /\.(mp4|mov|m4v|webm|3gp|avi|qt)$/.test(name);
}

export function isImageAttachment(contentType: string | null | undefined, filename: string | null | undefined) {
  const type = (contentType ?? "").toLowerCase();
  const name = (filename ?? "").toLowerCase();
  return type.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp|heic|heif|avif)$/.test(name);
}
