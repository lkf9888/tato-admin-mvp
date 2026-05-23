"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";
import { useRouter } from "next/navigation";

import type { Locale } from "@/lib/i18n";
import { formatCurrencyInputText } from "@/lib/utils";

type ReimbursableVehicle = {
  id: string;
  label: string;
  searchText: string;
  ownerId: string;
  ownerName: string;
};

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function copy(locale: Locale) {
  return locale !== "en"
    ? {
        button: "+ 快速添加报销",
        title: "快速添加报销",
        subtitle: "选择车辆后，系统会自动把报销记到对应车主的流水账。",
        vehicle: "车辆",
        amount: "金额",
        date: "日期",
        note: "备注",
        noteRequired: "*",
        receipts: "报销凭证",
        upload: "选择文件",
        dragHint: "也可以把图片或 PDF 拖到这里",
        dropHere: "松开后上传",
        fileCount: (count: number) => `${count} 个文件待上传`,
        searchPlaceholder: "搜索车辆、车牌、车主...",
        noVehicles: "还没有绑定到车主的车辆。",
        noMatch: "没有匹配的车辆",
        invalidAmount: "请输入有效金额。",
        noteMissing: "请填写备注。",
        saveFailed: "保存失败，请稍后再试。",
        receiptFailed: "账目已保存，但凭证上传失败，请在流水账里重新上传。",
        cancel: "取消",
        save: "保存",
        saving: "保存中...",
        close: "关闭",
      }
    : {
        button: "+ Quick reimbursement",
        title: "Quick reimbursement",
        subtitle: "Choose a vehicle and the reimbursement is posted to that owner ledger.",
        vehicle: "Vehicle",
        amount: "Amount",
        date: "Date",
        note: "Note",
        noteRequired: "*",
        receipts: "Receipts",
        upload: "Choose files",
        dragHint: "Or drag images / PDFs here",
        dropHere: "Drop to upload",
        fileCount: (count: number) => `${count} file(s) ready`,
        searchPlaceholder: "Search vehicle, plate, owner...",
        noVehicles: "No owner-assigned vehicles yet.",
        noMatch: "No matching vehicles",
        invalidAmount: "Enter a valid amount.",
        noteMissing: "Add a note.",
        saveFailed: "Save failed. Please try again.",
        receiptFailed: "The ledger item was saved, but receipt upload failed. Re-upload it from the ledger.",
        cancel: "Cancel",
        save: "Save",
        saving: "Saving...",
        close: "Close",
      };
}

