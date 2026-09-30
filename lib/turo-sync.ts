import { readFile } from "fs/promises";
import { basename } from "path";

import Papa from "papaparse";

import { checkImportVehicleLimit } from "@/lib/billing-limits";
import { buildCsvHeaderMapping, csvReservationIds, normalizeTuroAccount } from "@/lib/csv-mapping";
import {
  importTuroOrders,
  normalizeCsvFieldMapping,
  type CsvFieldMapping,
} from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { reapplyTuroObservations } from "@/lib/turo-email-apply";
import { DEFAULT_WORKSPACE_SLUG } from "@/lib/workspaces";

const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

type CsvRow = Record<string, string>;

type LoadedCsvSource = {
  content: string;
  fileName: string;
  sourceLabel: string;
  sourceType: "url" | "path";
};

type WorkspaceTuroSyncConfig = {
  csvUrl: string | null;
  csvYear: number | null;
  csvPath: string | null;
  csvAuthHeader: string | null;
  csvHeaders: string | null;
  csvMapping: string | null;
  createMissingVehicles: boolean;
  archiveMissingOrders: boolean;
} | null;

/** What importing one CSV produced, whoever supplied the text. */
export type TuroCsvImportResult = Awaited<ReturnType<typeof importTuroOrders>> & {
  fileName: string;
  totalRows: number;
  /** Unfinished trips whose dates or status were then moved by newer
   *  mail or trip-page reads; see `reapplyTuroObservations`. */
  newerObservationsApplied: number;
};

export type TuroCsvSyncResult = TuroCsvImportResult & {
  sourceType: LoadedCsvSource["sourceType"];
  sourceLabel: string;
  archiveStaleMissingOrders: boolean;
};

export class TuroSyncError extends Error {
  code: string;
  status: number;
  details?: unknown;

