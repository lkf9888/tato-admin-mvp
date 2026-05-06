"use client";

import { useEffect, useRef, useState } from "react";

import type { Locale } from "@/lib/i18n";
import { cn, formatDateTime } from "@/lib/utils";

type AttachmentKind = "photo" | "document";

type OrderAttachment = {
  id: string;
  orderId: string;
  kind: AttachmentKind;
  url: string;
  filename: string | null;
  contentType: string | null;
  size: number | null;
  uploadedAt: string;
};

function labels(locale: Locale) {
  return locale === "zh"
    ? {
        title: "照片、视频和合约文件",
        photos: "照片 / 视频",
        documents: "合约文件",
        uploadPhotos: "上传照片或视频",
        uploadDocuments: "上传合约文件",
        uploading: "上传中...",
        loading: "读取附件中...",
        emptyPhotos: "还没有照片或视频。",
        emptyDocs: "还没有合约文件。",
        delete: "删除",
        deleteConfirm: "确定隐藏这个附件吗？记录会保留在后台。",
        error: "附件暂时无法处理，请稍后再试。",
      }
    : {
        title: "Photos, videos, and contract files",
        photos: "Photos / videos",
        documents: "Contract files",
        uploadPhotos: "Upload photos or videos",
        uploadDocuments: "Upload contract files",
        uploading: "Uploading...",
        loading: "Loading attachments...",
        emptyPhotos: "No photos or videos yet.",
        emptyDocs: "No contract files yet.",
        delete: "Delete",
        deleteConfirm: "Hide this attachment? The backend record will be preserved.",
        error: "We could not process attachments right now. Please try again.",
      };
}

function isVideo(attachment: OrderAttachment) {
  const type = attachment.contentType?.toLowerCase() ?? "";
  const name = attachment.filename?.toLowerCase() ?? "";
  return type.startsWith("video/") || /\.(mp4|mov|m4v|webm|3gp|avi|qt)$/.test(name);
}

function isImage(attachment: OrderAttachment) {
  const type = attachment.contentType?.toLowerCase() ?? "";
  const name = attachment.filename?.toLowerCase() ?? "";
  return type.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp|heic|heif|avif)$/.test(name);
}

