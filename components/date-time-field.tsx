"use client";

import { useEffect, useState } from "react";

import {
  cn,
  composeDateTimeLocalInput,
  formatDateInputDisplay,
  formatTimeInputDisplay,
  parseDateInputDisplay,
} from "@/lib/utils";

type DateTimeFieldProps = {
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  className?: string;
  dateClassName?: string;
  timeClassName?: string;
  disabled?: boolean;
  required?: boolean;
  dateAriaLabel?: string;
  timeAriaLabel?: string;
};

function splitDateTimeInput(value?: string) {
  if (!value) return { dateText: "", timeText: "" };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { dateText: "", timeText: "" };
  return {
    dateText: formatDateInputDisplay(date),
    timeText: formatTimeInputDisplay(date),
  };
}

export function DateTimeField({
  name,
  value,
  defaultValue,
  onChange,
  className,
  dateClassName,
  timeClassName,
  disabled = false,
  required = false,
  dateAriaLabel,
  timeAriaLabel,
}: DateTimeFieldProps) {
  const initial = splitDateTimeInput(value ?? defaultValue);
  const [dateText, setDateText] = useState(initial.dateText);
  const [timeText, setTimeText] = useState(initial.timeText);
  const normalizedValue = composeDateTimeLocalInput(dateText, timeText);

  useEffect(() => {
    if (value === undefined) return;
    const next = splitDateTimeInput(value);
    setDateText(next.dateText);
    setTimeText(next.timeText);
  }, [value]);

  const commit = (nextDateText: string, nextTimeText: string) => {
    const nextValue = composeDateTimeLocalInput(nextDateText, nextTimeText);
    if (nextValue || (!nextDateText && !nextTimeText)) {
      onChange?.(nextValue);
    }
  };

  return (
    <div className={cn("grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_7rem]", className)}>
      {name ? (
        <input
          type="hidden"
          name={name}
          value={normalizedValue}
          required={required}
          disabled={disabled}
        />
      ) : null}
      <input
        type="text"
        inputMode="numeric"
        value={dateText}
        onChange={(event) => {
          const nextDateText = event.target.value;
          setDateText(nextDateText);
          commit(nextDateText, timeText);
        }}
        onBlur={() => {
          const parsed = parseDateInputDisplay(dateText);
          if (!parsed) return;
          const nextDateText = formatDateInputDisplay(parsed);
          setDateText(nextDateText);
          commit(nextDateText, timeText);
        }}
        placeholder="yyyy/mm/dd"
        aria-label={dateAriaLabel}
        disabled={disabled}
        className={cn(
          "h-10 w-full min-w-0 rounded-md border border-[rgba(17,19,24,0.08)] bg-white/84 px-3 text-[13px] text-[color:var(--ink)] outline-none focus:border-[rgba(17,19,24,0.22)]",
          dateClassName,
        )}
      />
      <input
        type="text"
        inputMode="numeric"
        value={timeText}
        onChange={(event) => {
          const nextTimeText = event.target.value;
          setTimeText(nextTimeText);
          commit(dateText, nextTimeText);
        }}
        placeholder="HH:mm"
        aria-label={timeAriaLabel}
        disabled={disabled}
        className={cn(
          "h-10 w-full min-w-0 rounded-md border border-[rgba(17,19,24,0.08)] bg-white/84 px-3 text-[13px] text-[color:var(--ink)] outline-none focus:border-[rgba(17,19,24,0.22)]",
          timeClassName,
        )}
      />
    </div>
  );
}