  constructor(message: string, code: string, status = 400, details?: unknown) {
    super(message);
    this.name = "TuroSyncError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function parseBooleanEnv(value: string | undefined, fallback: boolean) {
  if (value == null || value.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parsePositiveInteger(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseJsonObjectEnv(value: string | undefined, name: string) {
  if (!value?.trim()) return null;

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Expected a JSON object.");
    }

    const entries = Object.entries(parsed as Record<string, unknown>);
    return Object.fromEntries(
      entries.flatMap(([key, raw]) =>
        typeof raw === "string" ? [[key, raw]] : [],
      ),
    );
  } catch (error) {
    throw new TuroSyncError(
      `${name} must be a JSON object with string values.`,
      "TURO_SYNC_INVALID_CONFIG",
      400,
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function getWorkspaceTuroSyncConfig(workspaceId: string): Promise<WorkspaceTuroSyncConfig> {
  return prisma.turoSyncConfig.findUnique({
    where: { workspaceId },
    select: {
      csvUrl: true,
      csvYear: true,
      csvPath: true,
      csvAuthHeader: true,
      csvHeaders: true,
      csvMapping: true,
      createMissingVehicles: true,
      archiveMissingOrders: true,
    },
  });
}

function getConfiguredRequestHeaders(config: WorkspaceTuroSyncConfig) {
  const headers = new Headers();
  const authHeader =
    config?.csvAuthHeader?.trim() || process.env.TURO_SYNC_CSV_AUTH_HEADER?.trim();
  const configuredHeaders = parseJsonObjectEnv(
    config?.csvHeaders || process.env.TURO_SYNC_CSV_HEADERS,
    "TURO_SYNC_CSV_HEADERS",
  );

  if (authHeader) {
    headers.set("Authorization", authHeader);
  }

  for (const [key, value] of Object.entries(configuredHeaders ?? {})) {
    headers.set(key, value);
  }

  return headers;
}

function inferFileNameFromUrl(value: string) {
  try {
    const url = new URL(value);
    const lastSegment = url.pathname.split("/").filter(Boolean).at(-1);
    return lastSegment && lastSegment.includes(".") ? lastSegment : null;
  } catch {
    return null;
  }
}

function inferFileNameFromDisposition(value: string | null) {
  if (!value) return null;
  const match = value.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  if (!match?.[1]) return null;

  try {
    return decodeURIComponent(match[1].replaceAll('"', "").trim());
  } catch {
    return match[1].replaceAll('"', "").trim();
  }
}

function getConfiguredCsvYear(config: WorkspaceTuroSyncConfig) {
  if (Number.isInteger(config?.csvYear)) return config?.csvYear ?? null;
  return parsePositiveInteger(process.env.TURO_SYNC_CSV_YEAR, new Date().getFullYear());
}

function applyCsvYearTemplate(value: string, config: WorkspaceTuroSyncConfig) {
  const year = getConfiguredCsvYear(config);
  if (!year) return value;

  if (value.includes("{year}")) {
    return value.replaceAll("{year}", String(year));
  }

  try {
    const url = new URL(value);
    if (url.hostname === "turo.com" && url.pathname === "/api/earnings/download") {
      url.searchParams.set("year", String(year));
      return url.toString();
    }
  } catch {
    return value;
  }

  return value;
}

async function loadCsvFromUrl(url: string, config: WorkspaceTuroSyncConfig): Promise<LoadedCsvSource> {
  const timeoutMs = parsePositiveInteger(
    process.env.TURO_SYNC_FETCH_TIMEOUT_MS,
    DEFAULT_FETCH_TIMEOUT_MS,
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: getConfiguredRequestHeaders(config),
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      throw new TuroSyncError(
        `Could not fetch Turo CSV source. HTTP ${response.status}.`,
        "TURO_SYNC_FETCH_FAILED",
        502,
      );
    }

    const content = await response.text();
    return {
      content,
      fileName:
        inferFileNameFromDisposition(response.headers.get("content-disposition")) ??
        inferFileNameFromUrl(url) ??
        `turo-sync-${new Date().toISOString().slice(0, 10)}.csv`,
      sourceLabel: url,
      sourceType: "url",
    };
  } catch (error) {
    if (error instanceof TuroSyncError) throw error;
    throw new TuroSyncError(
      "Could not fetch Turo CSV source.",
      "TURO_SYNC_FETCH_FAILED",
      502,
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function loadConfiguredCsvSource(config: WorkspaceTuroSyncConfig): Promise<LoadedCsvSource> {
  const configuredCsvUrl = config?.csvUrl?.trim();
  const configuredCsvPath = config?.csvPath?.trim();
  const hasWorkspaceSource = Boolean(configuredCsvUrl || configuredCsvPath);
  const csvUrl =
    configuredCsvUrl || (!hasWorkspaceSource ? process.env.TURO_SYNC_CSV_URL?.trim() : undefined);
  const csvPath =
    configuredCsvPath || (!hasWorkspaceSource ? process.env.TURO_SYNC_CSV_PATH?.trim() : undefined);
  const resolvedCsvUrl = csvUrl ? applyCsvYearTemplate(csvUrl, config) : undefined;

  if (resolvedCsvUrl && csvPath) {
    throw new TuroSyncError(
      "Set only one Turo CSV source: TURO_SYNC_CSV_URL or TURO_SYNC_CSV_PATH.",
      "TURO_SYNC_INVALID_CONFIG",
    );
  }

  if (resolvedCsvUrl) {
    return loadCsvFromUrl(resolvedCsvUrl, config);
  }

  if (csvPath) {
    return {
      content: await readFile(csvPath, "utf8"),
      fileName: basename(csvPath),
      sourceLabel: csvPath,
      sourceType: "path",
    };
  }

  throw new TuroSyncError(
    "Configure a Turo CSV source on the CSV Import page or set TURO_SYNC_CSV_URL/TURO_SYNC_CSV_PATH before syncing Turo CSV data.",
    "TURO_SYNC_CONFIG_MISSING",
  );
}

function normalizeParsedRows(rows: Array<Record<string, unknown>>) {
  return rows
    .map((row) => {
      const normalized: CsvRow = {};
      for (const [key, value] of Object.entries(row)) {
        if (!key || key === "__parsed_extra") continue;
        normalized[key.trim()] = value == null ? "" : String(value);
      }
      return normalized;
    })
    .filter((row) => Object.values(row).some((value) => value.trim().length > 0));
}

function parseCsvRows(content: string) {
  const parsed = Papa.parse<Record<string, unknown>>(content, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  });

  const blockingErrors = parsed.errors.filter((error) => error.type !== "FieldMismatch");
  if (blockingErrors.length > 0) {
    const firstError = blockingErrors[0];
    throw new TuroSyncError(
      `Could not parse Turo CSV: ${firstError.message}`,
      "TURO_SYNC_PARSE_FAILED",
      400,
      parsed.errors.slice(0, 5),
    );
  }

  const rows = normalizeParsedRows(parsed.data);
  const headers = (parsed.meta.fields ?? Object.keys(rows[0] ?? {})).map((header) =>
    header.trim(),
  );

  if (rows.length === 0) {
    throw new TuroSyncError(
      "Turo CSV source is empty.",
      "TURO_SYNC_EMPTY_CSV",
    );
  }

  return { rows, headers };
}

function getConfiguredMapping(headers: string[], config: WorkspaceTuroSyncConfig) {
  const configuredMapping = parseJsonObjectEnv(
    config?.csvMapping || process.env.TURO_SYNC_CSV_MAPPING,
    "TURO_SYNC_CSV_MAPPING",
  );
  const mapping = configuredMapping ?? buildCsvHeaderMapping(headers);
  return normalizeCsvFieldMapping(mapping) as CsvFieldMapping;
}

/**
 * The plan's vehicle limit, from `lib/billing-limits` -- the same
 * arithmetic the imports page runs, without a session. The error keeps
 * the fields it always carried and no more: the projection also holds
 * the billing row, and this payload reaches API callers.
 */
async function assertTuroSyncWithinBillingLimit(input: {
  workspaceId: string;
  mapping: CsvFieldMapping;
  rows: CsvRow[];
  createMissingVehicles: boolean;
  billingBypassActive?: boolean;
}) {
  const { projection, withinLimit } = await checkImportVehicleLimit({
    workspaceId: input.workspaceId,
    mapping: input.mapping,
    rows: input.rows,
    createMissingVehicles: input.createMissingVehicles,
    billingBypassActive: input.billingBypassActive ?? false,
  });
  if (withinLimit) return;

  throw new TuroSyncError(
    "Vehicle limit exceeded for the current subscription.",
    "BILLING_LIMIT_EXCEEDED",
    402,
    {
      currentVehicleCount: projection.currentVehicleCount,
      projectedVehicleCount: projection.projectedVehicleCount,
      projectedNewVehicleCount: projection.projectedNewVehicleCount,
      allowedVehicleCount: projection.allowedVehicleCount,
      freeVehicleSlots: projection.freeVehicleSlots,
      bonusVehicleSlots: projection.bonusVehicleSlots,
      purchasedVehicleSlots: projection.purchasedVehicleSlots,
      effectivePurchasedVehicleSlots: projection.effectivePurchasedVehicleSlots,
      selectableVehicleOptions: projection.selectableVehicleOptions,
      exceedsPurchasedLimit: projection.exceedsPurchasedLimit,
    },
  );
}

export async function resolveTuroSyncWorkspace(slug = process.env.TURO_SYNC_WORKSPACE_SLUG) {
  const normalizedSlug = slug?.trim();
  if (normalizedSlug) {
    const workspace = await prisma.workspace.findUnique({
      where: { slug: normalizedSlug },
    });

    if (!workspace) {
      throw new TuroSyncError(
        `No workspace found for TURO_SYNC_WORKSPACE_SLUG="${normalizedSlug}".`,
        "TURO_SYNC_WORKSPACE_NOT_FOUND",
        404,
      );
    }

    return workspace;
  }

  const defaultWorkspace = await prisma.workspace.findUnique({
    where: { slug: DEFAULT_WORKSPACE_SLUG },
  });
  if (defaultWorkspace) return defaultWorkspace;

  const workspaces = await prisma.workspace.findMany({
    take: 2,
    orderBy: { createdAt: "asc" },
  });

  if (workspaces.length === 1 && workspaces[0]) {
    return workspaces[0];
  }

  throw new TuroSyncError(
    "Set TURO_SYNC_WORKSPACE_SLUG so the scheduled Turo sync knows which workspace to update.",
    "TURO_SYNC_WORKSPACE_REQUIRED",
  );
}

/**
 * Parse, map, check the vehicle limit and import -- the one path every
 * Turo CSV takes, whether the scheduled sync fetched it or a caller
 * handed over the text. Mapping follows the workspace's configured
 * mapping when there is one, exactly as the scheduled sync always has,
 * so a file cannot import differently depending on how it arrived.
 */
async function importCsvContent(input: {
  workspaceId: string;
  actor: string;
  fileName: string;
  content: string;
  turoAccount: string | null;
  createMissingVehicles: boolean;
  billingBypassActive?: boolean;
  syncConfig: WorkspaceTuroSyncConfig;
}): Promise<TuroCsvImportResult> {
  const { rows, headers } = parseCsvRows(input.content);
  const mapping = getConfiguredMapping(headers, input.syncConfig);

  await assertTuroSyncWithinBillingLimit({
    workspaceId: input.workspaceId,
    mapping,
    rows,
    createMissingVehicles: input.createMissingVehicles,
    billingBypassActive: input.billingBypassActive,
  });

  const result = await importTuroOrders({
    workspaceId: input.workspaceId,
    fileName: input.fileName,
    rows,
    mapping,
    actor: input.actor,
    createMissingVehicles: input.createMissingVehicles,
    turoAccount: input.turoAccount,
  });

  const reapplied = await reapplyTuroObservations({
    workspaceId: input.workspaceId,
    reservationIds: csvReservationIds(rows, mapping),
  });

  return {
    ...result,
    fileName: input.fileName,
    totalRows: rows.length,
    newerObservationsApplied: reapplied.updated,
  };
}

/**
 * Import a Turo CSV export handed over as text -- by the agent API, or
 * anything else that already has the file.
 *
 * `turoAccount` is taken raw and normalised here (see
 * `normalizeTuroAccount`), so a caller cannot store a spelling the email
 * matcher will not recognise.
 *
 * `createMissingVehicles` defaults to FALSE, unlike the scheduled sync:
 * a caller that forgets it should find unknown plates reported as
 * failed rows, not new cars in the fleet -- a car is a billing slot and
 * an owner relationship, and should come from a person.
 *
 * Throws `TuroSyncError` (`code`, `status`) as the scheduled sync does:
 * TURO_SYNC_PARSE_FAILED / TURO_SYNC_EMPTY_CSV (400),
 * BILLING_LIMIT_EXCEEDED (402).
 */
export async function importTuroCsvText(input: {
  workspaceId: string;
  actor: string;
  fileName: string;
  content: string;
  turoAccount?: string | null;
  createMissingVehicles?: boolean;
}): Promise<TuroCsvImportResult> {
  const syncConfig = await getWorkspaceTuroSyncConfig(input.workspaceId);
  return importCsvContent({
    workspaceId: input.workspaceId,
    actor: input.actor,
    fileName: input.fileName,
    content: input.content,
    turoAccount: normalizeTuroAccount(input.turoAccount),
    createMissingVehicles: input.createMissingVehicles ?? false,
    syncConfig,
  });
}

export async function runTuroCsvSync(input: {
  workspaceId: string;
  actor: string;
  billingBypassActive?: boolean;
}) {
  const syncConfig = await getWorkspaceTuroSyncConfig(input.workspaceId);
  const source = await loadConfiguredCsvSource(syncConfig);
  const createMissingVehicles =
    syncConfig?.createMissingVehicles ??
    parseBooleanEnv(process.env.TURO_SYNC_CREATE_MISSING_VEHICLES, true);
  const archiveStaleMissingOrders = false;

  const result = await importCsvContent({
    workspaceId: input.workspaceId,
    actor: input.actor,
    fileName: source.fileName,
    content: source.content,
    // The configured export is the main account's; co-hosted accounts
    // arrive by upload, where the operator names the account.
    turoAccount: null,
    createMissingVehicles,
    billingBypassActive: input.billingBypassActive,
    syncConfig,
  });

  return {
    ...result,
    sourceType: source.sourceType,
    sourceLabel: source.sourceLabel,
    archiveStaleMissingOrders,
  } satisfies TuroCsvSyncResult;
}

export function summarizeTuroCsvSyncResult(result: TuroCsvSyncResult) {
  return [
    `file=${result.fileName}`,
    `rows=${result.totalRows}`,
    `imported=${result.successRows}`,
    `failed=${result.failedRows}`,
    `createdVehicles=${result.createdVehicles}`,
    `updatedVehicles=${result.updatedVehicles}`,
    `archivedCancelled=${result.deletedCancelledRows}`,
    `archivedStale=${result.deletedStaleOrders}`,
  ].join(" ");
}
