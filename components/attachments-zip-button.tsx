"use client";

import { useState } from "react";

import type { Locale } from "@/lib/i18n";

type ManifestItem = { path: string; size: number; url: string };

/** Above this the archive is built in the browser's memory at some risk. */
const LARGE_ARCHIVE_BYTES = 1.5 * 1024 * 1024 * 1024;
const CONCURRENCY = 4;

function copy(locale: Locale) {
  return locale === "en"
    ? {
        button: "Download as ZIP",
        listing: "Listing files…",
        packing: (done: number, total: number) => `Packing ${done}/${total}…`,
        saving: "Saving…",
        empty: "Nothing to download for this filter.",
        large: (size: string) => `This is about ${size}. The ZIP is built in the browser, which can be slow or run out of memory. Continue?`,
        failedNote: "These files could not be downloaded:",
        partial: (failed: number) => `Done. ${failed} file(s) could not be downloaded; they are listed in the ZIP.`,
        failed: "Could not build the ZIP. Try again, or narrow the filter.",
      }
    : {
        button: "打包下载 ZIP",
        listing: "读取文件清单…",
        packing: (done: number, total: number) => `打包中 ${done}/${total}…`,
        saving: "保存中…",
        empty: "这个筛选下没有可下载的文件。",
        large: (size: string) => `大约 ${size}。ZIP 是在浏览器里拼的，可能很慢或者内存不够。继续吗？`,
        failedNote: "以下文件没能下载：",
        partial: (failed: number) => `完成。有 ${failed} 个文件没能下载，清单在 ZIP 里。`,
        failed: "ZIP 打包失败。请重试，或者缩小筛选范围。",
      };
}

function formatSize(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}

/**
 * Download what the photos or documents page shows as one ZIP, foldered
 * by car and then by trip.
 *
 * The server only lists the files (`/api/exports/attachments`); this
 * fetches each one through the same route the page links to and zips
 * them here. Already-compressed photos and videos are stored, not
 * squeezed again, which is most of the speed. A file that fails to
 * download does not sink the archive -- it is named in a note inside it.
 */
export function AttachmentsZipButton({
  kind,
  vehicle,
  q,
  locale,
  filename,
}: {
  kind: "photo" | "document";
  vehicle: string;
  q: string;
  locale: Locale;
  filename: string;
}) {
  const t = copy(locale);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setStatus(t.listing);
    try {
      const params = new URLSearchParams({ kind, locale });
      if (vehicle) params.set("vehicle", vehicle);
      if (q) params.set("q", q);
      const response = await fetch(`/api/exports/attachments?${params.toString()}`);
      if (!response.ok) throw new Error("manifest");
      const { items } = (await response.json()) as { items: ManifestItem[] };
      if (items.length === 0) {
        setStatus(t.empty);
        return;
      }
      const totalBytes = items.reduce((sum, item) => sum + item.size, 0);
      if (totalBytes > LARGE_ARCHIVE_BYTES && !window.confirm(t.large(formatSize(totalBytes)))) {
        setStatus(null);
        return;
      }

      // Loaded on click: nobody who never presses this pays for jszip.
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      const failed: string[] = [];
      let done = 0;
      let next = 0;
      setStatus(t.packing(0, items.length));

      async function worker() {
        while (next < items.length) {
          const item = items[next++];
          try {
            const fileResponse = await fetch(item.url);
            if (!fileResponse.ok) throw new Error(String(fileResponse.status));
            zip.file(item.path, await fileResponse.arrayBuffer(), { binary: true });
          } catch {
            failed.push(item.path);
          }
          done += 1;
          setStatus(t.packing(done, items.length));
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));

      if (failed.length) zip.file("_failed.txt", `${t.failedNote}\n${failed.join("\n")}\n`);
      setStatus(t.saving);
      const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 60_000);
      setStatus(failed.length ? t.partial(failed.length) : null);
    } catch {
      setStatus(t.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="btn-secondary min-h-9 px-3 text-sm" onClick={() => void run()} disabled={busy}>
        {busy && status ? status : t.button}
      </button>
      {!busy && status ? <span className="text-xs text-[var(--ink-soft)]">{status}</span> : null}
    </div>
  );
}
