import "server-only";

import { statfs } from "fs/promises";

import { getUploadRoot } from "@/lib/uploads";

/**
 * How full the persistent volume is.
 *
 * This exists because the volume filling up has already taken the
 * service down once: `cp` failed with ENOSPC inside the entrypoint,
 * `set -eu` aborted before `next start`, and the container went into a
 * tight crash loop. The pre-deploy snapshot now tolerates that failure,
 * but tolerating it only converts a crash into silence -- uploads keep
 * failing, and nothing says why.
 *
 * Nothing here deletes anything. Every photo, receipt and signed
 * contract ever uploaded is still on the volume, including the ones an
 * operator has "deleted" -- that path only sets `isArchived`. Whether
 * those files should ever be removed is a decision about somebody
 * else's records, not a cleanup task. What this does is make the
 * number visible before it becomes an outage.
 */
export type DiskUsage = {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  usedPercent: number;
};

export async function getDiskUsage(): Promise<DiskUsage | null> {
  try {
    const stats = await statfs(getUploadRoot());
    const totalBytes = stats.blocks * stats.bsize;
    const freeBytes = stats.bavail * stats.bsize;
    const usedBytes = totalBytes - freeBytes;
    if (!Number.isFinite(totalBytes) || totalBytes <= 0) return null;
    return {
      totalBytes,
      freeBytes,
      usedBytes,
      usedPercent: Math.round((usedBytes / totalBytes) * 1000) / 10,
    };
  } catch {
    // statfs is unavailable on some platforms and the upload root may
    // not exist yet on a fresh boot. Neither is worth an error page.
    return null;
  }
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
