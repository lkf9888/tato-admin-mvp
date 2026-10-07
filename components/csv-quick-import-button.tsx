"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { InlineSpinner, TuroTaskProgress, useLeaveGuard } from "@/components/turo-task-progress";
import type { Locale } from "@/lib/i18n";

type QuickImportResult = {
  ok: true;
  fileName: string;
  totalRows: number;
  imported: number;
  failed: number;
  cancelled: number;
  newerObservationsApplied: number;
  missingVehicles: string[];
  otherFailures: number;
  settings: { mapping: "last" | "guessed"; turoAccount: string | null; lastImportedAt: string | null };
};

type State =
  | { kind: "idle" }
  | { kind: "choose"; file: File }
  | { kind: "busy"; fileName: string; startedAt: number }
  | { kind: "done"; result: QuickImportResult }
  | { kind: "error"; message: string };

function copy(locale: Locale) {
  return locale !== "en"
    ? {
        button: "快速导入 CSV",
        busy: (name: string) => `正在导入 ${name}…`,
        progressSteps: ["上传文件", "导入订单"],
        progressNote: "请不要刷新或关闭页面",
        hint: "选一份 Turo 导出的 CSV,再选它属于哪个 Turo 账户,就开始导入。不会新建车辆;车队里没有的车牌会列出来。",
        chooseAccount: "这份文件属于哪个 Turo 账户?",
        mainAccount: "主账户",
        lastUsed: "上次",
        otherAccount: "别的账户请到 CSV 导入页",
        cancel: "取消",
        done: (imported: number, total: number) => `已导入 ${imported} / ${total} 行`,
        failed: (count: number) => `${count} 行失败`,
        cancelled: (count: number) => `其中 ${count} 行是 Turo 已取消的行程`,
        missing: (list: string) => `车队里没有:${list}`,
        more: (count: number) => `等 ${count} 台`,
        guessed: "上次的列对应和这份文件对不上,已按表头自动识别。",
        account: (name: string) => `Turo 账户:${name}`,
        details: "查看导入详情",
        errors: {
          NO_FILE: "没有选到文件。",
          FILE_TOO_LARGE: "文件太大(上限 10 MB),请在 CSV 导入页导入。",
          TURO_SYNC_PARSE_FAILED: "这份文件读不出来,确认是 Turo 导出的 CSV。",
          TURO_SYNC_EMPTY_CSV: "这份 CSV 是空的。",
          BILLING_LIMIT_EXCEEDED: "车辆数已经超过套餐额度,请先到购买额度页处理。",
          fallback: "导入失败,请到 CSV 导入页重试。",
        } as Record<string, string>,
      }
    : {
        button: "Quick CSV import",
        busy: (name: string) => `Importing ${name}…`,
        progressSteps: ["Upload the file", "Import the trips"],
        progressNote: "Please don't refresh or close the page",
        hint: "Pick a Turo CSV export, then the Turo account it came from, and it is imported. No vehicles are created; plates the fleet does not have are listed.",
        chooseAccount: "Which Turo account is this file from?",
        mainAccount: "Main account",
        lastUsed: "last",
        otherAccount: "Another account? Use the CSV imports page",
        cancel: "Cancel",
        done: (imported: number, total: number) => `Imported ${imported} of ${total} rows`,
        failed: (count: number) => `${count} failed`,
        cancelled: (count: number) => `${count} of them are trips Turo cancelled`,
        missing: (list: string) => `Not in the fleet: ${list}`,
        more: (count: number) => `and ${count} more`,
        guessed: "The last mapping did not fit this file, so the columns were matched by their headers.",
        account: (name: string) => `Turo account: ${name}`,
        details: "Import details",
        errors: {
          NO_FILE: "No file was picked.",
          FILE_TOO_LARGE: "The file is over 10 MB. Import it from the CSV imports page.",
          TURO_SYNC_PARSE_FAILED: "This file could not be read. Check that it is a Turo CSV export.",
          TURO_SYNC_EMPTY_CSV: "This CSV is empty.",
          BILLING_LIMIT_EXCEEDED: "The fleet is over the plan's vehicle limit. Sort that out on the billing page first.",
          fallback: "The import failed. Try again from the CSV imports page.",
        } as Record<string, string>,
      };
}

const MISSING_SHOWN = 4;

/**
 * A file and its account, then import -- no review of new cars.
 *
 * For the routine case -- the same export, downloaded again -- where the
 * imports page's new-car step has nothing to confirm. Anything unusual
 * (a new account, new cars to create) still belongs on that page, which
 * the result links to.
 */
