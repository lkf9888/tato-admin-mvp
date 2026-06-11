"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type FieldType = "SIGNATURE" | "TEXT" | "DATE" | "CHECKBOX" | "REDACTION";

type TemplateField = {
  id: string;
  type: FieldType;
  label: string;
  required: boolean;
  recipientIndex: number | null;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  placeholder: string | null;
  defaultValue: string | null;
  fontSize: number | null;
  sortOrder: number;
};

type Template = {
  id: string;
  name: string;
  description: string | null;
  pdfUrl: string;
  pdfPathname: string;
  pdfFilename: string | null;
  pdfContentType?: string | null;
  pdfSize: number | null;
  sourceType?: string | null;
  sourceUrl?: string | null;
  sourcePathname?: string | null;
  sourceFilename?: string | null;
  sourceContentType?: string | null;
  sourceSize?: number | null;
  editableContent?: string | null;
  pageCount: number;
  pageSizes: unknown;
  active: boolean;
  fields: TemplateField[];
  recipients: TemplateRecipient[];
  createdAt: string;
};

type TemplateRecipient = {
  id?: string;
  name: string;
  email: string;
  signingOrder: number;
};

type Envelope = {
  id: string;
  title: string;
  status: string;
  signedPdfUrl: string | null;
  signedPdfSha256?: string | null;
  createdAt: string;
  completedAt: string | null;
  template: { id: string; name: string };
  booking: null | {
    id: string;
    guestName: string | null;
    checkIn: string;
    checkOut: string;
    property: { name: string; nickname: string | null };
  };
  recipients: Array<{
    id: string;
    name: string;
    email: string;
    signingOrder: number;
    token: string;
    status: string;
    signedAt: string | null;
  }>;
};

type BookingOption = {
  id: string;
  guestName: string | null;
  guestEmail: string | null;
  checkIn: string;
  checkOut: string;
  property: { name: string; nickname: string | null };
};

type PageSize = { page: number; width: number; height: number };
type DraftRecipient = { name: string; email: string };
type ContractMode = "manage" | "create" | "edit";
type TextPreset = {
  id: string;
  label: string;
  value: string;
  createdAt: string;
};

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  SIGNATURE: "签名框",
  TEXT: "文本框",
  DATE: "日期框",
  CHECKBOX: "勾选框",
  REDACTION: "文字涂改",
};

const PDF_ZOOM_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const RECIPIENT_COLORS = [
  { border: "#2563eb", bg: "rgba(37, 99, 235, 0.18)", text: "#1d4ed8" },
  { border: "#059669", bg: "rgba(5, 150, 105, 0.18)", text: "#047857" },
  { border: "#dc2626", bg: "rgba(220, 38, 38, 0.16)", text: "#b91c1c" },
  { border: "#7c3aed", bg: "rgba(124, 58, 237, 0.16)", text: "#6d28d9" },
  { border: "#ea580c", bg: "rgba(234, 88, 12, 0.16)", text: "#c2410c" },
  { border: "#0891b2", bg: "rgba(8, 145, 178, 0.16)", text: "#0e7490" },
];
const REDACTION_COLOR = { border: "#111827", bg: "rgba(17, 24, 39, 0.24)", text: "#111827" };

function safeFileStem(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "contract"
  );
}

function isWordFile(file: File) {
  return file.name.toLowerCase().endsWith(".docx")
    || file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}

function sourceContentTypeForFile(file: File) {
  return isWordFile(file)
    ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    : "application/pdf";
}

async function readJsonResponse<T extends Record<string, unknown> = Record<string, unknown>>(
  res: Response,
): Promise<T> {
  const text = await res.text();
  if (!text.trim()) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(text.slice(0, 300) || `HTTP ${res.status}`);
  }
}

async function uploadContractFile(_pathname: string, file: File) {
  const formData = new FormData();
  formData.set("file", file);
  const res = await fetch("/api/contracts/templates/upload-token", {
    method: "POST",
    body: formData,
  });
  const payload = await readJsonResponse<{
    url: string;
    pathname: string;
    filename?: string;
    contentType?: string;
    size?: number;
    error?: string;
  }>(res);
  if (!res.ok) throw new Error(payload.error || "文件上传失败。");
  return payload;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
}

function defaultPageSizes(template: Template | null): PageSize[] {
  const raw = template?.pageSizes;
  if (Array.isArray(raw) && raw.length) {
    return raw
      .map((item) => {
        const record = item as Record<string, unknown>;
        return {
          page: Number(record.page) || 1,
          width: Number(record.width) || 612,
          height: Number(record.height) || 792,
        };
      })
      .filter((item) => item.width > 0 && item.height > 0);
  }
  const count = Math.max(1, template?.pageCount || 1);
  return Array.from({ length: count }, (_, index) => ({
    page: index + 1,
    width: 612,
    height: 792,
  }));
}

