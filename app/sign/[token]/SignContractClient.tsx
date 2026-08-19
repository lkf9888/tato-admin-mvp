"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import dynamic from "next/dynamic";

type FieldType = "SIGNATURE" | "TEXT" | "DATE" | "CHECKBOX";

type Field = {
  id: string;
  type: FieldType;
  label: string;
  required: boolean;
  placeholder: string | null;
  defaultValue: string | null;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number | null;
};

type PageSize = { page: number; width: number; height: number };

type SignPayload = {
  recipient: {
    id: string;
    name: string;
    email: string;
    signingOrder: number;
    status: string;
  };
  envelope: {
    id: string;
    title: string;
    message: string | null;
    status: string;
    signedPdfUrl: string | null;
  };
  template: {
    name: string;
    pdfUrl: string;
    pageCount: number;
    pageSizes?: unknown;
    fields: Field[];
  };
  existingValues: Array<{
    fieldId: string;
    value: string | null;
    signature: string | null;
    checked: boolean | null;
  }>;
};

type FieldState = {
  value: string;
  signature: string;
  checked: boolean;
};

type SignLocale = "en" | "zh-CN" | "zh-TW";

const SIGN_LOCALES: Array<{ value: SignLocale; label: string }> = [
  { value: "en", label: "English" },
  { value: "zh-CN", label: "简体中文" },
  { value: "zh-TW", label: "繁體中文" },
];

const PdfPageCanvas = dynamic(
  () => import("@/components/pdf-page-canvas").then((module) => module.PdfPageCanvas),
  {
    ssr: false,
    loading: () => <div className="absolute inset-0 bg-white" />,
  },
);

const SIGN_COPY: Record<
  SignLocale,
  {
    loading: string;
    unableToLoad: string;
    consentRequired: string;
    unableToSubmit: string;
    document: string;
    signer: string;
    instruction: string;
    signedNotice: string;
    downloadCompletedPdf: string;
    page: string;
    consent: string;
    submitting: string;
    submitSignature: string;
    clear: string;
    checkboxDefault: string;
    language: string;
    pageSuffix: string;
  }
> = {
  en: {
    loading: "Loading signing request...",
    unableToLoad: "Unable to load signing request.",
    consentRequired: "Please confirm that you agree to use electronic signatures.",
    unableToSubmit: "Unable to submit signature.",
    document: "Document",
    signer: "Signer",
    instruction: "Fill the highlighted fields directly on the document.",
    signedNotice: "You have signed this document.",
    downloadCompletedPdf: "Download completed PDF",
    page: "Page",
    consent:
      "By submitting, I agree to use electronic signatures and confirm that the information I provided is accurate.",
    submitting: "Submitting...",
    submitSignature: "Submit signature",
    clear: "Clear",
    checkboxDefault: "I agree",
    language: "Language",
    pageSuffix: "",
  },
  "zh-CN": {
    loading: "正在加载签署请求...",
    unableToLoad: "无法加载签署请求。",
    consentRequired: "请先确认同意使用电子签名。",
    unableToSubmit: "无法提交签名。",
    document: "文件",
    signer: "签署人",
    instruction: "请直接在文件上填写高亮字段。",
    signedNotice: "您已签署此文件。",
    downloadCompletedPdf: "下载已完成 PDF",
    page: "第",
    consent: "提交即表示我同意使用电子签名，并确认我填写的信息准确无误。",
    submitting: "正在提交...",
    submitSignature: "提交签名",
    clear: "清除",
    checkboxDefault: "我同意",
    language: "语言",
    pageSuffix: "页",
  },
  "zh-TW": {
    loading: "正在載入簽署請求...",
    unableToLoad: "無法載入簽署請求。",
    consentRequired: "請先確認同意使用電子簽名。",
    unableToSubmit: "無法提交簽名。",
    document: "文件",
    signer: "簽署人",
    instruction: "請直接在文件上填寫高亮欄位。",
    signedNotice: "您已簽署此文件。",
    downloadCompletedPdf: "下載已完成 PDF",
    page: "第",
    consent: "提交即表示我同意使用電子簽名，並確認我填寫的資訊準確無誤。",
    submitting: "正在提交...",
    submitSignature: "提交簽名",
    clear: "清除",
    checkboxDefault: "我同意",
    language: "語言",
    pageSuffix: "頁",
  },
};

