"use client";

import { useState } from "react";

import { getMessages, type Locale } from "@/lib/i18n";

type Field = "brandName" | "eyebrow" | "tagline" | "description" | "hours" | "footerNote";
type LanguageValues = Partial<Record<Field, string>> & { highlightLabels?: string[] };
type Tab = "en" | "zh" | "zh-Hant";

/** Form-field prefix per language. English keeps the original names so
 *  the save action's English path is unchanged. */
const PREFIX: Record<Tab, string> = { en: "", zh: "zh_", "zh-Hant": "zhHant_" };

const FIELD_CLASS =
  "w-full rounded-md border border-[color:var(--line)] bg-[var(--surface-muted)] px-3 py-2 text-[13px] text-[color:var(--ink)]";
const LABEL_CLASS = "mb-1 block text-[11px] font-medium text-[color:var(--ink)]";
const HINT_CLASS = "mt-1 block text-[11px] leading-4 text-[color:var(--ink-soft)]";

/**
 * The operator's words for the site, in three languages, one form.
 *
 * Every language's inputs are always in the DOM -- a tab only hides the
 * other two -- so one Save submits all three, and switching tabs never
 * loses what was typed in another.
 */
export function SiteContentEditor({
  locale,
  values,
  highlights,
}: {
  locale: Locale;
  values: Record<Tab, LanguageValues>;
  highlights: Array<{ value: string; label: string }>;
}) {
  const copy = getMessages(locale).rentalSitePage;
  const [tab, setTab] = useState<Tab>(locale === "en" ? "en" : locale);
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "en", label: copy.contentTabEn },
    { id: "zh", label: copy.contentTabZh },
    { id: "zh-Hant", label: copy.contentTabHant },
  ];
  const highlightRows = Array.from({ length: 4 }, (_, index) => highlights[index] ?? { value: "", label: "" });

  return (
    <div>
      <div role="tablist" className="inline-flex gap-1 rounded-md border border-[color:var(--line)] bg-[var(--surface-muted)] p-1">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={`rounded px-3 py-1.5 text-[12px] font-medium ${
              tab === item.id ? "bg-[var(--surface)] text-[color:var(--ink)] shadow-sm" : "text-[color:var(--ink-soft)]"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tabs.map(({ id }) => {
        const prefix = PREFIX[id];
        const current = values[id] ?? {};
        // What shows when this field is left empty: Traditional falls
        // back to the Simplified (converted), Simplified to English.
        const placeholder = (field: Field) =>
          id === "en"
            ? undefined
            : (id === "zh-Hant" ? values.zh?.[field] : undefined) || values.en?.[field] || undefined;

        return (
          <div key={id} role="tabpanel" hidden={tab !== id} className="mt-3 grid gap-3 sm:grid-cols-2">
            {id === "zh-Hant" ? (
              <p className="text-[11px] text-[color:var(--ink-soft)] sm:col-span-2">{copy.hantFallbackHint}</p>
            ) : null}

            <label className="block min-w-0">
              <span className={LABEL_CLASS}>{copy.brandNameLabel}</span>
              <input
                name={`${prefix}brandName`}
                defaultValue={current.brandName ?? ""}
                placeholder={placeholder("brandName")}
                required={id === "en"}
                maxLength={80}
                className={FIELD_CLASS}
              />
              <span className={HINT_CLASS}>{copy.brandNameHint}</span>
            </label>

            <label className="block min-w-0">
              <span className={LABEL_CLASS}>{copy.eyebrowLabel}</span>
              <input
                name={`${prefix}eyebrow`}
                defaultValue={current.eyebrow ?? ""}
                placeholder={placeholder("eyebrow")}
                maxLength={120}
                className={FIELD_CLASS}
              />
              <span className={HINT_CLASS}>{copy.eyebrowHint}</span>
            </label>

            <label className="block min-w-0 sm:col-span-2">
              <span className={LABEL_CLASS}>{copy.headlineLabel}</span>
              <input
                name={`${prefix}tagline`}
                defaultValue={current.tagline ?? ""}
                placeholder={placeholder("tagline")}
                maxLength={160}
                className={FIELD_CLASS}
              />
              <span className={HINT_CLASS}>{copy.headlineHint}</span>
            </label>

            <label className="block min-w-0 sm:col-span-2">
              <span className={LABEL_CLASS}>{copy.descriptionLabel}</span>
              <textarea
                name={`${prefix}description`}
                rows={4}
                defaultValue={current.description ?? ""}
                placeholder={placeholder("description")}
                maxLength={1200}
                className={FIELD_CLASS}
              />
              <span className={HINT_CLASS}>{copy.descriptionHint}</span>
            </label>

            <label className="block min-w-0">
              <span className={LABEL_CLASS}>{copy.hoursLabel}</span>
              <input
                name={`${prefix}hours`}
                defaultValue={current.hours ?? ""}
                placeholder={placeholder("hours")}
                maxLength={200}
                className={FIELD_CLASS}
              />
              <span className={HINT_CLASS}>{copy.hoursHint}</span>
            </label>

            <label className="block min-w-0">
              <span className={LABEL_CLASS}>{copy.footerNoteLabel}</span>
              <textarea
                name={`${prefix}footerNote`}
                rows={2}
                defaultValue={current.footerNote ?? ""}
                placeholder={placeholder("footerNote")}
                maxLength={1200}
                className={FIELD_CLASS}
              />
              <span className={HINT_CLASS}>{copy.footerNoteHint}</span>
            </label>

            <div className="sm:col-span-2">
              <span className={LABEL_CLASS}>{copy.highlightsLabel}</span>
              <div className="grid gap-2 sm:grid-cols-2">
                {highlightRows.map((row, index) => (
                  <div key={index} className="flex min-w-0 gap-2">
                    {/* The number is shared across languages, so it is
                        edited on the English tab and shown read-only on
                        the others. */}
                    {id === "en" ? (
                      <input
                        name={`highlightValue_${index}`}
                        defaultValue={row.value}
                        placeholder={copy.highlightValuePlaceholder}
                        maxLength={24}
                        className={`${FIELD_CLASS} !w-24 shrink-0`}
                      />
                    ) : (
                      <span className="flex w-24 shrink-0 items-center truncate px-1 text-[13px] font-semibold text-[color:var(--ink-soft)]">
                        {row.value || "—"}
                      </span>
                    )}
                    <input
                      name={`${prefix}highlightLabel_${index}`}
                      defaultValue={id === "en" ? row.label : current.highlightLabels?.[index] ?? ""}
                      placeholder={id === "en" ? copy.highlightLabelPlaceholder : row.label || undefined}
                      maxLength={80}
                      className={`${FIELD_CLASS} min-w-0`}
                    />
                  </div>
                ))}
              </div>
              <span className={HINT_CLASS}>{copy.highlightsHint}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