export function QuickVehicleReimbursementButton({
  vehicles,
  locale,
}: {
  vehicles: ReimbursableVehicle[];
  locale: Locale;
}) {
  const labels = copy(locale);
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>
        {labels.button}
      </button>
      {open ? (
        <QuickVehicleReimbursementModal
          vehicles={vehicles}
          locale={locale}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function QuickVehicleReimbursementModal({
  vehicles,
  locale,
  onClose,
}: {
  vehicles: ReimbursableVehicle[];
  locale: Locale;
  onClose: () => void;
}) {
  const labels = copy(locale);
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [occurredAt, setOccurredAt] = useState(todayInputValue());
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [dragDepth, setDragDepth] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedVehicle = useMemo(
    () => vehicles.find((vehicle) => vehicle.id === vehicleId) ?? null,
    [vehicleId, vehicles],
  );

  function appendFiles(nextFiles: FileList | File[] | null) {
    if (!nextFiles) return;
    setFiles((current) => [...current, ...Array.from(nextFiles)]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleDragEnter(event: React.DragEvent<HTMLDivElement>) {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    setDragDepth((current) => current + 1);
  }

  function handleDragOver(event: React.DragEvent<HTMLDivElement>) {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(event: React.DragEvent<HTMLDivElement>) {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    setDragDepth((current) => Math.max(0, current - 1));
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    setDragDepth(0);
    appendFiles(event.dataTransfer.files);
  }

  async function save() {
    if (!selectedVehicle) return;
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError(labels.invalidAmount);
      return;
    }
    if (!note.trim()) {
      setError(labels.noteMissing);
      return;
    }

    setSaving(true);
    setError(null);
    const response = await fetch(`/api/owners/${selectedVehicle.ownerId}/ledger`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "EXPENSE_REIMBURSEMENT",
        amount: -Math.abs(parsedAmount),
        occurredAt: new Date(`${occurredAt}T00:00:00`).toISOString(),
        vehicleId: selectedVehicle.id,
        note: note.trim(),
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.item?.id) {
      setSaving(false);
      setError(payload.error || labels.saveFailed);
      return;
    }

    if (files.length > 0) {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));
      const receiptResponse = await fetch(
        `/api/owners/${selectedVehicle.ownerId}/ledger/${payload.item.id}/receipts`,
        { method: "POST", body: formData },
      );
      if (!receiptResponse.ok) {
        setSaving(false);
        setError(labels.receiptFailed);
        router.refresh();
        return;
      }
    }

    setSaving(false);
    onClose();
    router.refresh();
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
      <div
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">{labels.title}</h3>
            <p className="mt-1 text-sm text-neutral-500">{labels.subtitle}</p>
          </div>
          <button
            type="button"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-2xl leading-none text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
            onClick={onClose}
            aria-label={labels.close}
          >
            x
          </button>
        </div>

        {error ? (
          <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        ) : null}

        {vehicles.length === 0 ? (
          <div className="mt-4 rounded-md border border-dashed border-neutral-300 p-4 text-sm text-neutral-500">
            {labels.noVehicles}
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <div>
              <label className="label">{labels.vehicle}</label>
              <VehicleCombobox
                vehicles={vehicles}
                value={vehicleId}
                onChange={setVehicleId}
                locale={locale}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">{labels.amount}</label>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  onBlur={(event) => setAmount(formatCurrencyInputText(event.target.value))}
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="label">{labels.date}</label>
                <input
                  className="input"
                  type="date"
                  value={occurredAt}
                  onChange={(event) => setOccurredAt(event.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="label">
                {labels.note}
                <span className="ml-1 text-xs text-red-600">{labels.noteRequired}</span>
              </label>
              <textarea
                className="input min-h-[88px]"
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </div>

            <div>
              <label className="label">{labels.receipts}</label>
              <div
                className={`rounded-lg border-2 border-dashed px-3 py-3 transition-colors ${
                  dragDepth > 0 ? "border-blue-500 bg-blue-50" : "border-neutral-300 hover:border-neutral-400"
                }`}
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,application/pdf"
                  multiple
                  className="hidden"
                  onChange={(event) => appendFiles(event.target.files)}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="btn-secondary text-sm"
                    disabled={saving}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {labels.upload}
                  </button>
                  <span className="text-xs text-neutral-500">
                    {dragDepth > 0 ? labels.dropHere : labels.dragHint}
                  </span>
                </div>
              </div>
              {files.length > 0 ? (
                <div className="mt-3 space-y-1">
                  <p className="text-xs text-neutral-500">{labels.fileCount(files.length)}</p>
                  {files.map((file, index) => (
                    <div
                      key={`${file.name}-${file.size}-${index}`}
                      className="flex items-center justify-between gap-2 rounded border border-neutral-200 px-2 py-1 text-xs"
                    >
                      <span className="min-w-0 truncate">{file.name}</span>
                      <button
                        type="button"
                        className="shrink-0 text-red-600 hover:underline"
                        onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                      >
                        x
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose} disabled={saving}>
            {labels.cancel}
          </button>
          <button
            className="btn-primary"
            onClick={save}
            disabled={saving || vehicles.length === 0 || !selectedVehicle || !amount || !note.trim()}
          >
            {saving ? labels.saving : labels.save}
          </button>
        </div>
      </div>
    </div>
  );
}

function VehicleCombobox({
  vehicles,
  value,
  onChange,
  locale,
}: {
  vehicles: ReimbursableVehicle[];
  value: string;
  onChange: (value: string) => void;
  locale: Locale;
}) {
  const labels = copy(locale);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(0);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const selected = vehicles.find((vehicle) => vehicle.id === value) ?? null;
  const sortedVehicles = useMemo(
    () => [...vehicles].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })),
    [vehicles],
  );
  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return sortedVehicles;
    if (selected && normalizedQuery === selected.label.toLowerCase()) return sortedVehicles;
    return sortedVehicles.filter((vehicle) =>
      `${vehicle.label} ${vehicle.searchText} ${vehicle.ownerName}`.toLowerCase().includes(normalizedQuery),
    );
  }, [query, selected, sortedVehicles]);
  const displayValue = open ? query : selected?.label ?? "";
  const activeHighlightIndex = Math.min(highlightIndex, Math.max(0, filtered.length - 1));

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const wrapper = wrapperRef.current;
      if (!wrapper) return;
      if (event.target instanceof Node && wrapper.contains(event.target)) return;
      setOpen(false);
      setQuery("");
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function choose(vehicle: ReimbursableVehicle) {
    onChange(vehicle.id);
    setQuery("");
    setOpen(false);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setHighlightIndex((index) => Math.min(Math.max(0, filtered.length - 1), index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightIndex((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter" && open && filtered[activeHighlightIndex]) {
      event.preventDefault();
      choose(filtered[activeHighlightIndex]);
    } else if (event.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  }

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          className="input pr-10"
          value={displayValue}
          onFocus={() => {
            setOpen(true);
            setQuery(selected?.label ?? "");
            requestAnimationFrame(() => inputRef.current?.select());
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setHighlightIndex(0);
          }}
          onKeyDown={handleKeyDown}
          placeholder={labels.searchPlaceholder}
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="button"
          className="absolute right-1 top-1/2 -translate-y-1/2 px-2 text-lg leading-none text-neutral-500 hover:text-neutral-800"
          aria-label="Toggle dropdown"
          tabIndex={-1}
          onClick={() => {
            if (open) {
              setOpen(false);
              setQuery("");
              inputRef.current?.blur();
              return;
            }
            setOpen(true);
            setQuery(selected?.label ?? "");
            inputRef.current?.focus();
          }}
        >
          v
        </button>
      </div>

      {open ? (
        <div className="absolute left-0 right-0 z-[80] mt-1 max-h-64 overflow-y-auto rounded-md border border-neutral-200 bg-white shadow-lg">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-sm text-neutral-500">{labels.noMatch}</div>
          ) : (
            filtered.map((vehicle, index) => {
              const isSelected = vehicle.id === value;
              const isHighlighted = index === activeHighlightIndex;
              return (
                <button
                  key={vehicle.id}
                  type="button"
                  className={`block w-full px-3 py-2 text-left text-sm ${
                    isHighlighted ? "bg-blue-50" : "hover:bg-neutral-50"
                  }`}
                  onMouseEnter={() => setHighlightIndex(index)}
                  onClick={() => choose(vehicle)}
                >
                  <span className="flex min-w-0 items-center justify-between gap-2">
                    <span className="truncate font-medium">{vehicle.label}</span>
                    {isSelected ? <span className="shrink-0 text-blue-600">✓</span> : null}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-neutral-500">{vehicle.ownerName}</span>
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
