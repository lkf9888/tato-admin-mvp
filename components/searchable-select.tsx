"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { cn, foldLatinLookalikes } from "@/lib/utils";

export type SearchableSelectOption = {
  value: string;
  label: string;
  searchText?: string;
  disabled?: boolean;
};

type SearchableSelectProps = {
  name?: string;
  value?: string;
  defaultValue?: string;
  options: SearchableSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  className?: string;
  menuClassName?: string;
  disabled?: boolean;
  required?: boolean;
  onChange?: (value: string) => void;
};

function normalizeSearch(value: string) {
  // Look-alike letters folded so a pasted plate matches a typed one.
  return foldLatinLookalikes(value.trim()).toLowerCase();
}

export function SearchableSelect({
  name,
  value,
  defaultValue = "",
  options,
  placeholder = "Select",
  searchPlaceholder = "Search...",
  emptyLabel = "No results",
  className,
  menuClassName,
  disabled = false,
  required = false,
  onChange,
}: SearchableSelectProps) {
  const isControlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();
  const selectedValue = isControlled ? value : internalValue;
  const selectedOption = options.find((option) => option.value === selectedValue);
  const normalizedQuery = normalizeSearch(query);
  const filteredOptions = useMemo(
    () =>
      options.filter((option) => {
        if (!normalizedQuery) return true;
        return normalizeSearch(`${option.label} ${option.searchText ?? ""}`).includes(
          normalizedQuery,
        );
      }),
    [normalizedQuery, options],
  );

  // The highlighted row follows the search: the chosen value when it is
  // still listed, else the first row that can be picked.
  useEffect(() => {
    if (!open) return;
    const selected = filteredOptions.findIndex((option) => option.value === selectedValue && !option.disabled);
    setActive(selected >= 0 && !normalizedQuery ? selected : filteredOptions.findIndex((option) => !option.disabled));
  }, [open, filteredOptions, normalizedQuery, selectedValue]);

  useEffect(() => {
    if (active < 0) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  /** The next row that can be picked from `from`, stepping by `step`; stays put at either end. */
  function step(from: number, by: 1 | -1) {
    for (let index = from + by; index >= 0 && index < filteredOptions.length; index += by) {
      if (!filteredOptions[index].disabled) return index;
    }
    return from;
  }

  function onSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => step(current, 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => step(current, -1));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActive(step(-1, 1));
    } else if (event.key === "End") {
      event.preventDefault();
      setActive(step(filteredOptions.length, -1));
    } else if (event.key === "Enter") {
      // Enter picks the highlighted row; it never submits the form around it.
      event.preventDefault();
      const option = filteredOptions[active];
      if (option && !option.disabled) commitValue(option.value);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  }

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.setTimeout(() => searchRef.current?.focus(), 0);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const commitValue = (nextValue: string) => {
    if (!isControlled) {
      setInternalValue(nextValue);
    }
    onChange?.(nextValue);
    setQuery("");
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div ref={rootRef} className="relative min-w-0">
      {name ? (
        <input
          type="hidden"
          name={name}
          value={selectedValue ?? ""}
          required={required}
          disabled={disabled}
        />
      ) : null}
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          "flex min-h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-[var(--line)] bg-white px-3 py-2 text-left text-[12px] font-medium text-[var(--ink)] outline-none transition hover:border-[rgba(17,19,24,0.22)] focus:border-[rgba(17,19,24,0.3)] disabled:cursor-not-allowed disabled:opacity-60",
          className,
        )}
      >
        <span className={cn("min-w-0 flex-1 truncate", selectedOption ? "" : "text-[var(--ink-soft)]")}>
          {selectedOption?.label || placeholder}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-[var(--ink-soft)]" aria-hidden />
      </button>

      {open ? (
        <div
          className={cn(
            "absolute left-0 top-[calc(100%+0.35rem)] z-[100] w-full min-w-[14rem] rounded-md border border-[var(--line)] bg-white p-2 shadow-[0_22px_52px_-28px_rgba(17,19,24,0.55)]",
            menuClassName,
          )}
        >
          <input
            ref={searchRef}
            type="search"
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
            // A search box, not a login: keep password managers from filling it.
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            data-form-type="other"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder={searchPlaceholder}
            className="h-9 w-full rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-3 text-[12px] outline-none transition focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--line)]"
          />
          <div ref={listRef} id={listId} className="mt-2 max-h-60 overflow-y-auto" role="listbox">
            {filteredOptions.length === 0 ? (
              <p className="px-2.5 py-2 text-[12px] text-[var(--ink-soft)]">{emptyLabel}</p>
            ) : (
              filteredOptions.map((option, index) => (
                <button
                  key={`${option.value}-${option.label}`}
                  id={`${listId}-${index}`}
                  data-index={index}
                  type="button"
                  tabIndex={-1}
                  disabled={option.disabled}
                  role="option"
                  aria-selected={option.value === selectedValue}
                  onClick={() => commitValue(option.value)}
                  onMouseMove={() => {
                    if (!option.disabled && index !== active) setActive(index);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12px] text-[var(--ink-mid)] disabled:cursor-not-allowed disabled:opacity-50",
                    option.value === selectedValue ? "font-semibold text-[var(--ink)]" : "",
                    index === active ? "bg-[var(--accent-soft-strong)] text-[var(--ink)]" : "",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {option.value === selectedValue ? (
                    <Check className="h-4 w-4 shrink-0" aria-hidden />
                  ) : null}
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
