import path from "path";

const SAFE_FILENAME_PATTERN = /[^a-zA-Z0-9._-]/g;
const PERSISTENT_DATA_ROOT = "/app/data";

function isProductionStorageRuntime() {
  return process.env.RAILWAY_ENVIRONMENT || process.cwd() === "/app";
}

function assertPersistentUploadRoot(uploadRoot: string) {
  if (!isProductionStorageRuntime()) return;

  const resolvedRoot = path.resolve(uploadRoot);
  const resolvedDataRoot = path.resolve(PERSISTENT_DATA_ROOT);

  if (resolvedRoot !== resolvedDataRoot && !resolvedRoot.startsWith(`${resolvedDataRoot}${path.sep}`)) {
    throw new Error(
      `Unsafe upload directory "${uploadRoot}". Production uploads must live under ${PERSISTENT_DATA_ROOT}.`,
    );
  }
}

export function getUploadRoot() {
  const uploadRoot =
    process.env.TATO_UPLOAD_DIR ||
    (isProductionStorageRuntime()
      ? path.join(PERSISTENT_DATA_ROOT, "uploads")
      : path.join(process.cwd(), "data", "uploads"));

  assertPersistentUploadRoot(uploadRoot);
  return uploadRoot;
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

export function makeVehicleAttachmentPath(vehicleId: string, filename: string) {
  const ext = extensionFromFilename(filename);
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return path.posix.join("vehicles", vehicleId, `${stamp}${ext}`);
}

export function makeStaffTaskAttachmentPath(taskId: string, filename: string) {
  const ext = extensionFromFilename(filename);
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return path.posix.join("staff-tasks", taskId, `${stamp}${ext}`);
}

export function makeDirectBookingDocumentPath(draftId: string, kind: string, filename: string) {
  const ext = extensionFromFilename(filename);
  const safeKind = sanitizeFilename(kind).replace(/\.+/g, "-") || "document";
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return path.posix.join("direct-bookings", draftId, `${safeKind}-${stamp}${ext}`);
}

export function makeOwnerLedgerReceiptPath(itemId: string, filename: string) {
  const ext = extensionFromFilename(filename);
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return path.posix.join("owner-ledger", itemId, "receipts", `${stamp}${ext}`);
}

export function makeContractTemplateSourcePath(workspaceId: string, filename: string) {
  const ext = extensionFromFilename(filename);
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return path.posix.join("contracts", "templates", workspaceId, "sources", `${stamp}${ext}`);
}

export function makeContractTemplatePdfPath(templateId: string, filename: string) {
  const ext = extensionFromFilename(filename) === ".pdf" ? ".pdf" : ".pdf";
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return path.posix.join("contracts", "templates", templateId, `${stamp}${ext}`);
}

export function makeContractEnvelopeSignedPdfPath(envelopeId: string, filename: string) {
  const safeStem = sanitizeFilename(filename).replace(/\.[^.]+$/, "") || "signed-contract";
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return path.posix.join("contracts", "envelopes", envelopeId, `${safeStem}-${stamp}.pdf`);
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