function preferredSignLocale(): SignLocale {
  if (typeof navigator === "undefined") return "en";
  const language = navigator.language.toLowerCase();
  if (language.includes("tw") || language.includes("hk") || language.includes("hant")) return "zh-TW";
  if (language.startsWith("zh")) return "zh-CN";
  return "en";
}

export default function SignContractClient({ token }: { token: string }) {
  const [data, setData] = useState<SignPayload | null>(null);
  const [values, setValues] = useState<Record<string, FieldState>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completedUrl, setCompletedUrl] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [locale, setLocale] = useState<SignLocale>(() => preferredSignLocale());
  const [measuredPageSizes, setMeasuredPageSizes] = useState<Record<number, PageSize>>({});

  const copy = SIGN_COPY[locale];

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/contracts/sign/${token}`);
        const payload = await readJsonResponse<SignPayload & { error?: string }>(res);
        if (!res.ok) throw new Error(payload.error || SIGN_COPY.en.unableToLoad);
        if (cancelled) return;
        setData(payload);
        setMeasuredPageSizes({});
        const openedDate = todayDateInputValue();
        const next: Record<string, FieldState> = {};
        for (const field of payload.template.fields as Field[]) {
          const existing = payload.existingValues.find((item) => item.fieldId === field.id);
          next[field.id] = {
            value: existing?.value || (field.type === "DATE" ? openedDate : field.defaultValue || ""),
            signature: existing?.signature || "",
            checked: existing?.checked === true,
          };
        }
        setValues(next);
        setCompletedUrl(payload.envelope.signedPdfUrl || null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const storedPageSizes = useMemo(() => defaultPageSizes(data?.template), [data?.template]);
  const pageSizes = useMemo(
    () => mergeMeasuredPageSizes(storedPageSizes, measuredPageSizes),
    [storedPageSizes, measuredPageSizes],
  );
  const handlePdfPageMeasured = useCallback((size: PageSize) => {
    setMeasuredPageSizes((current) => {
      const existing = current[size.page];
      if (existing && isSamePageSize(existing, size)) return current;
      return { ...current, [size.page]: size };
    });
  }, []);

  async function submit() {
    if (!data) return;
    if (!consent) {
      setError(copy.consentRequired);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/contracts/sign/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          values: data.template.fields.map((field) => ({
            fieldId: field.id,
            value: values[field.id]?.value || "",
            signature: values[field.id]?.signature || "",
            checked: values[field.id]?.checked === true,
          })),
        }),
      });
      const payload = await readJsonResponse<{ completed?: boolean; signedPdfUrl?: string; error?: string }>(res);
      if (!res.ok) throw new Error(payload.error || copy.unableToSubmit);
      if (payload.completed && payload.signedPdfUrl) {
        setCompletedUrl(payload.signedPdfUrl);
      }
      setData((current) =>
        current
          ? {
              ...current,
              recipient: { ...current.recipient, status: "SIGNED" },
              envelope: {
                ...current.envelope,
                status: payload.completed ? "COMPLETED" : current.envelope.status,
                signedPdfUrl: payload.signedPdfUrl || current.envelope.signedPdfUrl,
              },
            }
          : current,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-[var(--surface-muted)] p-6 text-[var(--ink)]">
        <div className="mx-auto max-w-3xl rounded-lg border bg-white p-8">
          {copy.loading}
        </div>
      </main>
    );
  }

  if (error && !data) {
    return (
      <main className="min-h-screen bg-[var(--surface-muted)] p-6 text-[var(--ink)]">
        <div className="mx-auto max-w-3xl rounded-lg border border-red-200 bg-white p-8 text-red-700">
          {error}
        </div>
      </main>
    );
  }

  if (!data) return null;
  const alreadySigned = data.recipient.status === "SIGNED";
  const fieldsByPage = new Map<number, Field[]>();
  for (const field of data.template.fields) {
    const page = Math.max(1, Number(field.page) || 1);
    fieldsByPage.set(page, [...(fieldsByPage.get(page) || []), field]);
  }

  return (
    <main className="min-h-screen bg-[var(--surface-muted)] p-3 text-[var(--ink)] sm:p-6">
      <div className="mx-auto max-w-7xl space-y-4">
        <section className="rounded-lg border bg-white p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--ink)]">TATO eSignature</div>
              <h1 className="mt-2 text-2xl font-semibold">{data.envelope.title}</h1>
              <p className="mt-1 text-sm text-[var(--ink-soft)]">
                {copy.document}: {data.template.name} · {copy.signer} {data.recipient.signingOrder}:{" "}
                {data.recipient.name}
              </p>
              {data.envelope.message && (
                <div className="mt-3 rounded-lg bg-[var(--surface-muted)] p-3 text-sm text-[var(--ink-mid)]">
                  {data.envelope.message}
                </div>
              )}
            </div>
            <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
              <label className="flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm text-[var(--ink-mid)]">
                <span>{copy.language}</span>
                <select
                  className="rounded-lg border border-[var(--line)] bg-white px-2 py-1 font-semibold text-[var(--ink)]"
                  value={locale}
                  onChange={(event) => setLocale(event.target.value as SignLocale)}
                >
                  {SIGN_LOCALES.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                {copy.instruction}
              </div>
            </div>
          </div>
          {error && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}
          {alreadySigned && (
            <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
              {copy.signedNotice}
              {completedUrl && (
                <div className="mt-2">
                  <a className="font-semibold underline" href={completedUrl} target="_blank" rel="noreferrer">
                    {copy.downloadCompletedPdf}
                  </a>
                </div>
              )}
            </div>
          )}
        </section>

        <section className="rounded-lg border bg-white p-3 sm:p-4">
          <div className="max-h-[calc(100vh-220px)] overflow-auto rounded-lg bg-[var(--surface-muted)] p-3">
            <div className="space-y-5">
              {pageSizes.map((page) => (
                <div key={page.page} className="mx-auto max-w-[920px]">
                  <div className="mb-1 text-xs font-medium text-[var(--ink-soft)]">
                    {locale === "en"
                      ? `${copy.page} ${page.page}`
                      : `${copy.page} ${page.page} ${copy.pageSuffix}`}
                  </div>
                  <div
                    className="relative w-full overflow-hidden rounded-lg border border-[var(--line-strong)] bg-white"
                    style={{ aspectRatio: `${page.width} / ${page.height}` }}
                  >
                    <PdfPageCanvas
                      url={data.template.pdfUrl}
                      pageNumber={page.page}
                      className="absolute inset-0 h-full w-full bg-white"
                      onPageMeasured={handlePdfPageMeasured}
                    />
                    <div className="absolute inset-0">
                      {(fieldsByPage.get(page.page) || []).map((field) => (
                        <DocumentField
                          key={field.id}
                          field={field}
                          state={values[field.id] || { value: "", signature: "", checked: false }}
                          disabled={alreadySigned || submitting}
                          clearLabel={copy.clear}
                          checkboxLabel={copy.checkboxDefault}
                          onChange={(next) =>
                            setValues((current) => {
                              const previous = current[field.id] || { value: "", signature: "", checked: false };
                              return {
                                ...current,
                                [field.id]: { ...previous, ...next },
                              };
                            })
                          }
                        />
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {!alreadySigned && (
          <section className="sticky bottom-3 z-20 rounded-lg border bg-white p-4 shadow-lg">
            <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <input
                type="checkbox"
                className="mt-1"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
              />
              <span>{copy.consent}</span>
            </label>
            <button
              type="button"
              className="mt-3 w-full rounded-lg bg-[var(--ink)] px-4 py-3 font-semibold text-white disabled:opacity-50"
              disabled={submitting}
              onClick={submit}
            >
              {submitting ? copy.submitting : copy.submitSignature}
            </button>
          </section>
        )}
      </div>
    </main>
  );
}

function DocumentField({
  field,
  state,
  disabled,
  clearLabel,
  checkboxLabel,
  onChange,
}: {
  field: Field;
  state: FieldState;
  disabled: boolean;
  clearLabel: string;
  checkboxLabel: string;
  onChange: (next: Partial<FieldState>) => void;
}) {
  const style = {
    left: `${field.x * 100}%`,
    top: `${field.y * 100}%`,
    width: `${field.width * 100}%`,
    height: `${field.height * 100}%`,
    boxSizing: "border-box" as const,
  };
  const inputStyle = {
    fontSize: field.fontSize ? `${field.fontSize}px` : undefined,
  };

  return (
    <div
      className="absolute box-border rounded-md border-2 border-blue-500 bg-[var(--surface)] ring-2 ring-white/80 focus-within:ring-blue-300"
      style={style}
      title={field.label}
    >
      <span className="pointer-events-none absolute -top-4 left-0 max-w-full truncate rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
        {field.label}{field.required && field.type !== "CHECKBOX" ? " *" : ""}
      </span>
      {field.type === "SIGNATURE" ? (
        <SignaturePad
          compact
          disabled={disabled}
          clearLabel={clearLabel}
          value={state.signature}
          onChange={(signature) => onChange({ signature })}
        />
      ) : field.type === "CHECKBOX" ? (
        <label className="flex h-full w-full items-center justify-center gap-2 text-xs font-semibold">
          <input
            type="checkbox"
            disabled={disabled}
            checked={state.checked}
            onChange={(event) => onChange({ checked: event.target.checked })}
          />
          {field.placeholder || checkboxLabel}
        </label>
      ) : (
        <input
          className="h-full w-full rounded-[3px] border-0 bg-white/95 px-1.5 text-sm outline-none disabled:bg-[var(--surface-muted)]"
          style={inputStyle}
          type={field.type === "DATE" ? "date" : "text"}
          disabled={disabled}
          value={state.value}
          placeholder={field.placeholder || field.label}
          onChange={(event) => onChange({ value: event.target.value })}
        />
      )}
    </div>
  );
}

function SignaturePad({
  value,
  onChange,
  compact = false,
  disabled = false,
  clearLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  compact?: boolean;
  disabled?: boolean;
  clearLabel: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!value) return;
    const image = new Image();
    image.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    };
    image.src = value;
  }, [value]);

  function pointerPosition(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function start(event: PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    const canvas = event.currentTarget;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawing.current = true;
    canvas.setPointerCapture(event.pointerId);
    const point = pointerPosition(event);
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
  }

  function move(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || disabled) return;
    const canvas = event.currentTarget;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const point = pointerPosition(event);
    ctx.lineTo(point.x, point.y);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#111827";
    ctx.stroke();
    onChange(canvas.toDataURL("image/png"));
  }

  function end(event: PointerEvent<HTMLCanvasElement>) {
    drawing.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function clear() {
    if (disabled) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    onChange("");
  }

  return (
    <div className={compact ? "relative h-full w-full" : "mt-2"}>
      <canvas
        ref={canvasRef}
        width={520}
        height={180}
        className={
          compact
            ? "h-full w-full touch-none rounded border border-[var(--line-strong)] bg-white disabled:opacity-70"
            : "h-32 w-full touch-none rounded-lg border border-[var(--line-strong)] bg-white"
        }
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      />
      <button
        type="button"
        className={
          compact
            ? "absolute bottom-1 right-1 rounded bg-[var(--surface)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--ink-mid)] shadow"
            : "mt-2 text-sm text-[var(--ink-soft)] underline"
        }
        onClick={clear}
        disabled={disabled}
      >
        {clearLabel}
      </button>
    </div>
  );
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

function defaultPageSizes(template: SignPayload["template"] | null | undefined): PageSize[] {
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

function mergeMeasuredPageSizes(stored: PageSize[], measured: Record<number, PageSize>) {
  return stored.map((page) => measured[page.page] || page);
}

function isSamePageSize(left: PageSize, right: PageSize) {
  return (
    Math.abs(left.width - right.width) < 0.01 &&
    Math.abs(left.height - right.height) < 0.01
  );
}

function todayDateInputValue() {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}