function formatSize(bytes: number | null) {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function OrderAttachments({
  orderId,
  locale,
  compact = false,
}: {
  orderId: string;
  locale: Locale;
  compact?: boolean;
}) {
  const copy = labels(locale);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const docInputRef = useRef<HTMLInputElement | null>(null);
  const [attachments, setAttachments] = useState<OrderAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<AttachmentKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/orders/${orderId}/attachments`)
      .then((response) => response.json())
      .then((payload) => {
        if (cancelled) return;
        setAttachments(Array.isArray(payload.attachments) ? payload.attachments : []);
      })
      .catch(() => {
        if (!cancelled) setError(copy.error);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [copy.error, orderId]);

  async function uploadFiles(kind: AttachmentKind, files: FileList | null) {
    if (!files?.length || uploading) return;
    setUploading(kind);
    setError(null);

    const formData = new FormData();
    formData.set("kind", kind);
    Array.from(files).forEach((file) => formData.append("files", file));

    try {
      const response = await fetch(`/api/orders/${orderId}/attachments`, {
        method: "POST",
        body: formData,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(payload.attachments)) {
        setError(copy.error);
        return;
      }
      setAttachments((current) => [...current, ...payload.attachments]);
    } catch {
      setError(copy.error);
    } finally {
      setUploading(null);
      if (photoInputRef.current) photoInputRef.current.value = "";
      if (docInputRef.current) docInputRef.current.value = "";
    }
  }

  async function deleteAttachment(attachment: OrderAttachment) {
    if (!window.confirm(copy.deleteConfirm)) return;

    const response = await fetch(`/api/orders/${orderId}/attachments/${attachment.id}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      setError(copy.error);
      return;
    }
    setAttachments((current) => current.filter((item) => item.id !== attachment.id));
  }

  const photos = attachments.filter((attachment) => attachment.kind === "photo");
  const documents = attachments.filter((attachment) => attachment.kind === "document");

  return (
    <section className={cn("rounded-lg border border-[var(--line)] bg-white/80", compact ? "p-3" : "p-4")}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--ink-soft)]">
            {copy.title}
          </p>
          {loading ? <p className="mt-1 text-[12px] text-[var(--ink-soft)]">{copy.loading}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={photoInputRef}
            type="file"
            multiple
            accept="image/*,video/*"
            className="hidden"
            onChange={(event) => uploadFiles("photo", event.target.files)}
          />
          <input
            ref={docInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => uploadFiles("document", event.target.files)}
          />
          <button
            type="button"
            onClick={() => photoInputRef.current?.click()}
            disabled={uploading !== null}
            className="rounded-full border border-[var(--line)] bg-white px-3 py-1.5 text-[12px] font-semibold text-[var(--ink)] disabled:opacity-60"
          >
            {uploading === "photo" ? copy.uploading : copy.uploadPhotos}
          </button>
          <button
            type="button"
            onClick={() => docInputRef.current?.click()}
            disabled={uploading !== null}
            className="rounded-full bg-[var(--ink)] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-60"
          >
            {uploading === "document" ? copy.uploading : copy.uploadDocuments}
          </button>
        </div>
      </div>

      {error ? (
        <p className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
          {error}
        </p>
      ) : null}

      <div className={cn("mt-3 grid gap-3", compact ? "xl:grid-cols-1" : "xl:grid-cols-2")}>
        <AttachmentGroup
          title={copy.photos}
          empty={copy.emptyPhotos}
          attachments={photos}
          locale={locale}
          deleteLabel={copy.delete}
          onDelete={deleteAttachment}
        />
        <AttachmentGroup
          title={copy.documents}
          empty={copy.emptyDocs}
          attachments={documents}
          locale={locale}
          deleteLabel={copy.delete}
          onDelete={deleteAttachment}
        />
      </div>
    </section>
  );
}

function AttachmentGroup({
  title,
  empty,
  attachments,
  locale,
  deleteLabel,
  onDelete,
}: {
  title: string;
  empty: string;
  attachments: OrderAttachment[];
  locale: Locale;
  deleteLabel: string;
  onDelete: (attachment: OrderAttachment) => void;
}) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
        {title}
      </p>
      {attachments.length === 0 ? (
        <p className="mt-2 rounded-md border border-dashed border-slate-200 bg-white px-3 py-4 text-[12px] text-[var(--ink-soft)]">
          {empty}
        </p>
      ) : (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {attachments.map((attachment) => (
            <article key={attachment.id} className="overflow-hidden rounded-md border border-slate-200 bg-white">
              <a href={attachment.url} target="_blank" rel="noreferrer" className="block">
                {isImage(attachment) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={attachment.url}
                    alt={attachment.filename ?? "attachment"}
                    className="h-28 w-full object-cover"
                  />
                ) : isVideo(attachment) ? (
                  <video src={attachment.url} className="h-28 w-full bg-slate-950 object-cover" controls />
                ) : (
                  <div className="flex h-28 items-center justify-center bg-slate-100 text-[12px] font-semibold text-[var(--ink-soft)]">
                    FILE
                  </div>
                )}
              </a>
              <div className="space-y-1 px-2.5 py-2">
                <p className="truncate text-[12px] font-semibold text-[var(--ink)]">
                  {attachment.filename ?? "attachment"}
                </p>
                <p className="text-[10.5px] text-[var(--ink-soft)]">
                  {formatDateTime(attachment.uploadedAt, locale)}
                  {attachment.size != null ? ` · ${formatSize(attachment.size)}` : ""}
                </p>
                <button
                  type="button"
                  onClick={() => onDelete(attachment)}
                  className="text-[11px] font-semibold text-rose-600"
                >
                  {deleteLabel}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
