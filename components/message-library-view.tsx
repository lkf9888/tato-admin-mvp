"use client";

import { useMemo, useRef, useState } from "react";
import { Copy, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react";

import { InlineSpinner } from "@/components/turo-task-progress";
import { getMessages, type Locale } from "@/lib/i18n";
import {
  buildKnowledgeBlock,
  isExpired,
  KNOWLEDGE_KINDS,
  LOCATION_ROLES,
  type LocationRole,
  TRIP_STAGES,
  type KnowledgeEntry,
  type KnowledgeKind,
  type TripStage,
} from "@/lib/message-knowledge";
import { PLACEHOLDER_KEYS, PLACEHOLDER_LABELS } from "@/lib/message-placeholders";
import { SEARCH_FIELD_PROPS } from "@/lib/search-field-props";

type Vehicle = { id: string; label: string; nickname?: string | null };

type Draft = {
  id: string | null;
  kind: KnowledgeKind;
  label: string;
  triggers: string;
  content: string;
  vehicleIds: string[];
  stages: TripStage[];
  /** One word per line. */
  locations: string;
  locationRole: LocationRole | null;
  validUntil: string;
  aiEnabled: boolean;
};

const EMPTY_DRAFT: Draft = {
  id: null,
  kind: "reply",
  label: "",
  triggers: "",
  content: "",
  vehicleIds: [],
  stages: [],
  locations: "",
  locationRole: "pickup",
  validUntil: "",
  aiEnabled: true,
};

const KIND_TONE: Record<KnowledgeKind, string> = {
  reply: "bg-[var(--brand-soft)] text-[var(--brand)]",
  fact: "bg-[var(--ok-bg)] text-[var(--ok-fg)]",
  rule: "bg-[var(--warn-bg)] text-[var(--warn-fg)]",
};

function toDraft(entry: KnowledgeEntry, copyOf = false): Draft {
  return {
    id: copyOf ? null : entry.id,
    kind: entry.kind,
    label: copyOf ? `${entry.label} (2)` : entry.label,
    triggers: entry.triggers.join("\n"),
    content: entry.content,
    vehicleIds: entry.vehicleIds ?? [],
    stages: entry.stages ?? [],
    locations: (entry.locations ?? []).join("\n"),
    locationRole: entry.locationRole ?? null,
    validUntil: entry.validUntil ? entry.validUntil.slice(0, 10) : "",
    aiEnabled: entry.aiEnabled,
  };
}

/**
 * The AI message library: what the AI may say to guests, entered by the
 * operator and read by every AI that answers them.
 *
 * Built around the two ways it can go wrong. Entering has to be quick,
 * or the library stays empty and the AI improvises -- so one form,
 * sensible defaults, and suggestions drawn from past replies. Reading
 * has to be unambiguous, or a fact lands on the wrong car -- so every
 * entry says what it is, which cars and when, and the page shows the
 * exact text the AI receives for any car and moment.
 */
export function MessageLibraryView({
  locale,
  initialEntries,
  vehicles,
  canSuggest,
}: {
  locale: Locale;
  initialEntries: KnowledgeEntry[];
  vehicles: Vehicle[];
  canSuggest: boolean;
}) {
  const t = getMessages(locale).messageLibrary;
  const [entries, setEntries] = useState(initialEntries);
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<KnowledgeKind | "all">("all");
  const [carFilter, setCarFilter] = useState<string>("all");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<{
    read: number;
    items: Array<{ label: string; triggers: string[]; content: string; kind: "reply" | "fact" }>;
  } | null>(null);

  const vehicleLabel = useMemo(() => Object.fromEntries(vehicles.map((v) => [v.id, v.label])), [vehicles]);
  const dateLabel = (iso: string) =>
    new Date(iso).toLocaleDateString(locale === "en" ? "en-CA" : "zh-CN", { year: "numeric", month: "short", day: "numeric" });

  const normalized = search.trim().toLowerCase();
  const visible = entries.filter((entry) => {
    if (kindFilter !== "all" && entry.kind !== kindFilter) return false;
    if (carFilter === "fleet" && entry.vehicleIds) return false;
    if (carFilter !== "all" && carFilter !== "fleet" && !(entry.vehicleIds === null || entry.vehicleIds.includes(carFilter))) {
      return false;
    }
    if (!normalized) return true;
    return [entry.label, entry.content, ...entry.triggers].join("\n").toLowerCase().includes(normalized);
  });

  async function save() {
    if (!draft || saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/messages/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: draft.id,
          kind: draft.kind,
          label: draft.label,
          content: draft.content,
          triggers: draft.triggers.split(/\r?\n/),
          vehicleIds: draft.vehicleIds.length > 0 ? draft.vehicleIds : null,
          stages: draft.stages.length > 0 ? draft.stages : null,
          locationRole: draft.locationRole,
          locations: draft.locations.split(/\r?\n/).map((word) => word.trim()).filter(Boolean),
          validUntil: draft.validUntil ? `${draft.validUntil}T23:59:59` : null,
          aiEnabled: draft.aiEnabled,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { entry?: KnowledgeEntry; error?: string };
      if (!response.ok || !data.entry) {
        setError(`${t.saveFailed}${data.error ? ` (${data.error})` : ""}`);
        return;
      }
      const saved = data.entry;
      setEntries((current) => [saved, ...current.filter((entry) => entry.id !== saved.id)]);
      setDraft(null);
    } catch {
      setError(t.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  async function remove(entry: KnowledgeEntry) {
    if (!window.confirm(t.deleteConfirm)) return;
    const response = await fetch("/api/messages/templates", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: entry.id }),
    });
    if (response.ok) setEntries((current) => current.filter((item) => item.id !== entry.id));
  }

  async function toggleAi(entry: KnowledgeEntry) {
    const response = await fetch("/api/messages/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: entry.id,
        kind: entry.kind,
        label: entry.label,
        content: entry.content,
        triggers: entry.triggers,
        vehicleIds: entry.vehicleIds,
        stages: entry.stages,
        locations: entry.locations,
        locationRole: entry.locationRole ?? null,
        validUntil: entry.validUntil,
        aiEnabled: !entry.aiEnabled,
      }),
    });
    const data = (await response.json().catch(() => ({}))) as { entry?: KnowledgeEntry };
    if (data.entry) setEntries((current) => current.map((item) => (item.id === entry.id ? data.entry! : item)));
  }

  async function suggest() {
    if (suggesting) return;
    setSuggesting(true);
    setError("");
    try {
      const response = await fetch("/api/messages/templates/suggest", { method: "POST" });
      const data = (await response.json().catch(() => ({}))) as {
        suggestions?: Array<{ label: string; triggers: string[]; content: string; kind: "reply" | "fact" }>;
        read?: number;
        error?: string;
      };
      if (!response.ok) {
        setError(data.error ?? t.saveFailed);
        return;
      }
      setSuggestions({ read: data.read ?? 0, items: data.suggestions ?? [] });
    } finally {
      setSuggesting(false);
    }
  }

  return (
    <div className="space-y-3">
      <section className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3 sm:p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 max-w-2xl">
            <h2 className="text-[16px] font-bold text-[var(--ink)]">{t.title}</h2>
            <p className="mt-1 text-[12.5px] leading-5 text-[var(--ink-soft)]">{t.intro}</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {canSuggest ? (
              <button
                type="button"
                onClick={() => void suggest()}
                disabled={suggesting}
                className="tap-press inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--line-strong)] px-3.5 text-[13px] font-semibold text-[var(--ink)] disabled:opacity-60"
              >
                {suggesting ? <InlineSpinner /> : <Sparkles className="h-4 w-4" aria-hidden />}
                {suggesting ? t.suggesting : t.suggest}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setDraft({ ...EMPTY_DRAFT })}
              className="tap-press inline-flex h-9 items-center gap-1.5 rounded-full bg-[var(--ink)] px-4 text-[13px] font-bold text-[var(--surface)]"
            >
              <Plus className="h-4 w-4" aria-hidden />
              {t.newEntry}
            </button>
          </div>
        </div>
        {error && !draft ? <p className="mt-2 text-[12px] text-[var(--bad-fg)]">{error}</p> : null}

        {suggestions ? (
          <div className="mt-3 rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[12.5px] font-semibold text-[var(--ink)]">
                {suggestions.items.length > 0 ? t.suggestTitle(suggestions.read) : t.suggestEmpty}
              </p>
              <button type="button" onClick={() => setSuggestions(null)} aria-label={t.cancel} className="tap-press text-[var(--ink-soft)]">
                <X className="h-4 w-4" />
              </button>
            </div>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              {suggestions.items.map((item, index) => (
                <li key={`${item.label}-${index}`} className="rounded-md border border-[var(--line)] bg-[var(--surface)] p-2.5 text-[12px]">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-[var(--ink)]">{item.label}</p>
                    <button
                      type="button"
                      onClick={() => {
                        setDraft({ ...EMPTY_DRAFT, kind: item.kind, label: item.label, triggers: item.triggers.join("\n"), content: item.content });
                        setSuggestions((current) =>
                          current ? { ...current, items: current.items.filter((_, i) => i !== index) } : current,
                        );
                      }}
                      className="tap-press shrink-0 rounded-full bg-[var(--ink)] px-2.5 py-1 text-[11.5px] font-bold text-[var(--surface)]"
                    >
                      {t.suggestAdd}
                    </button>
                  </div>
                  {item.triggers.length > 0 ? (
                    <p className="mt-1 text-[11px] text-[var(--ink-soft)]">
                      {t.guestsAsk}: {item.triggers.join(" / ")}
                    </p>
                  ) : null}
                  <p className="mt-1 line-clamp-3 text-[11.5px] leading-4 text-[var(--ink-mid)]">
                    {item.content || <span className="text-[var(--warn-fg)]">{t.suggestNoAnswer}</span>}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="search"
            {...SEARCH_FIELD_PROPS}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t.searchPlaceholder}
            className="h-9 min-w-0 flex-1 rounded-full border border-[var(--line)] bg-[var(--surface-muted)] px-3.5 text-[13px] outline-none focus:border-[var(--line-strong)] sm:max-w-sm"
          />
          <select
            value={kindFilter}
            onChange={(event) => setKindFilter(event.target.value as KnowledgeKind | "all")}
            className="h-9 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 text-[13px] text-[var(--ink)]"
          >
            <option value="all">{t.filterAllKinds}</option>
            {KNOWLEDGE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t.kinds[kind]}
              </option>
            ))}
          </select>
          <select
            value={carFilter}
            onChange={(event) => setCarFilter(event.target.value)}
            className="h-9 max-w-[14rem] rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 text-[13px] text-[var(--ink)]"
          >
            <option value="all">{t.filterAllCars}</option>
            <option value="fleet">{t.filterFleetOnly}</option>
            {vehicles.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.label}
              </option>
            ))}
          </select>
          <span className="ml-auto text-[12px] tabular-nums text-[var(--ink-soft)]">{t.count(visible.length)}</span>
        </div>
      </section>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <ul className="grid content-start gap-2">
          {visible.length === 0 ? (
            <li className="rounded-xl border border-dashed border-[var(--line-strong)] p-6 text-center text-[13px] text-[var(--ink-soft)]">
              {entries.length === 0 ? t.empty : t.emptyFiltered}
            </li>
          ) : null}
          {visible.map((entry) => {
            const expired = isExpired(entry);
            return (
              <li
                key={entry.id}
                className={`rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3 ${
                  !entry.aiEnabled || expired ? "opacity-70" : ""
                }`}
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${KIND_TONE[entry.kind]}`}>
                    {t.kinds[entry.kind]}
                  </span>
                  <h3 className="min-w-0 flex-1 truncate text-[14px] font-semibold text-[var(--ink)]">{entry.label}</h3>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <IconButton label={t.edit} onClick={() => setDraft(toDraft(entry))}>
                      <Pencil className="h-3.5 w-3.5" />
                    </IconButton>
                    <IconButton label={t.duplicate} onClick={() => setDraft(toDraft(entry, true))}>
                      <Copy className="h-3.5 w-3.5" />
                    </IconButton>
                    <IconButton label={t.delete} onClick={() => void remove(entry)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconButton>
                  </div>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px]">
                  <Chip>{entry.vehicleIds ? entry.vehicleIds.map((id) => vehicleLabel[id]?.split(" · ")[0] ?? "?").join("、") : t.allCars}</Chip>
                  <Chip>{entry.stages ? entry.stages.map((stage) => t.stages[stage]).join("、") : t.stages.any}</Chip>
                  {entry.locations ? <Chip>{`${t.locationRoles[entry.locationRole ?? "unconfirmed"]} · ${t.atLocation(entry.locations.join(" / "))}`}</Chip> : null}
                  {entry.validUntil ? <Chip tone={expired ? "bad" : undefined}>{expired ? t.expired : t.validUntil(dateLabel(entry.validUntil))}</Chip> : null}
                  <button
                    type="button"
                    onClick={() => void toggleAi(entry)}
                    className={`tap-press rounded-full px-2 py-0.5 font-semibold ${
                      entry.aiEnabled ? "bg-[var(--ok-bg)] text-[var(--ok-fg)]" : "bg-[var(--surface-muted)] text-[var(--ink-soft)]"
                    }`}
                  >
                    {entry.aiEnabled ? `AI ✓` : t.aiOff}
                  </button>
                </div>
                {entry.triggers.length > 0 ? (
                  <p className="mt-1.5 text-[11.5px] text-[var(--ink-soft)]">
                    {t.guestsAsk}: {entry.triggers.join(" / ")}
                  </p>
                ) : null}
                <p className="mt-1.5 line-clamp-3 whitespace-pre-wrap text-[12.5px] leading-5 text-[var(--ink-mid)]">{entry.content}</p>
              </li>
            );
          })}
        </ul>

        <AiPreview entries={entries} vehicles={vehicles} vehicleLabel={vehicleLabel} t={t} />
      </div>

      {draft ? (
        <EntryEditor
          draft={draft}
          setDraft={setDraft}
          vehicles={vehicles}
          saving={saving}
          error={error}
          onSave={() => void save()}
          onCancel={() => {
            setDraft(null);
            setError("");
          }}
          t={t}
          locale={locale}
        />
      ) : null}
    </div>
  );
}

type Copy = ReturnType<typeof getMessages>["messageLibrary"];

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="tap-press flex h-8 w-8 items-center justify-center rounded-full text-[var(--ink-soft)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
    >
      {children}
    </button>
  );
}

function Chip({ children, tone }: { children: React.ReactNode; tone?: "bad" }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 ${
        tone === "bad" ? "bg-[var(--bad-bg)] text-[var(--bad-fg)]" : "bg-[var(--surface-muted)] text-[var(--ink-mid)]"
      }`}
    >
      {children}
    </span>
  );
}

/**
 * The exact library text the AI receives for a car, a trip stage and a
 * guest message -- the same function the server uses, run here. What
 * the operator sees is what the AI reads, so a misfiled entry shows up
 * before a guest gets it.
 */
function AiPreview({
  entries,
  vehicles,
  vehicleLabel,
  t,
}: {
  entries: KnowledgeEntry[];
  vehicles: Vehicle[];
  vehicleLabel: Record<string, string>;
  t: Copy;
}) {
  const [vehicleId, setVehicleId] = useState<string>(vehicles[0]?.id ?? "");
  const [stage, setStage] = useState<TripStage | "">("before_pickup");
  const [question, setQuestion] = useState("");
  const [pickupLocation, setPickupLocation] = useState("");
  const [returnLocation, setReturnLocation] = useState("");
  const [open, setOpen] = useState(false);

  const block = useMemo(
    () =>
      buildKnowledgeBlock({
        entries,
        scope: { vehicleId: vehicleId || null, stage: stage || null, pickupLocation: pickupLocation.trim() || null, returnLocation: returnLocation.trim() || null },
        question,
        context: null,
        vehicleLabels: vehicleLabel,
      }),
    [entries, vehicleId, stage, question, pickupLocation, returnLocation, vehicleLabel],
  );
  const usable = entries.filter((entry) => entry.aiEnabled && !isExpired(entry)).length;

  return (
    <aside className="h-fit rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3 lg:sticky lg:top-3">
      <h3 className="text-[14px] font-bold text-[var(--ink)]">{t.previewTitle}</h3>
      <p className="mt-1 text-[11.5px] leading-4 text-[var(--ink-soft)]">{t.previewIntro}</p>
      <div className="mt-2 grid gap-2">
        <label className="grid gap-1 text-[11.5px] font-semibold text-[var(--ink-mid)]">
          {t.previewCar}
          <select
            value={vehicleId}
            onChange={(event) => setVehicleId(event.target.value)}
            className="h-9 rounded-md border border-[var(--line)] bg-[var(--surface)] px-2 text-[13px] font-normal text-[var(--ink)]"
          >
            <option value="">{t.previewUnknownCar}</option>
            {vehicles.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-[11.5px] font-semibold text-[var(--ink-mid)]">
          {t.previewStage}
          <select
            value={stage}
            onChange={(event) => setStage(event.target.value as TripStage | "")}
            className="h-9 rounded-md border border-[var(--line)] bg-[var(--surface)] px-2 text-[13px] font-normal text-[var(--ink)]"
          >
            <option value="">{t.previewNoTrip}</option>
            {TRIP_STAGES.map((value) => (
              <option key={value} value={value}>
                {t.stages[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-[11.5px] font-semibold text-[var(--ink-mid)]">
          {t.previewLocation}
          <input
            value={pickupLocation}
            onChange={(event) => setPickupLocation(event.target.value)}
            placeholder="3211 Grant McConachie Way, Richmond"
            className="h-9 rounded-md border border-[var(--line)] bg-[var(--surface)] px-2 text-[13px] font-normal text-[var(--ink)]"
          />
        </label>
        <label className="grid gap-1 text-[11.5px] font-semibold text-[var(--ink-mid)]">
          {t.previewReturnLocation}
          <input
            value={returnLocation}
            onChange={(event) => setReturnLocation(event.target.value)}
            className="h-9 rounded-md border border-[var(--line)] bg-[var(--surface)] px-2 text-[13px] font-normal text-[var(--ink)]"
          />
        </label>
        <label className="grid gap-1 text-[11.5px] font-semibold text-[var(--ink-mid)]">
          {t.previewQuestion}
          <input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Where do I pick up the car?"
            className="h-9 rounded-md border border-[var(--line)] bg-[var(--surface)] px-2 text-[13px] font-normal text-[var(--ink)]"
          />
        </label>
      </div>
      <div className="mt-3 border-t border-[var(--line)] pt-2">
        {block.text ? (
          <>
            <p className="text-[12px] font-semibold text-[var(--ink)]">{t.previewUsed(block.used.length, usable - block.used.length)}</p>
            <ol className="mt-1 space-y-0.5 text-[12px] text-[var(--ink-mid)]">
              {block.used.map((item, index) => (
                <li key={item.id}>
                  K{index + 1} · {t.kinds[item.kind]} · {item.label}
                </li>
              ))}
            </ol>
            <button type="button" onClick={() => setOpen((value) => !value)} className="tap-press mt-2 text-[12px] font-semibold text-[var(--brand)] underline underline-offset-2">
              {open ? t.previewHide : t.previewShow}
            </button>
            {open ? (
              <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-[var(--surface-muted)] p-2 text-[11px] leading-4 text-[var(--ink-mid)]">
                {block.text}
              </pre>
            ) : null}
          </>
        ) : (
          <p className="text-[12px] text-[var(--ink-soft)]">{t.previewNothing}</p>
        )}
      </div>
    </aside>
  );
}

function EntryEditor({
  draft,
  setDraft,
  vehicles,
  saving,
  error,
  onSave,
  onCancel,
  t,
  locale,
}: {
  draft: Draft;
  setDraft: (draft: Draft) => void;
  vehicles: Vehicle[];
  saving: boolean;
  error: string;
  onSave: () => void;
  onCancel: () => void;
  t: Copy;
  locale: Locale;
}) {
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const [carSearch, setCarSearch] = useState("");
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const carQuery = carSearch.trim().toLowerCase();
  const shownCars = vehicles.filter(
    (vehicle) => !carQuery || `${vehicle.label} ${vehicle.nickname ?? ""}`.toLowerCase().includes(carQuery),
  );

  function insertPlaceholder(key: string) {
    const token = `{{${key}}}`;
    const area = contentRef.current;
    if (!area) {
      set({ content: `${draft.content}${token}` });
      return;
    }
    const start = area.selectionStart ?? draft.content.length;
    const end = area.selectionEnd ?? start;
    set({ content: `${draft.content.slice(0, start)}${token}${draft.content.slice(end)}` });
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(start + token.length, start + token.length);
    });
  }

  const label = "grid gap-1 text-[12px] font-semibold text-[var(--ink)]";
  const hint = "text-[11px] font-normal leading-4 text-[var(--ink-soft)]";
  const field =
    "rounded-md border border-[var(--line-strong)] bg-[var(--surface)] px-2.5 py-2 text-[13px] font-normal text-[var(--ink)] outline-none focus:border-[var(--brand)]";
  const toggleChip = (active: boolean) =>
    `tap-press rounded-full border px-2.5 py-1 text-[12px] font-semibold transition ${
      active
        ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--surface)]"
        : "border-[var(--line-strong)] bg-[var(--surface)] text-[var(--ink-mid)]"
    }`;

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center sm:p-4">
      <div role="dialog" aria-modal="true" className="flex max-h-[92dvh] w-full max-w-2xl flex-col rounded-t-2xl border border-[var(--line)] bg-[var(--surface)] shadow-2xl sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
          <h3 className="text-[15px] font-bold text-[var(--ink)]">{draft.id ? t.formTitleEdit : t.formTitleNew}</h3>
          <button type="button" onClick={onCancel} aria-label={t.cancel} className="tap-press text-[var(--ink-soft)]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid gap-3 overflow-y-auto px-4 py-3">
          <div className={label}>
            {t.fieldKind}
            <div className="grid gap-1.5 sm:grid-cols-3">
              {KNOWLEDGE_KINDS.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => set({ kind })}
                  className={`tap-press rounded-lg border p-2 text-left transition ${
                    draft.kind === kind ? "border-[var(--ink)] bg-[var(--surface-muted)]" : "border-[var(--line)]"
                  }`}
                >
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${KIND_TONE[kind]}`}>{t.kinds[kind]}</span>
                  <span className="mt-1 block text-[11px] font-normal leading-4 text-[var(--ink-soft)]">{t.kindHints[kind]}</span>
                </button>
              ))}
            </div>
          </div>

          <label className={label}>
            {t.fieldLabel}
            <input value={draft.label} onChange={(event) => set({ label: event.target.value })} placeholder={t.fieldLabelHint} className={field} />
          </label>

          {draft.kind !== "rule" ? (
            <label className={label}>
              {t.fieldTriggers}
              <textarea
                value={draft.triggers}
                onChange={(event) => set({ triggers: event.target.value })}
                rows={2}
                placeholder={"Where do I pick up the car?\nHow do I get the key?"}
                className={field}
              />
              <span className={hint}>{t.fieldTriggersHint}</span>
            </label>
          ) : null}

          <label className={label}>
            {draft.kind === "rule" ? t.fieldContentRule : t.fieldContent}
            <textarea
              ref={contentRef}
              value={draft.content}
              onChange={(event) => set({ content: event.target.value })}
              rows={5}
              className={field}
            />
            {draft.kind !== "rule" ? (
              <>
                <span className="flex flex-wrap gap-1">
                  {PLACEHOLDER_KEYS.map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => insertPlaceholder(key)}
                      className="tap-press rounded-full border border-[var(--line)] px-2 py-0.5 text-[11px] font-normal text-[var(--ink-mid)] hover:border-[var(--ink)]"
                    >
                      + {PLACEHOLDER_LABELS[key][locale === "en" ? "en" : "zh"]}
                    </button>
                  ))}
                </span>
                <span className={hint}>{t.fieldContentHint}</span>
              </>
            ) : null}
          </label>

          <div className={label}>
            {t.fieldCars}
            <div className="flex flex-wrap items-center gap-1.5">
              <button type="button" onClick={() => set({ vehicleIds: [] })} className={toggleChip(draft.vehicleIds.length === 0)}>
                {t.allCars}
              </button>
              {draft.vehicleIds.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => set({ vehicleIds: draft.vehicleIds.filter((value) => value !== id) })}
                  className={toggleChip(true)}
                >
                  {vehicles.find((vehicle) => vehicle.id === id)?.label.split(" · ")[0] ?? id} ×
                </button>
              ))}
            </div>
            <input value={carSearch} onChange={(event) => setCarSearch(event.target.value)} placeholder={t.carSearch} className={`${field} py-1.5`} />
            {carQuery ? (
              <div className="flex max-h-32 flex-wrap gap-1 overflow-y-auto">
                {shownCars.slice(0, 30).map((vehicle) => {
                  const active = draft.vehicleIds.includes(vehicle.id);
                  return (
                    <button
                      key={vehicle.id}
                      type="button"
                      onClick={() =>
                        set({
                          vehicleIds: active
                            ? draft.vehicleIds.filter((value) => value !== vehicle.id)
                            : [...draft.vehicleIds, vehicle.id],
                        })
                      }
                      className={toggleChip(active)}
                    >
                      {vehicle.label}
                    </button>
                  );
                })}
              </div>
            ) : null}
            <span className={hint}>{t.fieldCarsHint}</span>
          </div>

          <div className={label}>
            {t.fieldStages}
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => set({ stages: [] })} className={toggleChip(draft.stages.length === 0)}>
                {t.stages.any}
              </button>
              {TRIP_STAGES.map((stage) => {
                const active = draft.stages.includes(stage);
                return (
                  <button
                    key={stage}
                    type="button"
                    onClick={() =>
                      set({ stages: active ? draft.stages.filter((value) => value !== stage) : [...draft.stages, stage] })
                    }
                    className={toggleChip(active)}
                  >
                    {t.stages[stage]}
                  </button>
                );
              })}
            </div>
          </div>

          <label className={label}>
            {t.fieldLocationRole}
            <select value={draft.locationRole ?? ""} onChange={(event) => set({ locationRole: (event.target.value || null) as LocationRole | null })} className={field}>
              <option value="">{t.locationRoles.unconfirmed}</option>
              {LOCATION_ROLES.map(role => <option key={role} value={role}>{t.locationRoles[role]}</option>)}
            </select>
          </label>
          <label className={label}>
            {t.fieldLocations}
            <textarea
              value={draft.locations}
              onChange={(event) => set({ locations: event.target.value })}
              rows={2}
              placeholder={"YVR\nGrant McConachie"}
              className={field}
            />
            <span className={hint}>{t.fieldLocationsHint}</span>
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className={label}>
              {t.fieldValidUntil}
              <input type="date" value={draft.validUntil} onChange={(event) => set({ validUntil: event.target.value })} className={field} />
              <span className={hint}>{t.fieldValidUntilHint}</span>
            </label>
            <label className="flex items-center gap-2 self-start pt-6 text-[13px] font-semibold text-[var(--ink)]">
              <input type="checkbox" checked={draft.aiEnabled} onChange={(event) => set({ aiEnabled: event.target.checked })} className="h-4 w-4" />
              {t.fieldAi}
            </label>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--line)] px-4 py-3">
          {error ? <p className="mr-auto text-[12px] text-[var(--bad-fg)]">{error}</p> : null}
          <button type="button" onClick={onCancel} className="tap-press h-9 rounded-full px-3.5 text-[13px] font-semibold text-[var(--ink-soft)]">
            {t.cancel}
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving || !draft.label.trim() || !draft.content.trim()}
            className="tap-press inline-flex h-9 items-center gap-1.5 rounded-full bg-[var(--ink)] px-4 text-[13px] font-bold text-[var(--surface)] disabled:opacity-50"
          >
            {saving ? <InlineSpinner /> : null}
            {saving ? t.saving : t.save}
          </button>
        </div>
      </div>
    </div>
  );
}