export default function ContractsClient({
  userId,
  templates: initialTemplates,
  envelopes: initialEnvelopes,
  textPresets: initialTextPresets,
  bookings,
  mode = "manage",
}: {
  userId: string;
  templates: Template[];
  envelopes: Envelope[];
  textPresets: TextPreset[];
  bookings: BookingOption[];
  mode?: ContractMode;
}) {
  const router = useRouter();
  const [templates, setTemplates] = useState(initialTemplates);
  const [envelopes, setEnvelopes] = useState(initialEnvelopes);
  const [textPresets, setTextPresets] = useState(initialTextPresets);
  const [selectedTemplateId, setSelectedTemplateId] = useState(initialTemplates[0]?.id || "");
  const [fields, setFields] = useState<TemplateField[]>(initialTemplates[0]?.fields || []);
  const [uploadName, setUploadName] = useState("");
  const [uploadDescription, setUploadDescription] = useState("");
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [appendFile, setAppendFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pdfZoom, setPdfZoom] = useState(1);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const localFieldCounterRef = useRef(0);
  const [fieldInteraction, setFieldInteraction] = useState<{
    id: string;
    mode: "move" | "resize";
    startX: number;
    startY: number;
    originalX: number;
    originalY: number;
    originalWidth: number;
    originalHeight: number;
    minWidth: number;
    minHeight: number;
    rect: DOMRect;
  } | null>(null);

  const [sendTemplateId, setSendTemplateId] = useState("");
  const [sendTitle, setSendTitle] = useState("");
  const [sendMessage, setSendMessage] = useState("");
  const [sendBookingId, setSendBookingId] = useState("");
  const [recipients, setRecipients] = useState<DraftRecipient[]>([
    { name: "", email: "" },
  ]);
  const [templateRecipients, setTemplateRecipients] = useState<DraftRecipient[]>(
    initialTemplates[0]?.recipients?.length
      ? initialTemplates[0].recipients.map((recipient) => ({
          name: recipient.name,
          email: recipient.email,
        }))
      : [{ name: "", email: "" }],
  );
  const [recipientSaveStatus, setRecipientSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [presetLabel, setPresetLabel] = useState("");
  const [presetValue, setPresetValue] = useState("");
  const recipientAutoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [editableContent, setEditableContent] = useState(initialTemplates[0]?.editableContent || "");
  const [fieldInsertPage, setFieldInsertPage] = useState(1);
  const [savedFieldsSnapshot, setSavedFieldsSnapshot] = useState(() =>
    snapshotFields(initialTemplates[0]?.fields || []),
  );
  const [savedRecipientsSnapshot, setSavedRecipientsSnapshot] = useState(() =>
    snapshotRecipients(
      initialTemplates[0]?.recipients?.length
        ? initialTemplates[0].recipients.map((recipient) => ({
            name: recipient.name,
            email: recipient.email,
          }))
        : [{ name: "", email: "" }],
    ),
  );
  const [savedEditableSnapshot, setSavedEditableSnapshot] = useState(
    initialTemplates[0]?.editableContent || "",
  );
  const [pendingNavigationHref, setPendingNavigationHref] = useState<string | null>(null);
  const [savingBeforeLeave, setSavingBeforeLeave] = useState(false);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) || null,
    [selectedTemplateId, templates],
  );
  const selectedField = useMemo(
    () => fields.find((field) => field.id === selectedFieldId) || null,
    [fields, selectedFieldId],
  );
  const pageSizes = useMemo(() => defaultPageSizes(selectedTemplate), [selectedTemplate]);
  const fieldInsertPageMax = Math.max(1, pageSizes.length || selectedTemplate?.pageCount || 1);
  const validFieldInsertPage = clampPage(fieldInsertPage, fieldInsertPageMax);
  const signerOptions = useMemo(
    () => Array.from({ length: Math.max(1, templateRecipients.length) }, (_, index) => index + 1),
    [templateRecipients.length],
  );
  const isEditMode = mode === "edit";
  const fieldSnapshot = useMemo(() => snapshotFields(fields), [fields]);
  const recipientSnapshot = useMemo(
    () => snapshotRecipients(templateRecipients),
    [templateRecipients],
  );
  const fieldsDirty = fieldSnapshot !== savedFieldsSnapshot;
  const recipientsDirty = recipientSnapshot !== savedRecipientsSnapshot;
  const editableDirty =
    selectedTemplate?.sourceType === "WORD" &&
    editableContent !== savedEditableSnapshot;
  const hasUnsavedTemplateChanges =
    mode !== "manage" && Boolean(selectedTemplate) && (fieldsDirty || recipientsDirty || editableDirty);
  const completedEnvelopes = useMemo(
    () => envelopes.filter((envelope) => envelope.status === "COMPLETED" && envelope.signedPdfUrl),
    [envelopes],
  );

  useEffect(() => {
    return () => {
      if (recipientAutoSaveTimerRef.current) {
        clearTimeout(recipientAutoSaveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!hasUnsavedTemplateChanges) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasUnsavedTemplateChanges]);

  useEffect(() => {
    if (!hasUnsavedTemplateChanges) return;
    function onDocumentClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target || anchor.download || anchor.href.startsWith("mailto:")) return;
      const nextUrl = new URL(anchor.href);
      if (nextUrl.origin !== window.location.origin) return;
      if (
        nextUrl.pathname === window.location.pathname &&
        nextUrl.search === window.location.search &&
        nextUrl.hash === window.location.hash
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setPendingNavigationHref(anchor.href);
    }
    document.addEventListener("click", onDocumentClick, true);
    return () => document.removeEventListener("click", onDocumentClick, true);
  }, [hasUnsavedTemplateChanges]);

  useEffect(() => {
    if (!fieldInteraction) return;
    const activeInteraction = fieldInteraction;
    function onPointerMove(event: PointerEvent) {
      const dx = (event.clientX - activeInteraction.startX) / activeInteraction.rect.width;
      const dy = (event.clientY - activeInteraction.startY) / activeInteraction.rect.height;
      setFields((prev) =>
        prev.map((field) =>
          field.id === activeInteraction.id
            ? activeInteraction.mode === "resize"
              ? {
                  ...field,
                  width: clampFieldSize(
                    activeInteraction.originalWidth + dx,
                    activeInteraction.minWidth,
                    1 - activeInteraction.originalX,
                  ),
                  height: clampFieldSize(
                    activeInteraction.originalHeight + dy,
                    activeInteraction.minHeight,
                    1 - activeInteraction.originalY,
                  ),
                }
              : {
                  ...field,
                  x: clamp(activeInteraction.originalX + dx, 0, 1 - activeInteraction.originalWidth),
                  y: clamp(activeInteraction.originalY + dy, 0, 1 - activeInteraction.originalHeight),
                }
            : field,
        ),
      );
    }
    function onPointerUp() {
      setFieldInteraction(null);
    }
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [fieldInteraction]);

  function syncSavedTemplateSnapshots(template: Template | null, recipientsOverride?: DraftRecipient[]) {
    const nextRecipients = recipientsOverride || (
      template?.recipients?.length
        ? template.recipients.map((recipient) => ({
            name: recipient.name,
            email: recipient.email,
          }))
        : [{ name: "", email: "" }]
    );
    setSavedFieldsSnapshot(snapshotFields(template?.fields || []));
    setSavedRecipientsSnapshot(snapshotRecipients(nextRecipients));
    setSavedEditableSnapshot(template?.editableContent || "");
  }

  async function createTemplate() {
    if (!templateFile) {
      setError("请选择 PDF 或 Word 模板。");
      return;
    }
    const name = uploadName.trim() || templateFile.name.replace(/\.(pdf|docx)$/i, "");
    const sourceType = isWordFile(templateFile) ? "WORD" : "PDF";
    setBusy("upload");
    setError(null);
    setNotice(null);
    try {
      const extension = sourceType === "WORD" ? "docx" : "pdf";
      const pathname = `contracts/templates/${userId}/${Date.now()}-${safeFileStem(templateFile.name)}.${extension}`;
      const blob = await uploadContractFile(pathname, templateFile);
      const res = await fetch("/api/contracts/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: uploadDescription,
          sourceType,
          sourceUrl: blob.url,
          sourcePathname: blob.pathname,
          sourceFilename: templateFile.name,
          sourceContentType: templateFile.type || sourceContentTypeForFile(templateFile),
          sourceSize: templateFile.size,
          pdfUrl: blob.url,
          pdfPathname: blob.pathname,
          pdfFilename: templateFile.name,
          pdfContentType: templateFile.type || sourceContentTypeForFile(templateFile),
          pdfSize: templateFile.size,
          recipients: cleanDraftRecipients(templateRecipients),
        }),
      });
      const data = await readJsonResponse<{ template: Template; error?: string }>(res);
      if (!res.ok || !data.template) throw new Error(data.error || "上传失败。");
      const nextRecipients = data.template.recipients?.length
        ? data.template.recipients.map((recipient: TemplateRecipient) => ({
            name: recipient.name,
            email: recipient.email,
          }))
        : templateRecipients;
      setTemplates((prev) => [data.template, ...prev]);
      setSelectedTemplateId(data.template.id);
      setSendTemplateId(data.template.id);
      setFields(data.template.fields || []);
      setSelectedFieldId(null);
      setTemplateRecipients(nextRecipients);
      setEditableContent(data.template.editableContent || "");
      syncSavedTemplateSnapshots(data.template, nextRecipients);
      setUploadName("");
      setUploadDescription("");
      setTemplateFile(null);
      setNotice("模板已创建。");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function deleteTemplate(template: Template) {
    const ok = window.confirm(`确认删除合约模板「${template.name}」？已有签约记录会保留。`);
    if (!ok) return;
    setBusy(`delete-template-${template.id}`);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/contracts/templates/${template.id}`, { method: "DELETE" });
      const data = await readJsonResponse<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "删除失败。");
      const nextTemplates = templates.filter((item) => item.id !== template.id);
      setTemplates(nextTemplates);
      if (selectedTemplateId === template.id) {
        const next = nextTemplates[0] || null;
        const nextRecipients = next?.recipients?.length
          ? next.recipients.map((recipient) => ({
              name: recipient.name,
              email: recipient.email,
            }))
          : [{ name: "", email: "" }];
        setSelectedTemplateId(next?.id || "");
        setSendTemplateId((current) => current === template.id ? "" : current);
        setFields(next?.fields || []);
        setEditableContent(next?.editableContent || "");
        setTemplateRecipients(nextRecipients);
        syncSavedTemplateSnapshots(next, nextRecipients);
        setSelectedFieldId(null);
      }
      if (sendTemplateId === template.id) {
        setSendTemplateId("");
      }
      setNotice("模板已删除。");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function appendTemplateDocument() {
    if (!selectedTemplate || !appendFile) {
      setError("请先选择要追加的 PDF 或 Word 文件。");
      return;
    }
    const sourceType = isWordFile(appendFile) ? "WORD" : "PDF";
    setBusy("append-document");
    setError(null);
    setNotice(null);
    try {
      const extension = sourceType === "WORD" ? "docx" : "pdf";
      const pathname = `contracts/templates/${userId}/${Date.now()}-${safeFileStem(appendFile.name)}.${extension}`;
      const blob = await uploadContractFile(pathname, appendFile);
      const res = await fetch(`/api/contracts/templates/${selectedTemplate.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appendDocument: {
            sourceType,
            sourceUrl: blob.url,
            sourcePathname: blob.pathname,
            sourceFilename: appendFile.name,
            sourceContentType: appendFile.type || sourceContentTypeForFile(appendFile),
            sourceSize: appendFile.size,
          },
        }),
      });
      const data = await readJsonResponse<{ template: Template; error?: string }>(res);
      if (!res.ok || !data.template) throw new Error(data.error || "追加文件失败。");
      setTemplates((prev) =>
        prev.map((item) => item.id === data.template.id ? data.template : item),
      );
      setFields(data.template.fields || fields);
      setEditableContent(data.template.editableContent || editableContent);
      setFieldInsertPage(data.template.pageCount || fieldInsertPage);
      setAppendFile(null);
      setNotice("文件已追加到模板末尾。");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function createTextPreset() {
    const value = presetValue.trim();
    const label = presetLabel.trim() || value.slice(0, 60);
    if (!value) {
      setError("请先填写预存文本。");
      return;
    }
    setBusy("preset");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/contracts/text-presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, value }),
      });
      const data = await readJsonResponse<{ preset: TextPreset; error?: string }>(res);
      if (!res.ok || !data.preset) throw new Error(data.error || "保存预存文本失败。");
      setTextPresets((prev) => [data.preset, ...prev]);
      setPresetLabel("");
      setPresetValue("");
      setNotice("预存文本已保存。");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function deleteTextPreset(preset: TextPreset) {
    const ok = window.confirm(`确认删除预存文本「${preset.label}」？`);
    if (!ok) return;
    setBusy(`delete-preset-${preset.id}`);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/contracts/text-presets?id=${encodeURIComponent(preset.id)}`, {
        method: "DELETE",
      });
      const data = await readJsonResponse<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "删除预存文本失败。");
      setTextPresets((prev) => prev.filter((item) => item.id !== preset.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  function scheduleTemplateRecipientsAutoSave(nextRecipients: DraftRecipient[]) {
    if (!isEditMode || !selectedTemplate) return;
    if (recipientAutoSaveTimerRef.current) {
      clearTimeout(recipientAutoSaveTimerRef.current);
    }
    recipientAutoSaveTimerRef.current = setTimeout(() => {
      void saveTemplateRecipientsOnly(nextRecipients);
    }, 700);
  }

  async function saveTemplateRecipientsOnly(nextRecipients: DraftRecipient[]) {
    if (!selectedTemplate || !canSaveDraftRecipients(nextRecipients)) {
      setRecipientSaveStatus("idle");
      return false;
    }
    setRecipientSaveStatus("saving");
    setError(null);
    try {
      const res = await fetch(`/api/contracts/templates/${selectedTemplate.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipients: cleanDraftRecipients(nextRecipients) }),
      });
      const data = await readJsonResponse<{ template: Template; error?: string }>(res);
      if (!res.ok || !data.template) throw new Error(data.error || "保存签署人失败。");
      setTemplates((prev) =>
        prev.map((item) => item.id === data.template.id ? data.template : item),
      );
      setSavedRecipientsSnapshot(snapshotRecipients(nextRecipients));
      setRecipientSaveStatus("saved");
      return true;
    } catch (err) {
      setRecipientSaveStatus("error");
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  function saveTemplateRecipientsNow() {
    if (recipientAutoSaveTimerRef.current) {
      clearTimeout(recipientAutoSaveTimerRef.current);
      recipientAutoSaveTimerRef.current = null;
    }
    void saveTemplateRecipientsOnly(templateRecipients);
  }

  function addField(type: FieldType) {
    localFieldCounterRef.current += 1;
    const id = `local-${localFieldCounterRef.current}`;
    const targetPage = validFieldInsertPage;
    setFields((prev) => [
      ...prev,
      {
        id,
        type,
        label: FIELD_TYPE_LABELS[type],
        required: type !== "REDACTION" && type !== "CHECKBOX",
        recipientIndex: type === "REDACTION" ? null : 1,
        page: targetPage,
        x: 0.12,
        y: 0.12 + Math.min(prev.filter((field) => field.page === targetPage).length, 8) * 0.06,
        width: type === "CHECKBOX" ? 0.08 : type === "REDACTION" ? 0.22 : 0.28,
        height: type === "SIGNATURE" ? 0.08 : type === "REDACTION" ? 0.035 : 0.045,
        placeholder: null,
        defaultValue: null,
        fontSize: null,
        sortOrder: prev.length,
      },
    ]);
    setSelectedFieldId(id);
  }

  function duplicateField(id: string) {
    const source = fields.find((field) => field.id === id);
    if (!source) return;
    localFieldCounterRef.current += 1;
    const nextId = `local-${localFieldCounterRef.current}`;
    const nextField: TemplateField = {
      ...source,
      id: nextId,
      label: source.label || FIELD_TYPE_LABELS[source.type],
      x: clamp(source.x + 0.02, 0, 1 - source.width),
      y: clamp(source.y + 0.02, 0, 1 - source.height),
      sortOrder: fields.length,
    };
    setFields((prev) => [...prev, nextField]);
    setSelectedFieldId(nextId);
  }

  async function saveFields() {
    if (!selectedTemplate) return false;
    setBusy("fields");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/contracts/templates/${selectedTemplate.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipients: cleanDraftRecipients(templateRecipients),
          fields: fields.map((field) => ({
            ...field,
            required: field.type === "REDACTION" || field.type === "CHECKBOX" ? false : field.required,
            recipientIndex: field.type === "REDACTION" ? null : field.recipientIndex ?? 1,
          })),
        }),
      });
      const data = await readJsonResponse<{ template: Template; error?: string }>(res);
      if (!res.ok || !data.template) throw new Error(data.error || "保存失败。");
      setTemplates((prev) =>
        prev.map((item) => item.id === data.template.id ? data.template : item),
      );
      const nextRecipients =
        data.template.recipients?.length
          ? data.template.recipients.map((recipient: TemplateRecipient) => ({
              name: recipient.name,
              email: recipient.email,
            }))
          : [{ name: "", email: "" }];
      setTemplateRecipients(nextRecipients);
      setEditableContent(data.template.editableContent || editableContent);
      const nextFields = data.template.fields || fields;
      setFields(nextFields);
      setSavedFieldsSnapshot(snapshotFields(nextFields));
      setSavedRecipientsSnapshot(snapshotRecipients(nextRecipients));
      setNotice(mode === "create" ? "模板已保存。" : "字段已保存。");
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function saveEditableContent() {
    if (!selectedTemplate || selectedTemplate.sourceType !== "WORD") return false;
    setBusy("editable-content");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/contracts/templates/${selectedTemplate.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ editableContent }),
      });
      const data = await readJsonResponse<{ template: Template; error?: string }>(res);
      if (!res.ok || !data.template) throw new Error(data.error || "保存 Word 内容失败。");
      setTemplates((prev) =>
        prev.map((item) => item.id === data.template.id ? data.template : item),
      );
      const nextFields = data.template.fields || [];
      setFields(nextFields);
      setEditableContent(data.template.editableContent || editableContent);
      setSavedFieldsSnapshot(snapshotFields(nextFields));
      setSavedEditableSnapshot(data.template.editableContent || editableContent);
      setNotice("Word 内容已保存，并已重新生成签署 PDF。");
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function saveAllTemplateChangesBeforeLeave() {
    if (!selectedTemplate) return true;
    if (recipientAutoSaveTimerRef.current) {
      clearTimeout(recipientAutoSaveTimerRef.current);
      recipientAutoSaveTimerRef.current = null;
    }
    let ok = true;
    if (editableDirty) {
      ok = await saveEditableContent();
    }
    if (ok && (fieldsDirty || recipientsDirty)) {
      ok = await saveFields();
    }
    return ok;
  }

  async function sendEnvelope() {
    const cleanedRecipients = recipients
      .map((item) => ({ name: item.name.trim(), email: item.email.trim() }))
      .filter((item) => item.name && item.email);
    if (!sendTemplateId || !sendTitle.trim() || cleanedRecipients.length === 0) {
      setError("请选择模板，并填写标题和至少一个租客。");
      return;
    }
    setBusy("send");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/contracts/envelopes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId: sendTemplateId,
          title: sendTitle,
          message: sendMessage,
          orderId: sendBookingId || null,
          recipients: cleanedRecipients,
        }),
      });
      const data = await readJsonResponse<{ envelope: Envelope; emailFailures?: unknown[]; error?: string }>(res);
      if (!res.ok || !data.envelope) throw new Error(data.error || "发送失败。");
      setEnvelopes((prev) => [data.envelope, ...prev]);
      setSendTitle("");
      setSendMessage("");
      setRecipients([{ name: "", email: "" }]);
      setNotice(
        data.emailFailures?.length
          ? `已创建，但 ${data.emailFailures.length} 个邮件发送失败。`
          : "已创建，第一位签署人的签约邮件已发送。",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function deleteEnvelopeDocument(envelope: Envelope) {
    const ok = window.confirm(`确认删除已完成合约「${envelope.title}」？`);
    if (!ok) return;
    setBusy(`delete-envelope-${envelope.id}`);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/contracts/envelopes/${envelope.id}`, {
        method: "DELETE",
      });
      const data = await readJsonResponse<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "删除历史文档失败。");
      setEnvelopes((prev) => prev.filter((item) => item.id !== envelope.id));
      setNotice("历史文档已删除。");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  function fillFromBooking(value: string) {
    setSendBookingId(value);
    const booking = bookings.find((item) => item.id === value);
    if (!booking) return;
    setSendTitle(
      `${booking.property.nickname || booking.property.name} · ${booking.guestName || "Guest"} rental contract`,
    );
    if (booking.guestName || booking.guestEmail) {
      setRecipients([{ name: booking.guestName || "", email: booking.guestEmail || "" }]);
    }
  }

  function selectSendTemplate(templateId: string) {
    setSendTemplateId(templateId);
    const template = templates.find((item) => item.id === templateId);
    if (template?.recipients?.length) {
      setRecipients(template.recipients.map((recipient) => ({
        name: recipient.name,
        email: recipient.email,
      })));
    }
  }

  if (mode === "manage") {
    return (
      <div className="max-w-7xl space-y-5 p-3 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">电子合约签约</h1>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              管理合约模板，发送给一个或多个租客在线签署。
            </p>
          </div>
          <Link href="/contracts/templates/new" className="btn-primary text-center">
            + 创建合约模板
          </Link>
        </div>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        {notice && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</div>}

        <section className="card p-4">
          <h2 className="text-lg font-semibold">合约模板</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {templates.length === 0 ? (
              <div className="rounded-lg border border-dashed border-neutral-300 p-4 text-sm text-neutral-500">
                还没有模板。点击右上角创建合约模板。
              </div>
            ) : templates.map((template) => (
              <div key={template.id} className="rounded-xl border border-neutral-200 p-3 text-sm dark:border-neutral-800">
                <div className="font-semibold">{template.name}</div>
                <div className="mt-1 text-xs text-neutral-500">
                  {template.pageCount} 页 · {template.fields.length} 个字段 · {template.recipients?.length || 0} 位签署人
                </div>
                {template.recipients?.length ? (
                  <div className="mt-2 space-y-1 text-xs text-neutral-500">
                    {template.recipients.map((recipient) => (
                      <div key={`${template.id}-${recipient.signingOrder}`}>
                        {recipient.signingOrder}. {recipient.name} · {recipient.email}
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link className="btn-secondary text-xs" href={`/contracts/templates/${template.id}`}>
                    编辑模板
                  </Link>
                  <a className="btn-secondary text-xs" href={template.pdfUrl} target="_blank" rel="noreferrer">
                    查看 PDF
                  </a>
                  <button
                    type="button"
                    className="text-xs font-semibold text-red-600 disabled:opacity-50"
                    disabled={busy === `delete-template-${template.id}`}
                    onClick={() => deleteTemplate(template)}
                  >
                    {busy === `delete-template-${template.id}` ? "删除中…" : "删除模板"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="card p-4">
          <h2 className="text-lg font-semibold">发送给租客签署</h2>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <label className="block text-sm">
              <span className="font-medium">选择模板</span>
              <select className="input mt-1" value={sendTemplateId} onChange={(e) => selectSendTemplate(e.target.value)}>
                <option value="">选择模板</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>{template.name}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="font-medium">绑定订单（可选）</span>
              <select className="input mt-1" value={sendBookingId} onChange={(e) => fillFromBooking(e.target.value)}>
                <option value="">不绑定订单</option>
                {bookings.map((booking) => (
                  <option key={booking.id} value={booking.id}>
                    {booking.property.nickname || booking.property.name} · {booking.guestName || "Guest"} · {formatDate(booking.checkIn)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm lg:col-span-2">
              <span className="font-medium">合约标题</span>
              <input className="input mt-1" value={sendTitle} onChange={(e) => setSendTitle(e.target.value)} placeholder="例如：Short-term rental agreement - 9900-1" />
            </label>
            <label className="block text-sm lg:col-span-2">
              <span className="font-medium">邮件备注</span>
              <textarea className="input mt-1 min-h-20" value={sendMessage} onChange={(e) => setSendMessage(e.target.value)} placeholder="可选，会显示在签署邮件里。" />
            </label>
          </div>
          <div className="mt-4 space-y-2">
            <div className="font-medium">租客 / 签署人</div>
            {recipients.map((recipient, index) => (
              <div key={index} className="grid gap-2 sm:grid-cols-[80px_1fr_1fr_auto]">
                <div className="flex items-center text-sm text-neutral-500">第 {index + 1} 位</div>
                <input className="input" value={recipient.name} onChange={(e) => updateRecipient(index, { name: e.target.value })} placeholder="姓名" />
                <input className="input" value={recipient.email} onChange={(e) => updateRecipient(index, { email: e.target.value })} placeholder="Email" />
                <button type="button" className="btn-secondary text-sm" onClick={() => setRecipients((prev) => prev.filter((_, i) => i !== index))} disabled={recipients.length === 1}>
                  删除
                </button>
              </div>
            ))}
            <button type="button" className="btn-secondary text-sm" onClick={() => setRecipients((prev) => [...prev, { name: "", email: "" }])}>
              + 添加签署人
            </button>
          </div>
          <button type="button" className="btn-primary mt-4" disabled={busy === "send"} onClick={sendEnvelope}>
            {busy === "send" ? "发送中…" : "发送签约邮件"}
          </button>
        </section>

        <section className="card p-4">
          <h2 className="text-lg font-semibold">签约记录</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-neutral-500">
                <tr className="border-b">
                  <th className="py-2 pr-4">合约</th>
                  <th className="py-2 pr-4">状态</th>
                  <th className="py-2 pr-4">签署人</th>
                  <th className="py-2 pr-4">创建日期</th>
                  <th className="py-2 pr-4">文件</th>
                </tr>
              </thead>
              <tbody>
                {envelopes.map((envelope) => (
                  <tr key={envelope.id} className="border-b border-neutral-100 dark:border-neutral-800">
                    <td className="py-2 pr-4">
                      <div className="font-medium">{envelope.title}</div>
                      <div className="text-xs text-neutral-500">{envelope.template?.name}</div>
                    </td>
                    <td className="py-2 pr-4">{envelope.status}</td>
                    <td className="py-2 pr-4">
                      {envelope.recipients.map((recipient) => (
                        <div key={recipient.id} className="text-xs">
                          {recipient.signingOrder}. {recipient.name} · {recipient.status}
                        </div>
                      ))}
                    </td>
                    <td className="py-2 pr-4">{formatDate(envelope.createdAt)}</td>
                    <td className="py-2 pr-4">
                      {envelope.signedPdfUrl ? (
                        <div className="flex flex-wrap gap-2">
                          <a className="text-blue-600 hover:underline" href={envelope.signedPdfUrl} target="_blank" rel="noreferrer">
                            下载 signed PDF
                          </a>
                          <button
                            type="button"
                            className="text-red-600 hover:underline disabled:opacity-50"
                            disabled={busy === `delete-envelope-${envelope.id}`}
                            onClick={() => deleteEnvelopeDocument(envelope)}
                          >
                            {busy === `delete-envelope-${envelope.id}` ? "删除中…" : "删除"}
                          </button>
                        </div>
                      ) : (
                        <span className="text-neutral-400">未完成</span>
                      )}
                    </td>
                  </tr>
                ))}
                {envelopes.length === 0 && (
                  <tr>
                    <td className="py-8 text-center text-neutral-500" colSpan={5}>暂无签约记录。</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card p-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">历史文档</h2>
              <p className="text-sm text-neutral-500">已完成签署的合约 PDF，可下载或删除。</p>
            </div>
            <div className="text-sm text-neutral-500">共 {completedEnvelopes.length} 份</div>
          </div>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {completedEnvelopes.map((envelope) => (
              <div key={envelope.id} className="rounded-xl border border-neutral-200 p-3 text-sm dark:border-neutral-800">
                <div className="font-semibold">{envelope.title}</div>
                <div className="mt-1 text-xs text-neutral-500">
                  {envelope.template?.name} · 完成于 {formatDate(envelope.completedAt || envelope.createdAt)}
                </div>
                <div className="mt-2 flex flex-wrap gap-1 text-xs text-neutral-500">
                  {envelope.recipients.map((recipient) => (
                    <span key={recipient.id} className="rounded-full bg-neutral-100 px-2 py-1 dark:bg-neutral-800">
                      {recipient.signingOrder}. {recipient.name}
                    </span>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <a className="btn-secondary text-xs" href={envelope.signedPdfUrl || "#"} target="_blank" rel="noreferrer">
                    下载 PDF
                  </a>
                  <button
                    type="button"
                    className="btn-secondary text-xs text-red-600 disabled:opacity-50"
                    disabled={busy === `delete-envelope-${envelope.id}`}
                    onClick={() => deleteEnvelopeDocument(envelope)}
                  >
                    {busy === `delete-envelope-${envelope.id}` ? "删除中…" : "删除文件"}
                  </button>
                </div>
              </div>
            ))}
            {completedEnvelopes.length === 0 && (
              <div className="rounded-lg border border-dashed border-neutral-300 p-4 text-sm text-neutral-500 dark:border-neutral-700">
                暂无已完成签约文件。
              </div>
            )}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className={`${isEditMode ? "w-full max-w-none" : "max-w-7xl"} space-y-5 p-3 sm:p-6`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{isEditMode ? "编辑合约模板" : "创建合约模板"}</h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            按 DocuSign 式流程：上传 PDF，设置签署人顺序，再把字段放到对应签署人的位置。
          </p>
        </div>
        <Link href="/contracts" className="btn-secondary text-center">
          返回电子合约
        </Link>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {notice && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</div>}

      <section className="card p-4">
        <div className={isEditMode ? "grid gap-4" : "grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]"}>
          <div>
            <h2 className="text-lg font-semibold">{isEditMode ? "1. 当前模板" : "1. 合约模板"}</h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              {isEditMode ? "继续调整签署人和 PDF 字段。" : "支持 PDF / Word。上传后可在字段编辑器设置签署区域。"}
            </p>
            {isEditMode && selectedTemplate ? (
              <div className="mt-3 grid gap-3 rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800">
                <div>
                  <div className="font-semibold">{selectedTemplate.name}</div>
                  <div className="mt-1 text-neutral-500">
                    {selectedTemplate.pageCount} 页 · {fields.length} 个字段 · {templateRecipients.length} 位签署人
                  </div>
                  <a className="mt-3 inline-flex text-blue-600 hover:underline" href={selectedTemplate.pdfUrl} target="_blank" rel="noreferrer">
                    打开当前签署 PDF
                  </a>
                </div>
                <div className="rounded-lg border border-dashed border-neutral-300 p-3 dark:border-neutral-700">
                  <div className="font-medium">追加 PDF / Word 文件</div>
                  <p className="mt-1 text-xs text-neutral-500">
                    上传后会合并到当前模板 PDF 的末尾，可继续在新增页面上添加签名框、文本框和日期框。
                  </p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
                    <input
                      className="input"
                      type="file"
                      accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx"
                      onChange={(event) => setAppendFile(event.target.files?.[0] || null)}
                    />
                    <button
                      type="button"
                      className="btn-secondary text-sm"
                      disabled={!appendFile || busy === "append-document"}
                      onClick={appendTemplateDocument}
                    >
                      {busy === "append-document" ? "追加中…" : "追加到模板"}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm">
                    <span className="font-medium">模板名称</span>
                    <input className="input mt-1" value={uploadName} onChange={(e) => setUploadName(e.target.value)} placeholder="例如：短租入住协议" />
                  </label>
                  <label className="block text-sm">
                    <span className="font-medium">PDF / Word 文件</span>
                    <input
                      className="input mt-1"
                      type="file"
                      accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx"
                      onChange={(e) => setTemplateFile(e.target.files?.[0] || null)}
                    />
                  </label>
                  <label className="block text-sm sm:col-span-2">
                    <span className="font-medium">备注</span>
                    <input className="input mt-1" value={uploadDescription} onChange={(e) => setUploadDescription(e.target.value)} placeholder="可选" />
                  </label>
                </div>
                <button type="button" className="btn-primary mt-3" disabled={busy === "upload"} onClick={createTemplate}>
                  {busy === "upload" ? "上传中…" : "上传文件并创建模板"}
                </button>
              </>
            )}
          </div>
          {!isEditMode && <div className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
            <div className="mb-2 text-sm font-medium">已有模板</div>
            <div className="max-h-52 space-y-2 overflow-auto">
              {templates.length === 0 ? (
                <div className="text-sm text-neutral-500">还没有模板。</div>
              ) : templates.map((template) => (
                <div
                  key={template.id}
                  className={`rounded-lg border p-2 text-sm ${
                    template.id === selectedTemplateId
                      ? "border-neutral-900 bg-neutral-100 dark:border-neutral-100 dark:bg-neutral-800"
                      : "border-neutral-200 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800"
                  }`}
                >
                  <button
                    type="button"
                    className="w-full text-left"
                    onClick={() => {
                      const nextRecipients = template.recipients?.length
                        ? template.recipients.map((recipient) => ({
                            name: recipient.name,
                            email: recipient.email,
                          }))
                        : [{ name: "", email: "" }];
                      setSelectedTemplateId(template.id);
                      setSendTemplateId(template.id);
                      setFields(template.fields || []);
                      setEditableContent(template.editableContent || "");
                      setSelectedFieldId(null);
                      setTemplateRecipients(nextRecipients);
                      syncSavedTemplateSnapshots(template, nextRecipients);
                    }}
                  >
                    <div className="font-medium">{template.name}</div>
                    <div className="text-xs text-neutral-500">
                      {template.pageCount} 页 · {template.fields.length} 个字段
                    </div>
                  </button>
                  <button
                    type="button"
                    className="mt-2 text-xs font-semibold text-red-600 disabled:opacity-50"
                    disabled={busy === `delete-template-${template.id}`}
                    onClick={() => deleteTemplate(template)}
                  >
                    {busy === `delete-template-${template.id}` ? "删除中…" : "删除模板"}
                  </button>
                </div>
              ))}
            </div>
          </div>}
        </div>
      </section>

      <section className="card p-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold">2. 签署人信息</h2>
          {isEditMode && recipientSaveStatus !== "idle" && (
            <span className={`text-xs ${recipientSaveStatus === "error" ? "text-red-600" : "text-neutral-500 dark:text-neutral-400"}`}>
              {recipientSaveStatus === "saving" ? "签署人自动保存中…" : recipientSaveStatus === "saved" ? "签署人已自动保存" : "签署人自动保存失败"}
            </span>
          )}
        </div>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          按顺序填写每位签署人的姓名和 email。字段编辑器会按这里的顺序分配填写责任。
        </p>
        <div className="mt-3 space-y-2">
          {templateRecipients.map((recipient, index) => (
            <div key={index} className="grid gap-2 rounded-lg border border-neutral-200 p-2 sm:grid-cols-[90px_1fr_1fr_auto] dark:border-neutral-800">
              <div className="flex items-center text-sm font-medium text-neutral-600 dark:text-neutral-300">
                第 {index + 1} 位
              </div>
              <input
                className="input"
                value={recipient.name}
                onChange={(event) => updateTemplateRecipient(index, { name: event.target.value })}
                placeholder="签署人姓名"
              />
              <input
                className="input"
                value={recipient.email}
                onChange={(event) => updateTemplateRecipient(index, { email: event.target.value })}
                placeholder="签署人 email"
              />
              <div className="flex gap-2">
                <button type="button" className="btn-secondary px-3 text-xs" disabled={index === 0} onClick={() => moveTemplateRecipient(index, -1)}>
                  上移
                </button>
                <button type="button" className="btn-secondary px-3 text-xs" disabled={index === templateRecipients.length - 1} onClick={() => moveTemplateRecipient(index, 1)}>
                  下移
                </button>
                <button type="button" className="btn-secondary px-3 text-xs" disabled={templateRecipients.length === 1} onClick={() => deleteTemplateRecipient(index)}>
                  删除
                </button>
              </div>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-secondary text-sm" onClick={addTemplateRecipient}>
              + 添加签署人
            </button>
            {isEditMode && (
              <button
                type="button"
                className="btn-primary text-sm"
                disabled={recipientSaveStatus === "saving" || !canSaveDraftRecipients(templateRecipients)}
                onClick={saveTemplateRecipientsNow}
              >
                {recipientSaveStatus === "saving" ? "保存中…" : "保存签署人"}
              </button>
            )}
          </div>
        </div>
      </section>

      {selectedTemplate?.sourceType === "WORD" && (
        <section className="card p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">3. Word 合约内容</h2>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                上传 Word 后系统会提取正文。这里修改内容并保存后，会重新生成用于签署的 PDF。
              </p>
            </div>
            {selectedTemplate.sourceUrl && (
              <a className="btn-secondary text-sm" href={selectedTemplate.sourceUrl} target="_blank" rel="noreferrer">
                打开原始 Word
              </a>
            )}
          </div>
          <textarea
            className="input mt-3 min-h-72 font-mono text-sm leading-6"
            value={editableContent}
            onChange={(event) => setEditableContent(event.target.value)}
            placeholder="在这里编辑合约正文。保存后会重新生成 PDF。"
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="text-xs text-neutral-500">
              Word 转 PDF 为签署底稿；签名框、日期框、文本框仍在下方字段编辑器中添加。
            </div>
            <button type="button" className="btn-primary" disabled={busy === "editable-content"} onClick={saveEditableContent}>
              {busy === "editable-content" ? "生成中…" : "保存 Word 内容"}
            </button>
          </div>
        </section>
      )}

      <section className="card p-4">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">{selectedTemplate?.sourceType === "WORD" ? "4" : "3"}. PDF 字段编辑器</h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              字段按 PDF 页面的百分比坐标保存。拖动字段可修改位置；拖拽右下角可调整大小。
            </p>
          </div>
          {selectedTemplate && (
            <a className="btn-secondary text-sm" href={selectedTemplate.pdfUrl} target="_blank" rel="noreferrer">
              打开原始 PDF
            </a>
          )}
        </div>
        {!selectedTemplate ? (
          <div className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-neutral-500">
            请先上传或选择一个模板。
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="order-2 max-h-[calc(100vh-220px)] min-h-[70vh] overflow-auto rounded-xl bg-neutral-100 p-3 dark:bg-neutral-950">
              <div className="sticky top-0 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-white/90 p-2 text-sm shadow-sm backdrop-blur dark:bg-neutral-900/90">
                <span className="font-medium text-neutral-700 dark:text-neutral-200">PDF 缩放</span>
                <button
                  type="button"
                  className="btn-secondary px-3 py-1 text-xs"
                  onClick={() => setPdfZoom((value) => clampPdfZoom(value - 0.25))}
                >
                  缩小
                </button>
                <select
                  className="input w-28 py-1 text-sm"
                  value={pdfZoom.toString()}
                  onChange={(event) => setPdfZoom(clampPdfZoom(Number(event.target.value)))}
                >
                  {PDF_ZOOM_OPTIONS.map((zoom) => (
                    <option key={zoom} value={zoom.toString()}>
                      {Math.round(zoom * 100)}%
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn-secondary px-3 py-1 text-xs"
                  onClick={() => setPdfZoom((value) => clampPdfZoom(value + 0.25))}
                >
                  放大
                </button>
              </div>
              <div className="space-y-4">
                {pageSizes.map((page) => (
                  <div
                    key={page.page}
                    className="mx-auto"
                    style={{
                      width: `${Math.round(pdfZoom * 100)}%`,
                      minWidth: pdfZoom > 1 ? `${Math.round(pdfZoom * 100)}%` : undefined,
                    }}
                  >
                    <div className="mb-1 text-xs text-neutral-500">Page {page.page}</div>
                    <div
                      className="relative w-full overflow-hidden rounded-lg border border-neutral-300 bg-white shadow-sm dark:border-neutral-700 dark:bg-neutral-900"
                      style={{ aspectRatio: `${page.width} / ${page.height}` }}
                    >
                      <iframe
                        src={pdfPreviewUrl(selectedTemplate.pdfUrl, page.page)}
                        title={`${selectedTemplate.name} page ${page.page}`}
                        className="absolute inset-0 h-full w-full border-0 bg-white"
                        style={{ pointerEvents: "none" }}
                      />
                      <div className="absolute left-2 top-2 rounded bg-white/90 px-2 py-1 text-[11px] font-medium text-neutral-500 shadow-sm">
                        PDF Page {page.page} · {Math.round(page.width)}×{Math.round(page.height)}
                      </div>
                      {fields.filter((field) => field.page === page.page).map((field) => {
                        const color = fieldColor(field);
                        const isSelected = field.id === selectedFieldId;
                        return (
                        <div
                          key={field.id}
                          role="button"
                          tabIndex={0}
                          className={`absolute box-border select-none rounded border px-1 text-left text-[11px] font-semibold shadow-sm transition ${
                            isSelected ? "ring-2 ring-neutral-900 ring-offset-1 dark:ring-neutral-100" : ""
                          }`}
                          style={{
                            left: `${field.x * 100}%`,
                            top: `${field.y * 100}%`,
                            width: `${field.width * 100}%`,
                            height: `${field.height * 100}%`,
                            boxSizing: "border-box",
                            borderColor: color.border,
                            backgroundColor: color.bg,
                            color: color.text,
                            cursor: fieldInteraction?.id === field.id && fieldInteraction.mode === "resize" ? "nwse-resize" : "move",
                            touchAction: "none",
                          }}
                          onDoubleClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setSelectedFieldId(field.id);
                            setFieldInsertPage(field.page);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setSelectedFieldId(field.id);
                              setFieldInsertPage(field.page);
                            }
                          }}
                          onPointerDown={(event) => {
                            if (event.detail >= 2) return;
                            event.preventDefault();
                            setFieldInsertPage(field.page);
                            const rect = event.currentTarget.parentElement?.getBoundingClientRect();
                            if (!rect) return;
                            const minSize = fieldMinSize(field.type);
                            setFieldInteraction({
                              id: field.id,
                              mode: "move",
                              startX: event.clientX,
                              startY: event.clientY,
                              originalX: field.x,
                              originalY: field.y,
                              originalWidth: field.width,
                              originalHeight: field.height,
                              minWidth: minSize.width,
                              minHeight: minSize.height,
                              rect,
                            });
                          }}
                        >
                          <span className="block truncate pr-3 leading-tight">
                            {fieldDisplayLabel(field)}
                          </span>
                          {fieldPreviewText(field) && (
                            <span className="mt-0.5 block truncate text-[10px] font-medium leading-tight opacity-90">
                              {fieldPreviewText(field)}
                            </span>
                          )}
                          <span
                            className="absolute -bottom-1.5 -right-1.5 h-4 w-4 rounded-full border bg-white shadow dark:bg-neutral-950"
                            style={{ borderColor: color.border, cursor: "nwse-resize" }}
                            title="拖拽调整大小"
                            onPointerDown={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              const pageElement = event.currentTarget.parentElement?.parentElement;
                              const rect = pageElement?.getBoundingClientRect();
                              if (!rect) return;
                              const minSize = fieldMinSize(field.type);
                              setFieldInteraction({
                                id: field.id,
                                mode: "resize",
                                startX: event.clientX,
                                startY: event.clientY,
                                originalX: field.x,
                                originalY: field.y,
                                originalWidth: field.width,
                                originalHeight: field.height,
                                minWidth: minSize.width,
                                minHeight: minSize.height,
                                rect,
                              });
                            }}
                          />
                        </div>
                      );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="order-1 space-y-3 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800">
                  <span className="font-medium">添加到</span>
                  <select
                    className="input w-24 py-1 text-sm"
                    value={validFieldInsertPage}
                    onChange={(event) => setFieldInsertPage(Number(event.target.value) || 1)}
                  >
                    {pageSizes.map((page) => (
                      <option key={page.page} value={page.page}>
                        第 {page.page} 页
                      </option>
                    ))}
                  </select>
                </label>
                {(["SIGNATURE", "DATE", "TEXT", "CHECKBOX", "REDACTION"] as FieldType[]).map((type) => (
                  <button key={type} type="button" className="btn-secondary text-sm" onClick={() => addField(type)}>
                    + {FIELD_TYPE_LABELS[type]}
                  </button>
                ))}
                <button
                  type="button"
                  className="btn-secondary text-sm"
                  disabled={!selectedField}
                  onClick={() => selectedField && duplicateField(selectedField.id)}
                >
                  复制选中字段
                </button>
              </div>
              <div className="rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800">
                <div className="font-semibold">预存文本</div>
                <p className="mt-1 text-xs text-neutral-500">
                  保存常用条款后，可在文本框/日期框字段里快速选择填入默认内容。
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-[0.7fr_1fr_auto]">
                  <input
                    className="input"
                    value={presetLabel}
                    onChange={(event) => setPresetLabel(event.target.value)}
                    placeholder="名称，例如：押金条款"
                  />
                  <input
                    className="input"
                    value={presetValue}
                    onChange={(event) => setPresetValue(event.target.value)}
                    placeholder="预存文字内容"
                  />
                  <button
                    type="button"
                    className="btn-secondary text-sm"
                    disabled={busy === "preset"}
                    onClick={createTextPreset}
                  >
                    {busy === "preset" ? "保存中…" : "保存"}
                  </button>
                </div>
                {textPresets.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {textPresets.slice(0, 8).map((preset) => (
                      <span key={preset.id} className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-1 text-xs dark:bg-neutral-800">
                        {preset.label}
                        <button
                          type="button"
                          className="text-red-600 disabled:opacity-50"
                          disabled={busy === `delete-preset-${preset.id}`}
                          onClick={() => deleteTextPreset(preset)}
                          aria-label={`删除 ${preset.label}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="rounded-lg border border-dashed border-neutral-300 p-4 text-sm text-neutral-500 dark:border-neutral-700">
                {fields.length === 0 ? (
                  <span>还没有字段。先添加签名框、文本框或文字涂改。</span>
                ) : (
                  <div className="space-y-2">
                    <div>已有 {fields.length} 个字段。双击 PDF 上的字段可打开参数编辑弹窗；单击拖拽可移动位置。</div>
                    <div className="flex flex-wrap gap-2">
                      {fields.map((field, index) => {
                        const color = fieldColor(field);
                        return (
                          <button
                            key={field.id}
                            type="button"
                            className="rounded-full border px-2 py-1 text-xs font-semibold"
                            style={{ borderColor: color.border, color: color.text, backgroundColor: color.bg }}
                            onClick={() => {
                              setSelectedFieldId(field.id);
                              setFieldInsertPage(field.page);
                            }}
                          >
                            {index + 1}. {fieldDisplayLabel(field)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
              <button type="button" className="btn-primary w-full" disabled={busy === "fields"} onClick={saveFields}>
                {busy === "fields" ? "保存中…" : "保存字段"}
              </button>
            </div>
          </div>
        )}
      </section>

      {selectedTemplate && selectedField && (
        <FieldEditModal
          field={selectedField}
          signerOptions={signerOptions}
          templateRecipients={templateRecipients}
          textPresets={textPresets}
          onClose={() => setSelectedFieldId(null)}
          onDuplicate={() => duplicateField(selectedField.id)}
          onDelete={() => {
            setFields((prev) => prev.filter((item) => item.id !== selectedField.id));
            setSelectedFieldId(null);
          }}
          onChange={(patch) => updateField(selectedField.id, patch)}
        />
      )}

      {pendingNavigationHref && (
        <UnsavedChangesModal
          saving={savingBeforeLeave}
          onCancel={() => setPendingNavigationHref(null)}
          onDiscard={() => {
            const href = pendingNavigationHref;
            setPendingNavigationHref(null);
            router.push(internalHrefForRouter(href));
          }}
          onSave={async () => {
            setSavingBeforeLeave(true);
            const ok = await saveAllTemplateChangesBeforeLeave();
            setSavingBeforeLeave(false);
            if (!ok) return;
            const href = pendingNavigationHref;
            setPendingNavigationHref(null);
            router.push(internalHrefForRouter(href));
          }}
        />
      )}

      <div className="flex justify-end">
        <Link href="/contracts" className="btn-primary">
          返回模板列表
        </Link>
      </div>
    </div>
  );

  function updateField(id: string, patch: Partial<TemplateField>) {
    setFields((prev) =>
      prev.map((field) => field.id === id ? { ...field, ...patch } : field),
    );
  }

  function updateRecipient(index: number, patch: Partial<DraftRecipient>) {
    setRecipients((prev) =>
      prev.map((recipient, i) => i === index ? { ...recipient, ...patch } : recipient),
    );
  }

  function updateTemplateRecipient(index: number, patch: Partial<DraftRecipient>) {
    const next = templateRecipients.map((recipient, i) =>
      i === index ? { ...recipient, ...patch } : recipient,
    );
    setTemplateRecipients(next);
    scheduleTemplateRecipientsAutoSave(next);
  }

  function moveTemplateRecipient(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= templateRecipients.length) return;
    const next = [...templateRecipients];
    const current = next[index];
    next[index] = next[nextIndex];
    next[nextIndex] = current;
    setTemplateRecipients(next);
    scheduleTemplateRecipientsAutoSave(next);
  }

  function deleteTemplateRecipient(index: number) {
    if (templateRecipients.length === 1) return;
    const next = templateRecipients.filter((_, i) => i !== index);
    setTemplateRecipients(next);
    scheduleTemplateRecipientsAutoSave(next);
  }

  function addTemplateRecipient() {
    const next = [...templateRecipients, { name: "", email: "" }];
    setTemplateRecipients(next);
    setRecipientSaveStatus("idle");
  }
}

function cleanDraftRecipients(recipients: DraftRecipient[]) {
  return recipients
    .map((recipient) => ({
      name: recipient.name.trim(),
      email: recipient.email.trim(),
    }))
    .filter((recipient) => recipient.name && isDraftEmail(recipient.email));
}

function snapshotFields(fields: TemplateField[]) {
  return JSON.stringify(
    fields.map((field) => ({
      type: field.type,
      label: field.label,
      required: field.required,
      recipientIndex: field.recipientIndex,
      page: field.page,
      x: roundSnapshotNumber(field.x),
      y: roundSnapshotNumber(field.y),
      width: roundSnapshotNumber(field.width),
      height: roundSnapshotNumber(field.height),
      placeholder: field.placeholder || null,
      defaultValue: field.defaultValue || null,
      fontSize: field.fontSize || null,
      sortOrder: field.sortOrder,
    })),
  );
}

function snapshotRecipients(recipients: DraftRecipient[]) {
  return JSON.stringify(
    recipients.map((recipient) => ({
      name: recipient.name.trim(),
      email: recipient.email.trim(),
    })),
  );
}

function roundSnapshotNumber(value: number) {
  return Math.round(value * 100000) / 100000;
}

function internalHrefForRouter(href: string) {
  const url = new URL(href, window.location.origin);
  return `${url.pathname}${url.search}${url.hash}`;
}

function canSaveDraftRecipients(recipients: DraftRecipient[]) {
  const completeRecipients = cleanDraftRecipients(recipients);
  return completeRecipients.length > 0
    && recipients.every((recipient) => {
      const name = recipient.name.trim();
      const email = recipient.email.trim();
      if (!name && !email) return true;
      return Boolean(name && isDraftEmail(email));
    });
}

function isDraftEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function UnsavedChangesModal({
  saving,
  onCancel,
  onDiscard,
  onSave,
}: {
  saving: boolean;
  onCancel: () => void;
  onDiscard: () => void;
  onSave: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl dark:bg-neutral-950">
        <div className="text-xl font-semibold">保存合约模板更改？</div>
        <p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-300">
          当前模板还有未保存的字段、签署人或 Word 内容。离开前可以先保存，也可以放弃本次更改。
        </p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-secondary text-sm" disabled={saving} onClick={onCancel}>
            取消
          </button>
          <button type="button" className="btn-secondary text-sm text-red-600" disabled={saving} onClick={onDiscard}>
            不保存并离开
          </button>
          <button type="button" className="btn-primary text-sm" disabled={saving} onClick={onSave}>
            {saving ? "保存中…" : "保存后离开"}
          </button>
        </div>
      </div>
    </div>
  );
}

function signerLabel(recipients: DraftRecipient[], signerNumber: number) {
  const recipient = recipients[signerNumber - 1];
  const label = recipient?.name?.trim() || recipient?.email?.trim();
  return label ? `第 ${signerNumber} 位 · ${label}` : `第 ${signerNumber} 位签署人`;
}

function fieldDisplayLabel(field: Pick<TemplateField, "label" | "type">) {
  return field.label.trim() || FIELD_TYPE_LABELS[field.type];
}

function fieldPreviewText(field: Pick<TemplateField, "defaultValue" | "type">) {
  if (field.type === "SIGNATURE" || field.type === "CHECKBOX" || field.type === "REDACTION") return "";
  return field.defaultValue?.trim() || "";
}

function fieldColor(field: Pick<TemplateField, "type" | "recipientIndex">) {
  if (field.type === "REDACTION") return REDACTION_COLOR;
  const index = Math.max(1, field.recipientIndex ?? 1) - 1;
  return RECIPIENT_COLORS[index % RECIPIENT_COLORS.length];
}

function FieldEditModal({
  field,
  signerOptions,
  templateRecipients,
  textPresets,
  onChange,
  onClose,
  onDuplicate,
  onDelete,
}: {
  field: TemplateField;
  signerOptions: number[];
  templateRecipients: DraftRecipient[];
  textPresets: TextPreset[];
  onChange: (patch: Partial<TemplateField>) => void;
  onClose: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const color = fieldColor(field);
  const canHaveText = field.type !== "SIGNATURE" && field.type !== "CHECKBOX" && field.type !== "REDACTION";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <div className="w-full max-w-3xl rounded-2xl bg-white p-5 shadow-2xl dark:bg-neutral-950">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="text-xl font-semibold">编辑字段参数</div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-neutral-500">
              <span
                className="inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold"
                style={{ borderColor: color.border, color: color.text, backgroundColor: color.bg }}
              >
                {fieldDisplayLabel(field)}
              </span>
              <span>{FIELD_TYPE_LABELS[field.type]}</span>
              {field.type === "REDACTION" ? "覆盖 PDF 上不需要显示的原文字" : signerLabel(templateRecipients, field.recipientIndex ?? 1)}
            </div>
          </div>
          <button type="button" className="text-2xl leading-none text-neutral-500 hover:text-neutral-900" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="grid gap-4 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="font-medium">标签</span>
              <input
                className="input mt-1"
                value={field.label}
                onChange={(event) => onChange({ label: event.target.value })}
                placeholder={FIELD_TYPE_LABELS[field.type]}
              />
              <span className="mt-1 block text-xs text-neutral-500">
                这里会同步显示为 PDF 字段上的 tag。
              </span>
            </label>
            <label className="block text-sm">
              <span className="font-medium">字号</span>
              <input
                className="input mt-1"
                type="number"
                value={field.fontSize ?? ""}
                onChange={(event) => onChange({ fontSize: event.target.value ? Number(event.target.value) : null })}
                placeholder="自动"
              />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
          {field.type !== "REDACTION" && (
            <label className="block text-sm">
              <span className="font-medium">签署人</span>
              <select
                className="input mt-1"
                value={field.recipientIndex ?? 1}
                onChange={(event) => onChange({ recipientIndex: Number(event.target.value) || 1 })}
              >
                {signerOptions.map((signerNumber) => (
                  <option key={signerNumber} value={signerNumber}>
                    {signerLabel(templateRecipients, signerNumber)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {field.type !== "REDACTION" && field.type !== "CHECKBOX" ? (
            <label className="flex items-center gap-2 self-end rounded-lg border border-neutral-200 px-3 py-3 text-sm dark:border-neutral-800">
              <input type="checkbox" checked={field.required} onChange={(event) => onChange({ required: event.target.checked })} />
              必填
            </label>
          ) : field.type === "CHECKBOX" ? (
            <div className="rounded-lg border border-neutral-200 px-3 py-3 text-sm text-neutral-500 dark:border-neutral-800">
              勾选框为 Optional，租客可不勾选也能提交。
            </div>
          ) : (
            <div className="rounded-lg border border-neutral-200 px-3 py-3 text-sm text-neutral-500 dark:border-neutral-800">
              涂改字段只会覆盖 PDF 原文字，不会出现在租客填写表单里。
            </div>
          )}
          </div>
        </div>

        {canHaveText && (
          <div className="mt-4 grid gap-3 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
            <label className="block text-sm sm:col-span-2">
              <span className="font-medium">选择预存文本</span>
              <select
                className="input mt-1"
                value=""
                onChange={(event) => {
                  const preset = textPresets.find((item) => item.id === event.target.value);
                  if (preset) onChange({ defaultValue: preset.value });
                }}
              >
                <option value="">选择后填入默认内容</option>
                {textPresets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="font-medium">默认内容</span>
              <textarea
                className="input mt-1 min-h-24 resize-y leading-6"
                value={field.defaultValue ?? ""}
                onChange={(event) => onChange({ defaultValue: event.target.value || null })}
                placeholder="可选自动写入；填写后会直接显示在 PDF/Word 预览的对应字段里。"
                rows={3}
              />
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="font-medium">提示文字</span>
              <input
                className="input mt-1"
                value={field.placeholder ?? ""}
                onChange={(event) => onChange({ placeholder: event.target.value || null })}
                placeholder="租客填写时看到"
              />
            </label>
          </div>
        )}

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="btn-secondary text-sm" onClick={onDuplicate}>
              复制字段
            </button>
            <button type="button" className="btn-secondary text-sm text-red-600" onClick={onDelete}>
              删除字段
            </button>
            <button type="button" className="btn-primary text-sm" onClick={onClose}>
              完成
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function clampPage(value: number, max: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return 1;
  return Math.max(1, Math.min(Math.max(1, max), parsed));
}

function clampPdfZoom(value: number) {
  return clamp(value, 0.5, 2);
}

function fieldMinSize(type: FieldType) {
  if (type === "CHECKBOX") {
    return { width: 0.025, height: 0.025 };
  }
  if (type === "SIGNATURE") {
    return { width: 0.08, height: 0.035 };
  }
  if (type === "REDACTION") {
    return { width: 0.04, height: 0.018 };
  }
  return { width: 0.06, height: 0.025 };
}

function clampFieldSize(value: number, min: number, max: number) {
  const safeMax = Math.max(0.01, max);
  return clamp(value, Math.min(min, safeMax), safeMax);
}

function pdfPreviewUrl(url: string, page: number) {
  const separator = url.includes("#") ? "&" : "#";
  return `${url}${separator}page=${page}&toolbar=0&navpanes=0&scrollbar=0&view=Fit`;
}
