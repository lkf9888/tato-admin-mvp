import path from "path";

const SAFE_FILENAME_PATTERN = /[^a-zA-Z0-9._-]/g;
const PERSISTENT_DATA_ROOT = "/app/data";

/**
 * Upload ceilings for attachment routes.
 *
 * `next.config.ts` sets `experimental.serverActions.bodySizeLimit`, but
 * that applies only to Server Actions — every attachment writer in this
 * app is a Route Handler, which Next does not cap by default. Until
 * v0.23.1 that meant seven upload endpoints accepted files of unbounded
 * size, one of them (`/api/staff-share/[token]/...`) with no session at
 * all, writing straight to the Railway volume shared with the SQLite
 * database. Filling that volume has already taken the site down once.
 *
 * 40MB per file leaves room for a phone video clip; 120MB per request
 * bounds a multi-file batch. Both are well under the volume's headroom
 * even if several uploads land at once.
 */
export const MAX_UPLOAD_BYTES_PER_FILE = 40 * 1024 * 1024;
export const MAX_UPLOAD_BYTES_PER_REQUEST = 120 * 1024 * 1024;
export const MAX_UPLOAD_FILES_PER_REQUEST = 20;

export type UploadLimitError = {
  error: "FILE_TOO_LARGE" | "REQUEST_TOO_LARGE" | "TOO_MANY_FILES" | "EMPTY_FILE";
  status: number;
  filename?: string;
  maxBytes?: number;
  maxFiles?: number;
};

/**
 * Validates a batch of uploaded files against the ceilings above.
 * Returns `null` when the batch is acceptable, or a ready-to-serialize
 * error object describing the first violation.
 *
 * Call this before writing anything to disk — the point is to reject
 * an oversized batch without having buffered it into the filesystem.
 */
export function checkUploadLimits(files: File[]): UploadLimitError | null {
  if (files.length > MAX_UPLOAD_FILES_PER_REQUEST) {
    return {
      error: "TOO_MANY_FILES",
      status: 400,
      maxFiles: MAX_UPLOAD_FILES_PER_REQUEST,
    };
  }

  let total = 0;
  for (const file of files) {
    if (file.size === 0) {
      return { error: "EMPTY_FILE", status: 400, filename: file.name };
    }
    if (file.size > MAX_UPLOAD_BYTES_PER_FILE) {
      return {
        error: "FILE_TOO_LARGE",
        status: 413,
        filename: file.name,
        maxBytes: MAX_UPLOAD_BYTES_PER_FILE,
      };
    }
    total += file.size;
  }

  if (total > MAX_UPLOAD_BYTES_PER_REQUEST) {
    return {
      error: "REQUEST_TOO_LARGE",
      status: 413,
      maxBytes: MAX_UPLOAD_BYTES_PER_REQUEST,
    };
  }

  return null;
}

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

/**
 * Resolves a client-supplied pathname and asserts it lands inside
 * `expectedPrefix` (a posix-style path relative to the upload root).
 *
 * Callers used to do this instead:
 *
 *     if (!pathname.startsWith(`contracts/templates/${workspace.id}/sources/`)) return 404;
 *     const abs = resolveUploadPath(pathname);
 *
 * — which tests the *raw* string and only normalizes afterwards. A
 * pathname like
 *
 *     contracts/templates/WS_A/sources/../../../../orders/<id>/x.pdf
 *
 * passes that prefix test verbatim, then normalizes down to
 * `orders/<id>/x.pdf`, escaping the workspace directory entirely.
 * `resolveUploadPath` still keeps the caller inside the upload *root*,
 * so this was never a read-anything-on-disk bug — but the workspace
 * boundary, which is the only thing those checks existed to enforce,
 * was bypassable.
 *
 * Normalizing first and comparing the resolved absolute path closes
 * that. Prefer looking the row up by id and reading its stored pathname
 * where you can; use this when the pathname genuinely has to come from
 * the client.
 */
export function resolveUploadPathWithin(pathname: string, expectedPrefix: string) {
  const absolutePath = resolveUploadPath(pathname);
  const absolutePrefix = path.join(getUploadRoot(), path.posix.normalize(expectedPrefix));

  if (
    absolutePath !== absolutePrefix &&
    !absolutePath.startsWith(`${absolutePrefix}${path.sep}`)
  ) {
    throw new Error("Upload path escapes its expected directory");
  }

  return absolutePath;
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