export function CsvQuickImportButton({ locale }: { locale: Locale }) {
  const t = useMemo(() => copy(locale), [locale]);
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ kind: "idle" });
  const [accounts, setAccounts] = useState<{ accounts: string[]; lastAccount: string | null } | null>(null);

  // Asked every time, like the imports page: reusing the last account
  // filed a co-hosted export under whichever account came before it.
  function pick(file: File) {
    setState({ kind: "choose", file });
    if (!accounts) {
      void fetch("/api/imports/quick")
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => setAccounts(data ?? { accounts: [], lastAccount: null }))
        .catch(() => setAccounts({ accounts: [], lastAccount: null }));
    }
  }

  async function upload(file: File, turoAccount: string) {
    setState({ kind: "busy", fileName: file.name, startedAt: Date.now() });
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("turoAccount", turoAccount);
      const response = await fetch("/api/imports/quick", { method: "POST", body });
      const data = (await response.json().catch(() => null)) as
        | QuickImportResult
        | { error?: string }
        | null;
      if (!response.ok || !data || !("ok" in data)) {
        const code = data && "error" in data ? data.error ?? "" : "";
        setState({ kind: "error", message: t.errors[code] ?? t.errors.fallback });
        return;
      }
      setState({ kind: "done", result: data });
      router.refresh();
    } catch {
      setState({ kind: "error", message: t.errors.fallback });
    }
  }

  const busy = state.kind === "busy";
  useLeaveGuard(busy);

  return (
    <div className="grid gap-1.5 text-[12px] leading-5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          title={t.hint}
          disabled={busy}
          onClick={() => input.current?.click()}
          className="btn-secondary inline-flex h-8 items-center gap-1.5 px-3 text-[12px] disabled:opacity-60"
        >
          {busy ? <InlineSpinner /> : null}
          {busy ? t.busy(state.fileName) : t.button}
        </button>
        <input
          ref={input}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Cleared so picking the same file again still fires.
            event.target.value = "";
            if (file) pick(file);
          }}
        />
      </div>

      {state.kind === "choose" ? (
        <div className="grid gap-1.5 rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2">
          <p className="font-semibold text-[var(--ink)]">
            {t.chooseAccount} <span className="font-normal text-[var(--ink-soft)]">{state.file.name}</span>
          </p>
          {accounts ? (
            <div className="flex flex-wrap gap-1.5">
              {[{ value: "", label: t.mainAccount }, ...accounts.accounts.map((account) => ({ value: account, label: account }))].map(
                (option) => (
                  <button
                    key={option.value || "(main)"}
                    type="button"
                    onClick={() => void upload(state.file, option.value)}
                    className="tap-press min-h-8 rounded-md border border-[var(--line-strong)] bg-white px-3 py-1 text-[12px] font-semibold text-[var(--ink)] hover:border-[var(--ink)]"
                  >
                    {option.label}
                    {accounts.lastAccount === option.value ? (
                      <span className="ml-1 font-normal text-[var(--ink-soft)]">· {t.lastUsed}</span>
                    ) : null}
                  </button>
                ),
              )}
            </div>
          ) : (
            <InlineSpinner className="text-[var(--ink-soft)]" />
          )}
          <p className="text-[11px] text-[var(--ink-soft)]">
            <a href="/imports" className="underline underline-offset-2">{t.otherAccount}</a>
            {" · "}
            <button type="button" onClick={() => setState({ kind: "idle" })} className="underline underline-offset-2">
              {t.cancel}
            </button>
          </p>
        </div>
      ) : null}

      {state.kind === "busy" ? (
        <TuroTaskProgress
          locale={locale === "en" ? "en" : "zh"}
          steps={t.progressSteps}
          current={1}
          startedAt={state.startedAt}
          note={t.progressNote}
        />
      ) : null}

      {state.kind === "error" ? <p className="text-rose-700">{state.message}</p> : null}

      {state.kind === "done" ? <QuickImportSummary result={state.result} t={t} /> : null}
    </div>
  );
}

function QuickImportSummary({ result, t }: { result: QuickImportResult; t: ReturnType<typeof copy> }) {
  const shown = result.missingVehicles.slice(0, MISSING_SHOWN);
  const hidden = result.missingVehicles.length - shown.length;
  const missing = shown.join(", ") + (hidden > 0 ? ` ${t.more(hidden)}` : "");

  return (
    <div className="grid gap-0.5 text-[var(--ink-mid)]">
      <p>
        <span className="font-semibold text-[var(--ink)]">{t.done(result.imported, result.totalRows)}</span>
        {result.failed > 0 ? <span className="ml-2 text-rose-700">{t.failed(result.failed)}</span> : null}
        {result.cancelled > 0 ? <span className="ml-2">· {t.cancelled(result.cancelled)}</span> : null}
      </p>
      {result.missingVehicles.length > 0 ? <p className="text-rose-700">{t.missing(missing)}</p> : null}
      {result.settings.mapping === "guessed" ? <p className="text-amber-800">{t.guessed}</p> : null}
      <p className="text-[11px] text-[var(--ink-soft)]">
        {result.settings.turoAccount ? `${t.account(result.settings.turoAccount)} · ` : ""}
        {result.fileName}
        {" · "}
        <a href="/imports" className="underline underline-offset-2 hover:text-[var(--ink)]">
          {t.details}
        </a>
      </p>
    </div>
  );
}
