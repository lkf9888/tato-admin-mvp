import "server-only";

import { readdir, stat, statfs } from "fs/promises";
import path from "path";

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


/**
 * Where the space actually went.
 *
 * "The disk is 90% full" is not actionable; "the backups are 300 MB of
 * it" is. Walks the data directory one level deep and sizes the
 * branches that matter, so the answer arrives without shelling into
 * the container.
 *
 * Sizes are computed recursively but bounded: a directory tree with
 * more than MAX_ENTRIES files stops counting and reports what it has,
 * because this runs inside a request and an unbounded walk of a full
 * disk is its own outage.
 */
const MAX_ENTRIES = 20_000;

async function directorySize(dir: string, budget: { left: number }): Promise<number> {
  let total = 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }

  for (const entry of entries) {
    if (budget.left <= 0) break;
    budget.left -= 1;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await directorySize(full, budget);
    } else {
      const info = await stat(full).catch(() => null);
      if (info) total += info.size;
    }
  }

  return total;
}

export async function getDiskBreakdown() {
  const dataRoot = path.dirname(getUploadRoot());
  const budget = { left: MAX_ENTRIES };

  let entries;
  try {
    entries = await readdir(dataRoot, { withFileTypes: true });
  } catch {
    return null;
  }

  const parts: Record<string, number> = {};

  for (const entry of entries) {
    const full = path.join(dataRoot, entry.name);
    if (entry.isDirectory()) {
      parts[entry.name] = await directorySize(full, budget);
    } else {
      const info = await stat(full).catch(() => null);
      if (info) parts[entry.name] = info.size;
    }
  }

  return Object.fromEntries(
    Object.entries(parts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([name, bytes]) => [name, formatBytes(bytes)]),
  );
}
