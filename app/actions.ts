"use server";

import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import {
  LedgerShareTarget,
  OrderStatus,
  OrderSource,
  OwnerSettlementDirection,
  ShareVisibility,
  VehicleStatus,
} from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  clearAdminSession,
  normalizeEmail,
  grantShareAccess,
  requireCurrentAdminContext,
  setAdminSession,
  validateAdminCredentials,
} from "@/lib/auth";
import {
  issuePasswordResetCode,
  issueRegistrationCode,
  verifyPasswordResetCode,
  verifyRegistrationCode,
} from "@/lib/email-verification";
import { getLocale } from "@/lib/i18n-server";
import {
  syncOrderOwnerLedger,
  syncOwnerLedger,
  syncVehicleOwnerLedger,
} from "@/lib/owner-ledger";
import { logActivity, reconcileVehicleConflicts } from "@/lib/orders";
import {
  resolveFeeTarget,
  resolveWorkspaceLedgerPolicy,
  SHAREABLE_FEE_COLUMNS,
  defaultOwnerFeeShares,
} from "@/lib/ledger-policy";
import { prisma } from "@/lib/prisma";
import { foldLatinLookalikes } from "@/lib/utils";
import {
  checkRateLimit,
  formatRetryAfterSeconds,
  getClientIp,
  recordFailedAttempt,
  resetAttempts,
} from "@/lib/rate-limit";
import { roundCurrencyAmount } from "@/lib/utils";
import { createWorkspaceForRegistration } from "@/lib/workspaces";

// Brute-force protection. Limits are deliberately permissive enough
// for typo-and-retry while shutting down credential stuffing: one
// minute lockout in dev is too short to feel, and an attacker hitting
// 10 failed logins in 15 minutes from a single IP is almost certainly
// not legitimate. Both the email *and* the IP are buckets so a
// distributed attack still trips the IP bucket.
const LOGIN_EMAIL_LIMIT = 5;
const LOGIN_IP_LIMIT = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const SHARE_UNLOCK_LIMIT = 6;
const SHARE_UNLOCK_WINDOW_MS = 15 * 60 * 1000;

// Password reset is the highest-value unauthenticated surface in the
// app — a correct 6-digit code yields a full admin session. Limits are
// tighter than login because a legitimate user types one code from
// their inbox, not five guesses. The request bucket is separate from
// the verify bucket so that asking for a fresh code (a normal thing to
// do when the first email is slow) doesn't consume guess budget.
const PASSWORD_RESET_EMAIL_LIMIT = 5;
const PASSWORD_RESET_IP_LIMIT = 10;
const PASSWORD_RESET_REQUEST_IP_LIMIT = 10;
const PASSWORD_RESET_WINDOW_MS = 15 * 60 * 1000;

const ownerSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(2),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  companyName: z.string().optional(),
  notes: z.string().optional(),
});

/** Prisma's "that plate is already on file", without importing its
 *  error classes into every caller. */
function isUniquePlateError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; meta?: { target?: unknown } };
  if (candidate.code !== "P2002") return false;
  const target = candidate.meta?.target;
  return Array.isArray(target) ? target.includes("plateNumber") : target === "plateNumber";
}

const ownerCommissionSchema = z.object({
  // Typed as a percentage because that is how the agreement is written.
  // Stored as a fraction, converted once at the boundary.
  ratePercent: z.coerce.number().min(0).max(100),
  settlement: z.nativeEnum(OwnerSettlementDirection),
  effectiveFrom: z.string().min(8),
  note: z.string().optional(),
});

const vehicleSchema = z.object({
  id: z.string().optional(),
  ownerId: z.string().optional(),
  plateNumber: z.string().min(2),
  nickname: z.string().min(2),
  brand: z.string().min(2),
  model: z.string().min(1),
  year: z.coerce.number().int().min(2000).max(2100),
  vin: z.string().optional(),
  status: z.nativeEnum(VehicleStatus),
  turoListingName: z.string().optional(),
  // `nullish`, not `optional`. Blank means "the main account", and the
  // action writes that as an explicit null -- which `.optional()`
  // rejects, because it admits `undefined` and nothing else. So every
  // hand-added vehicle without a co-host account failed validation and
  // took the whole request down with it.
  //
  // Same shape as the assistant's threadId bug: a nullable column, a
  // caller that sends null, and a schema that only allows undefined.
  // Worth checking for wherever a parse input ends in `|| null`.
  turoAccount: z.string().nullish(),
  isArchived: z.boolean(),
  turoVehicleCode: z.string().optional(),
  purchasePrice: z.coerce.number().nonnegative().optional(),
  ownerCommissionRate: z.coerce.number().min(0).max(100).optional(),
  cleaningFee: z.coerce.number().nonnegative().optional(),
  pickupPassword: z.string().optional(),
  bookingTaxName: z.string().optional(),
  bookingTaxRate: z.coerce.number().min(0).max(100).optional(),
  notes: z.string().optional(),
});

const orderSchema = z.object({
  id: z.string().optional(),
  vehicleId: z.string().min(1),
  renterName: z.string().min(2),
  renterPhone: z.string().optional(),
  pickupDatetime: z.string().min(1),
  returnDatetime: z.string().min(1),
  totalPrice: z.coerce.number().nonnegative().optional(),
  depositAmount: z.coerce.number().nonnegative().optional(),
  status: z.nativeEnum(OrderStatus),
  pickupLocation: z.string().optional(),
  returnLocation: z.string().optional(),
  paymentMethod: z.string().optional(),
  contractNumber: z.string().optional(),
  notes: z.string().optional(),
});

const turoSyncSettingsSchema = z.object({
  csvUrl: z.string().trim().optional(),
  csvYear: z.coerce.number().int().min(2010).max(2100).optional(),
  csvCurl: z.string().trim().optional(),
  csvAuthHeader: z.string().trim().optional(),
  csvHeaders: z.string().trim().optional(),
  csvMapping: z.string().trim().optional(),
  clearSyncHeaders: z.boolean(),
  createMissingVehicles: z.boolean(),
});

const registrationSchema = z.object({
  name: z.string().trim().min(2),
  email: z.string().trim().email(),
  password: z.string().min(6),
});

function cleanOptional(value: FormDataEntryValue | null) {
  if (!value) return undefined;
  const stringValue = value.toString().trim();
  return stringValue ? stringValue : undefined;
}

function revalidateAdminPages() {
  [
    "/dashboard",
    "/vehicles",
    "/vehicle-roi",
    "/owner-statements",
    "/photos",
    "/documents",
    "/direct-booking",
    "/owners",
    "/orders",
    "/calendar",
    "/staff-schedule",
    "/imports",
    "/billing",
    "/share-links",
    "/messages",
  ].forEach((path) => revalidatePath(path));
  // Dynamic routes are not covered by their parent path: revalidating
  // "/owners" leaves "/owners/<id>" -- the page these settings are
  // edited on -- serving whatever it last rendered.
  revalidatePath("/owners/[ownerId]", "page");
  revalidatePath("/owners/[ownerId]/ledger", "page");
}

function cleanText(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function cleanYear(value: number | undefined) {
  return Number.isInteger(value) ? value : null;
}

function isValidUrl(value: string | null) {
  if (!value) return true;
  try {
    const url = new URL(value.replaceAll("{year}", String(new Date().getFullYear())));
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeJsonObjectText(value: string | null): string | null | "INVALID" {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "INVALID";
    if (Object.values(parsed).some((raw) => typeof raw !== "string")) return "INVALID";
    return JSON.stringify(parsed);
  } catch {
    return "INVALID";
  }
}

function parseStoredJsonObject(value: string | null | undefined) {
  if (!value?.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).flatMap(([key, raw]) =>
        typeof raw === "string" ? [[key, raw]] : [],
      ),
    );
  } catch {
    return {};
  }
}

function tokenizeCurlCommand(value: string) {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;
  const normalizedValue = value.replace(/\\\r?\n/g, " ");

  for (const char of normalizedValue) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === "\\" && quote !== "'") {
      escaping = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      if (current === "$") current = "";
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (escaping || quote) return null;
  if (current) tokens.push(current);
  return tokens;
}

const turoCurlHeaderAllowlist = new Set([
  "accept",
  "accept-language",
  "authorization",
  "content-type",
  "cookie",
  "origin",
  "referer",
  "user-agent",
  "x-csrf-token",
  "x-requested-with",
  "x-xsrf-token",
]);

function normalizeTuroDownloadUrl(value: string) {
  const url = new URL(value.replaceAll("{year}", String(new Date().getFullYear())));
  const yearValue = Number.parseInt(url.searchParams.get("year") ?? "", 10);
  const year = Number.isFinite(yearValue) ? yearValue : null;

  if (url.hostname === "turo.com" && url.pathname === "/api/earnings/download") {
    url.searchParams.set("year", "{year}");
    return {
      url: url.toString().replaceAll("%7Byear%7D", "{year}"),
      year,
    };
  }

  return { url: value, year };
}

function parseTuroCurlCommand(value: string | null) {
  if (!value) return null;
  const tokens = tokenizeCurlCommand(value);
  if (!tokens || tokens.length === 0 || tokens[0] !== "curl") return "INVALID" as const;

  let urlValue: string | null = null;
  const headers: Record<string, string> = {};

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    const nextToken = tokens[index + 1];
    const inlineHeader = token.startsWith("--header=")
      ? token.slice("--header=".length)
      : token.startsWith("-H") && token.length > 2
        ? token.slice(2)
        : null;
    const inlineUrl = token.startsWith("--url=") ? token.slice("--url=".length) : null;
    const inlineCookie = token.startsWith("--cookie=")
      ? token.slice("--cookie=".length)
      : token.startsWith("-b") && token.length > 2
        ? token.slice(2)
        : null;

    if ((token === "-H" || token === "--header" || inlineHeader) && (nextToken || inlineHeader)) {
      const rawHeader = inlineHeader ?? nextToken ?? "";
      const separatorIndex = rawHeader.indexOf(":");
      if (separatorIndex > 0) {
        const headerName = rawHeader.slice(0, separatorIndex).trim();
        const headerValue = rawHeader.slice(separatorIndex + 1).trim();
        const normalizedName = headerName.toLowerCase();
        if (turoCurlHeaderAllowlist.has(normalizedName) && headerValue) {
          headers[headerName] = headerValue;
        }
      }
      if (!inlineHeader) index += 1;
      continue;
    }

    if ((token === "-b" || token === "--cookie" || inlineCookie) && (nextToken || inlineCookie)) {
      headers.Cookie = (inlineCookie ?? nextToken ?? "").trim();
      if (!inlineCookie) index += 1;
      continue;
    }

    if (inlineUrl) {
      urlValue = inlineUrl;
      continue;
    }

    if ((token === "--url" || token === "-X" || token === "--request") && nextToken) {
      if (token === "--url") urlValue = nextToken;
      index += 1;
      continue;
    }

    if (!token.startsWith("-") && /^https?:\/\//i.test(token) && !urlValue) {
      urlValue = token;
    }
  }

  if (!urlValue) return "INVALID" as const;

  try {
    const normalized = normalizeTuroDownloadUrl(urlValue);
    return {
      url: normalized.url,
      year: normalized.year,
      headers,
    };
  } catch {
    return "INVALID" as const;
  }
}

export async function saveTuroSyncSettingsAction(formData: FormData) {
  const { workspace, user } = await requireCurrentAdminContext();
  const parsed = turoSyncSettingsSchema.parse({
    csvUrl: formData.get("csvUrl")?.toString(),
    csvYear: formData.get("csvYear")?.toString(),
    csvCurl: formData.get("csvCurl")?.toString(),
    csvAuthHeader: formData.get("csvAuthHeader")?.toString(),
    csvHeaders: formData.get("csvHeaders")?.toString(),
    csvMapping: formData.get("csvMapping")?.toString(),
    clearSyncHeaders: formData.get("clearSyncHeaders") === "on",
    createMissingVehicles: formData.get("createMissingVehicles") === "on",
  });

  const existingConfig = await prisma.turoSyncConfig.findUnique({
    where: { workspaceId: workspace.id },
  });
  const curlConfig = parseTuroCurlCommand(cleanText(parsed.csvCurl));
  if (curlConfig === "INVALID") {
    redirect("/imports?turoSync=invalid-curl");
  }

  const csvUrl = curlConfig?.url ?? cleanText(parsed.csvUrl);
  if (!isValidUrl(csvUrl)) {
    redirect("/imports?turoSync=invalid-url");
  }

  const normalizedManualHeaders = normalizeJsonObjectText(cleanText(parsed.csvHeaders));
  const csvMapping = normalizeJsonObjectText(cleanText(parsed.csvMapping));
  if (normalizedManualHeaders === "INVALID" || csvMapping === "INVALID") {
    redirect("/imports?turoSync=invalid-json");
  }

  const curlHeaders =
    curlConfig && Object.keys(curlConfig.headers).length > 0
      ? JSON.stringify(curlConfig.headers)
      : null;
  const csvHeaders =
    parsed.clearSyncHeaders
      ? null
      : curlHeaders ?? normalizedManualHeaders ?? existingConfig?.csvHeaders ?? null;
  const csvAuthHeader =
    parsed.clearSyncHeaders
      ? null
      : cleanText(parsed.csvAuthHeader) ?? existingConfig?.csvAuthHeader ?? null;
  const csvYear = curlConfig?.year ?? cleanYear(parsed.csvYear);
  await prisma.turoSyncConfig.upsert({
    where: { workspaceId: workspace.id },
    update: {
      csvUrl,
      csvYear,
      csvPath: null,
      csvAuthHeader,
      csvHeaders,
      csvMapping,
      createMissingVehicles: parsed.createMissingVehicles,
      archiveMissingOrders: false,
    },
    create: {
      workspaceId: workspace.id,
      csvUrl,
      csvYear,
      csvPath: null,
      csvAuthHeader,
      csvHeaders,
      csvMapping,
      createMissingVehicles: parsed.createMissingVehicles,
      archiveMissingOrders: false,
    },
  });

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "turo_sync_settings_updated",
    entityType: "TuroSyncConfig",
    entityId: workspace.id,
    metadata: {
      hasCsvUrl: Boolean(csvUrl),
      csvYear,
      hasAuthHeader: Boolean(csvAuthHeader),
      hasHeaders: Boolean(csvHeaders),
      importedCurlHeaders: Boolean(curlConfig),
      storedHeaderNames: Object.keys(parseStoredJsonObject(csvHeaders)),
      hasMapping: Boolean(csvMapping),
      createMissingVehicles: parsed.createMissingVehicles,
      archiveMissingOrders: false,
    },
  });

  revalidatePath("/imports");
  revalidatePath("/calendar");
  redirect("/imports?turoSync=saved");
}

export async function loginAction(formData: FormData) {
  const rawEmail = formData.get("email")?.toString().trim() ?? "";
  const password = formData.get("password")?.toString() ?? "";
  const email = rawEmail ? normalizeEmail(rawEmail) : "";
  const ip = await getClientIp();

  // Check both buckets up front. Either being locked rejects the
  // attempt without burning a bcrypt cycle, so the lockout itself
  // can't be used as a CPU-DoS vector.
  if (email) {
    const emailDecision = await checkRateLimit({
      scope: "login_email",
      identifier: email,
      maxAttempts: LOGIN_EMAIL_LIMIT,
      windowMs: LOGIN_WINDOW_MS,
    });
    if (!emailDecision.allowed) {
      const seconds = formatRetryAfterSeconds(emailDecision.retryAfterMs);
      redirect(`/login?error=throttled&retryAfter=${seconds}`);
    }
  }

  const ipDecision = await checkRateLimit({
    scope: "login_ip",
    identifier: ip,
    maxAttempts: LOGIN_IP_LIMIT,
    windowMs: LOGIN_WINDOW_MS,
  });
  if (!ipDecision.allowed) {
    const seconds = formatRetryAfterSeconds(ipDecision.retryAfterMs);
    redirect(`/login?error=throttled&retryAfter=${seconds}`);
  }

  const authenticatedUser = await validateAdminCredentials(email, password);
  if (!authenticatedUser) {
    if (email) {
      await recordFailedAttempt({
        scope: "login_email",
        identifier: email,
        windowMs: LOGIN_WINDOW_MS,
      });
    }
    await recordFailedAttempt({
      scope: "login_ip",
      identifier: ip,
      windowMs: LOGIN_WINDOW_MS,
    });
    redirect("/login?error=invalid");
  }

  // Wipe the buckets so a few earlier typos don't count later.
  if (email) {
    await resetAttempts({ scope: "login_email", identifier: email });
  }
  await resetAttempts({ scope: "login_ip", identifier: ip });

  await setAdminSession(authenticatedUser.sessionValue);
  redirect("/dashboard");
}

export async function logoutAction() {
  await clearAdminSession();
  redirect("/login");
}

type RegistrationActionResult =
  | { ok: true; sent?: boolean }
  | {
      ok: false;
      error:
        | "invalid"
        | "exists"
        | "throttled"
        | "no_pending_code"
        | "expired"
        | "invalid_code"
        | "too_many_attempts";
    };

/**
 * Step 1 of the new sign-up flow. Validates the form, ensures the email is
 * not already taken, then issues a single-use 6-digit verification code that
 * is emailed to the user. The user account is NOT created yet — only an
 * EmailVerification row exists at this point. Step 2 (verifyAndRegisterAction)
 * actually persists the user once the code matches.
 */
export async function requestRegistrationCodeAction(input: {
  name: string;
  email: string;
  password: string;
}): Promise<RegistrationActionResult> {
  const parsed = registrationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "invalid" };
  }

  const email = normalizeEmail(parsed.data.email);
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    return { ok: false, error: "exists" };
  }

  const locale = await getLocale();
  const result = await issueRegistrationCode({ email, locale });
  if (!result.ok) {
    if (result.reason === "throttled") {
      return { ok: false, error: "throttled" };
    }
    return { ok: false, error: "invalid" };
  }

  return { ok: true, sent: result.sent };
}

/**
 * Step 2 of the new sign-up flow. Re-validates name/email/password against
 * the form (so a tampered client can't slip in a different email after
 * verification), looks up the latest unconsumed EmailVerification record,
 * compares the entered code, and on success creates the User + Workspace +
 * WorkspaceBilling in a single transaction and signs the user in.
 */
export async function verifyAndRegisterAction(input: {
  name: string;
  email: string;
  password: string;
  code: string;
}): Promise<RegistrationActionResult> {
  const parsed = registrationSchema.safeParse({
    name: input.name,
    email: input.email,
    password: input.password,
  });
  if (!parsed.success) {
    return { ok: false, error: "invalid" };
  }

  const name = parsed.data.name.trim();
  const email = normalizeEmail(parsed.data.email);

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    return { ok: false, error: "exists" };
  }

  const verifyResult = await verifyRegistrationCode({
    email,
    code: input.code,
  });
  if (!verifyResult.ok) {
    return { ok: false, error: verifyResult.reason };
  }

  const workspace = await createWorkspaceForRegistration({ name, email });
  const [user] = await prisma.$transaction([
    prisma.user.create({
      data: {
        workspaceId: workspace.id,
        name,
        email,
        passwordHash: await bcrypt.hash(parsed.data.password, 10),
      },
    }),
    prisma.workspaceBilling.create({
      data: {
        workspaceId: workspace.id,
      },
    }),
  ]);

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "user_registered",
    entityType: "User",
    entityId: user.id,
    metadata: { email: user.email, emailVerified: true },
  });

  await setAdminSession(user.id);
  return { ok: true };
}

type PasswordResetActionResult =
  | { ok: true; sent?: boolean }
  | {
      ok: false;
      error:
        | "invalid"
        | "throttled"
        | "no_pending_code"
        | "expired"
        | "invalid_code"
        | "too_many_attempts";
    };

const passwordResetRequestSchema = z.object({
  email: z.string().trim().email(),
});

const passwordResetVerifySchema = z.object({
  email: z.string().trim().email(),
  code: z.string().trim().min(1),
  password: z.string().min(8),
});

/**
 * Step 1 of the password-reset flow. Always returns ok:true (when the
 * input is well-formed) so the form can't be used to enumerate which
 * emails are registered. The actual email is only sent when an account
 * exists — that branch is handled inside `issuePasswordResetCode`.
 */
export async function requestPasswordResetCodeAction(input: {
  email: string;
}): Promise<PasswordResetActionResult> {
  const parsed = passwordResetRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "invalid" };
  }

  const email = normalizeEmail(parsed.data.email);
  const ip = await getClientIp();

  // Cap how many codes one IP can cause to be issued. `issuePasswordResetCode`
  // already throttles per email (30s), but without an IP bucket an
  // attacker can rotate through addresses to keep minting fresh codes —
  // which is also what resets the per-code attempt counter.
  const ipDecision = await checkRateLimit({
    scope: "password_reset_request_ip",
    identifier: ip,
    maxAttempts: PASSWORD_RESET_REQUEST_IP_LIMIT,
    windowMs: PASSWORD_RESET_WINDOW_MS,
  });
  if (!ipDecision.allowed) {
    return { ok: false, error: "throttled" };
  }

  const locale = await getLocale();
  const result = await issuePasswordResetCode({ email, locale });
  if (!result.ok) {
    if (result.reason === "throttled") {
      return { ok: false, error: "throttled" };
    }
    return { ok: false, error: "invalid" };
  }

  await recordFailedAttempt({
    scope: "password_reset_request_ip",
    identifier: ip,
    windowMs: PASSWORD_RESET_WINDOW_MS,
  });

  return { ok: true, sent: result.sent };
}

/**
 * Step 2 of the password-reset flow. Verifies the code, then writes a
 * fresh bcrypt hash and clears any active rate-limit buckets for the
 * email so the user can sign in again immediately.
 *
 * Rate limiting here is not optional. This is an unauthenticated action
 * that hands out account access on a correct 6-digit code, and until
 * v0.23.1 it had none at all — `loginAction` was bucketed but this path
 * was not, so the only cost of a guess was one bcrypt compare. Paired
 * with the per-code cap now enforced atomically in
 * `verifyCodeForPurpose`, a guessing campaign has to burn a bucket slot
 * per attempt on both the email and the IP.
 */
export async function resetPasswordAction(input: {
  email: string;
  code: string;
  password: string;
}): Promise<PasswordResetActionResult> {
  const parsed = passwordResetVerifySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "invalid" };
  }

  const email = normalizeEmail(parsed.data.email);
  const ip = await getClientIp();

  // Check both buckets before spending a bcrypt cycle, so the lockout
  // itself can't be turned into a CPU-exhaustion vector.
  const emailDecision = await checkRateLimit({
    scope: "password_reset_email",
    identifier: email,
    maxAttempts: PASSWORD_RESET_EMAIL_LIMIT,
    windowMs: PASSWORD_RESET_WINDOW_MS,
  });
  if (!emailDecision.allowed) {
    return { ok: false, error: "too_many_attempts" };
  }

  const ipDecision = await checkRateLimit({
    scope: "password_reset_ip",
    identifier: ip,
    maxAttempts: PASSWORD_RESET_IP_LIMIT,
    windowMs: PASSWORD_RESET_WINDOW_MS,
  });
  if (!ipDecision.allowed) {
    return { ok: false, error: "too_many_attempts" };
  }

  const verifyResult = await verifyPasswordResetCode({
    email,
    code: input.code,
  });
  if (!verifyResult.ok) {
    await recordFailedAttempt({
      scope: "password_reset_email",
      identifier: email,
      windowMs: PASSWORD_RESET_WINDOW_MS,
    });
    await recordFailedAttempt({
      scope: "password_reset_ip",
      identifier: ip,
      windowMs: PASSWORD_RESET_WINDOW_MS,
    });
    return { ok: false, error: verifyResult.reason };
  }

  // The account may not exist (we accepted the code anyway to avoid
  // leaking which emails are registered). If so, treat the same as a
  // missing pending code — there's nothing to reset.
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return { ok: false, error: "no_pending_code" };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(parsed.data.password, 10) },
  });

  // Clear every bucket the user could have tripped on the way here, so
  // a successful reset lets them sign in immediately.
  await resetAttempts({ scope: "login_email", identifier: email });
  await resetAttempts({ scope: "password_reset_email", identifier: email });
  await resetAttempts({ scope: "password_reset_ip", identifier: ip });

  await logActivity({
    workspaceId: user.workspaceId ?? null,
    actor: user.name,
    action: "password_reset",
    entityType: "User",
    entityId: user.id,
    metadata: { email: user.email },
  });

  return { ok: true };
}

export async function saveOwnerAction(formData: FormData) {
  const { workspace, user } = await requireCurrentAdminContext();
  const parsed = ownerSchema.parse({
    id: cleanOptional(formData.get("id")),
    name: formData.get("name"),
    phone: cleanOptional(formData.get("phone")),
    email: cleanOptional(formData.get("email")),
    companyName: cleanOptional(formData.get("companyName")),
    notes: cleanOptional(formData.get("notes")),
  });

  const { id, ...ownerData } = parsed;

  const existingOwner = id
    ? await prisma.owner.findFirst({
        where: { id, workspaceId: workspace.id },
      })
    : null;

  const owner = existingOwner
    ? await prisma.owner.update({
        where: { id: existingOwner.id },
        data: ownerData,
      })
    : await prisma.owner.create({
        data: {
          ...ownerData,
          workspaceId: workspace.id,
          // A new owner starts with every extra charge withheld.
          //
          // The workspace policy defaults to OWNER, which is the right
          // default for a policy and the wrong one for a new
          // relationship: an owner is credited a delivery fee or a
          // late fee before anyone has decided they should be, and
          // taking it back later is a conversation. Starting closed and
          // opening what the contract actually covers is the safer
          // direction to be wrong in.
          //
          // Written as explicit overrides so the owner's page shows
          // them as the deliberate choices they are, and so a later
          // change to the workspace policy does not silently reopen
          // charges for owners already signed on the old terms.
          feeShareOverrides: JSON.stringify(defaultOwnerFeeShares()),
        },
      });

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: id ? "owner_updated" : "owner_created",
    entityType: "Owner",
    entityId: owner.id,
    metadata: { name: owner.name },
  });

  revalidateAdminPages();
}

/**
 * Save or replace one owner's commission terms from a given date.
 *
 * Terms are a history, not a field: the rule that applies to a trip is
 * the one in force on the day the trip started, so raising a rate in
 * March leaves January's settled statements exactly as they were. That
 * is the whole reason `effectiveFrom` exists and why this upserts on
 * (owner, date) rather than editing a single row.
 *
 * Every affected order is re-synced afterwards. Ledger lines for a trip
 * are derived, so recomputing them is how a rate change reaches the
 * statements -- and trips before the new start date resolve to the
 * older rule and come out unchanged, which is the point.
 */
export async function saveOwnerCommissionAction(formData: FormData) {
  const { workspace, user } = await requireCurrentAdminContext();

  const ownerId = formData.get("ownerId")?.toString() ?? "";
  const owner = await prisma.owner.findFirst({
    where: { id: ownerId, workspaceId: workspace.id },
    select: { id: true, name: true },
  });
  if (!owner) return;

  const parsed = ownerCommissionSchema.safeParse({
    ratePercent: formData.get("ratePercent"),
    settlement: formData.get("settlement"),
    effectiveFrom: formData.get("effectiveFrom"),
    note: cleanOptional(formData.get("note")),
  });
  if (!parsed.success) return;

  // Dates arrive as a plain calendar day from a date input. Anchored to
  // midday UTC so the day it lands on cannot shift under a timezone --
  // an off-by-one here silently reprices a day's worth of trips.
  const effectiveFrom = new Date(`${parsed.data.effectiveFrom}T12:00:00.000Z`);
  if (Number.isNaN(effectiveFrom.getTime())) return;

  const rate = parsed.data.ratePercent / 100;

  await prisma.ownerCommissionRule.upsert({
    where: { ownerId_effectiveFrom: { ownerId: owner.id, effectiveFrom } },
    update: {
      rate,
      settlement: parsed.data.settlement,
      note: parsed.data.note ?? null,
    },
    create: {
      workspaceId: workspace.id,
      ownerId: owner.id,
      rate,
      settlement: parsed.data.settlement,
      effectiveFrom,
      note: parsed.data.note ?? null,
      createdBy: user.name,
    },
  });

  const resynced = await syncOwnerLedger(owner.id, workspace.id);

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "owner_commission_saved",
    entityType: "Owner",
    entityId: owner.id,
    metadata: {
      name: owner.name,
      ratePercent: parsed.data.ratePercent,
      settlement: parsed.data.settlement,
      effectiveFrom: parsed.data.effectiveFrom,
      resyncedOrders: resynced.orderCount,
    },
  });

  revalidateAdminPages();
}

/** Remove one set of terms; earlier terms take over from that date. */
export async function deleteOwnerCommissionAction(formData: FormData) {
  const { workspace, user } = await requireCurrentAdminContext();

  const ruleId = formData.get("ruleId")?.toString() ?? "";
  const rule = await prisma.ownerCommissionRule.findFirst({
    where: { id: ruleId, owner: { workspaceId: workspace.id } },
    select: { id: true, ownerId: true, owner: { select: { name: true } } },
  });
  if (!rule) return;

  await prisma.ownerCommissionRule.delete({ where: { id: rule.id } });
  const resynced = await syncOwnerLedger(rule.ownerId, workspace.id);

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "owner_commission_deleted",
    entityType: "Owner",
    entityId: rule.ownerId,
    metadata: { name: rule.owner.name, resyncedOrders: resynced.orderCount },
  });

  revalidateAdminPages();
}

/**
 * Move a parked booking onto a car.
 *
 * The trip is real and already described -- guest, dates, location all
 * came from Turo's own mail. The only thing missing was which car, and
 * this supplies it. So it becomes an ordinary order rather than
 * anything special: same shape the email applier would have created if
 * the model had resolved to one vehicle.
 *
 * Deliberately no price. Booking mail quotes an estimate before tolls,
 * cleaning and fees move it, and the owner ledger settles on the CSV's
 * figure -- writing the quote here would put an estimate where the
 * accounts expect a settlement. The next import fills it in.
 */
export async function assignPendingOrderAction(formData: FormData) {
  const { workspace, user } = await requireCurrentAdminContext();

  const pendingId = formData.get("pendingId")?.toString() ?? "";
  const vehicleId = formData.get("vehicleId")?.toString() ?? "";
  if (!pendingId || !vehicleId) return;

  const [pending, vehicle] = await Promise.all([
    prisma.pendingOrder.findFirst({
      where: { id: pendingId, workspaceId: workspace.id },
    }),
    prisma.vehicle.findFirst({
      where: { id: vehicleId, workspaceId: workspace.id },
      select: { id: true, plateNumber: true },
    }),
  ]);
  if (!pending || !vehicle) return;

  // The reservation may have been imported by CSV between the page
  // rendering and this submit. If so the CSV's version wins and this
  // is just a stale basket row to clear.
  const existing = await prisma.order.findFirst({
    where: {
      workspaceId: workspace.id,
      source: OrderSource.turo,
      externalOrderId: pending.externalOrderId,
    },
    select: { id: true },
  });

  const order =
    existing ??
    (await prisma.order.create({
      data: {
        workspaceId: workspace.id,
        vehicleId: vehicle.id,
        source: OrderSource.turo,
        externalOrderId: pending.externalOrderId,
        renterName: pending.renterName,
        renterPhone: pending.renterPhone,
        pickupDatetime: pending.pickupDatetime,
        returnDatetime: pending.returnDatetime,
        pickupLocation: pending.pickupLocation,
        status: pending.status,
        createdBy: user.name,
      },
    }));

  await prisma.pendingOrder.delete({ where: { id: pending.id } });
  await reconcileVehicleConflicts(vehicle.id);
  await syncOrderOwnerLedger(order.id);

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: existing ? "pending_order_already_imported" : "pending_order_assigned",
    entityType: "Order",
    entityId: order.id,
    metadata: {
      externalOrderId: pending.externalOrderId,
      vehicleText: pending.vehicleText,
      plateNumber: vehicle.plateNumber,
    },
  });

  revalidateAdminPages();
}

/** Drop a parked booking without filing it. */
export async function dismissPendingOrderAction(formData: FormData) {
  const { workspace, user } = await requireCurrentAdminContext();
  const pendingId = formData.get("pendingId")?.toString() ?? "";

  const pending = await prisma.pendingOrder.findFirst({
    where: { id: pendingId, workspaceId: workspace.id },
    select: { id: true, externalOrderId: true },
  });
  if (!pending) return;

  await prisma.pendingOrder.delete({ where: { id: pending.id } });

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "pending_order_dismissed",
    entityType: "Workspace",
    entityId: workspace.id,
    metadata: { externalOrderId: pending.externalOrderId },
  });

  revalidateAdminPages();
}

/**
 * Which charges this owner participates in.
 *
 * Saved as exceptions to the workspace policy, not as a full map: an
 * owner with no entries keeps behaving exactly as they did, and a fee
 * added to the catalogue later inherits the workspace default rather
 * than silently becoming withheld.
 *
 * The form posts one value per fee, so anything matching the policy is
 * dropped before storing -- otherwise changing a workspace-level
 * setting would stop reaching every owner who had ever opened this
 * page.
 */
export async function saveOwnerFeeSharingAction(formData: FormData) {
  const { workspace, user } = await requireCurrentAdminContext();

  const ownerId = formData.get("ownerId")?.toString() ?? "";
  const owner = await prisma.owner.findFirst({
    where: { id: ownerId, workspaceId: workspace.id },
    select: { id: true, name: true },
  });
  if (!owner) return;

  const policy = resolveWorkspaceLedgerPolicy(workspace);
  const overrides: Record<string, string> = {};

  for (const column of SHAREABLE_FEE_COLUMNS) {
    const raw = formData.get(`fee:${column}`)?.toString();
    if (raw !== LedgerShareTarget.MANAGER && raw !== LedgerShareTarget.OWNER) continue;
    // Only a genuine departure from the policy is stored.
    if (raw === resolveFeeTarget(column, policy, null)) continue;
    overrides[column] = raw;
  }

  await prisma.owner.update({
    where: { id: owner.id },
    data: {
      feeShareOverrides: Object.keys(overrides).length > 0 ? JSON.stringify(overrides) : null,
    },
  });

  const resynced = await syncOwnerLedger(owner.id, workspace.id);

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "owner_fee_sharing_saved",
    entityType: "Owner",
    entityId: owner.id,
    metadata: { name: owner.name, overrides, resyncedOrders: resynced.orderCount },
  });

  revalidateAdminPages();
}

export async function assignOwnerVehiclesAction(formData: FormData) {
  const { workspace, user } = await requireCurrentAdminContext();
  const ownerId = formData.get("ownerId")?.toString();
  if (!ownerId) return;

  const owner = await prisma.owner.findFirst({
    where: { id: ownerId, workspaceId: workspace.id },
    select: { id: true, name: true },
  });
  if (!owner) return;

  const selectedVehicleIds = Array.from(
    new Set(formData.getAll("vehicleIds").map((value) => value.toString()).filter(Boolean)),
  );

  const [currentlyAssigned, selectedVehicles] = await Promise.all([
    prisma.vehicle.findMany({
      where: { ownerId: owner.id, workspaceId: workspace.id },
      select: { id: true },
    }),
    selectedVehicleIds.length > 0
      ? prisma.vehicle.findMany({
          where: { id: { in: selectedVehicleIds }, workspaceId: workspace.id },
          select: { id: true },
        })
      : Promise.resolve([]),
  ]);

  const validSelectedIds = selectedVehicles.map((vehicle) => vehicle.id);
  const validSelectedSet = new Set(validSelectedIds);
  const currentlyAssignedIds = currentlyAssigned.map((vehicle) => vehicle.id);
  const currentlyAssignedSet = new Set(currentlyAssignedIds);
  const idsToUnassign = currentlyAssignedIds.filter((id) => !validSelectedSet.has(id));
  const affectedVehicleIds = Array.from(new Set([...currentlyAssignedIds, ...validSelectedIds]));

  await prisma.$transaction(async (tx) => {
    if (idsToUnassign.length > 0) {
      await tx.vehicle.updateMany({
        where: {
          workspaceId: workspace.id,
          ownerId: owner.id,
          id: { in: idsToUnassign },
        },
        data: { ownerId: null },
      });
    }

    const idsToAssign = validSelectedIds.filter((id) => !currentlyAssignedSet.has(id));
    if (idsToAssign.length > 0) {
      await tx.vehicle.updateMany({
        where: { workspaceId: workspace.id, id: { in: idsToAssign } },
        data: { ownerId: owner.id },
      });
    }
  });

  for (const vehicleId of affectedVehicleIds) {
    await syncVehicleOwnerLedger(vehicleId);
  }

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "owner_vehicle_assignments_updated",
    entityType: "Owner",
    entityId: owner.id,
    metadata: {
      ownerName: owner.name,
      assignedVehicleIds: validSelectedIds,
      unassignedVehicleIds: idsToUnassign,
    },
  });

  revalidateAdminPages();
}

export async function deleteOwnerAction(formData: FormData) {
  const { workspace, user } = await requireCurrentAdminContext();
  const id = formData.get("id")?.toString();
  if (!id) return;

  const [vehicleCount, ledgerCount] = await Promise.all([
    prisma.vehicle.count({
      where: { ownerId: id, workspaceId: workspace.id },
    }),
    prisma.ownerLedgerItem.count({
      where: { ownerId: id, workspaceId: workspace.id },
    }),
  ]);

  if (vehicleCount > 0 || ledgerCount > 0) {
    redirect("/owners?error=owner-has-vehicles");
  }

  await prisma.shareLink.deleteMany({
    where: { ownerId: id, workspaceId: workspace.id },
  });

  const owner = await prisma.owner.findFirst({
    where: { id, workspaceId: workspace.id },
  });
  if (!owner) return;

  await prisma.owner.delete({
    where: { id: owner.id },
  });

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "owner_deleted",
    entityType: "Owner",
    entityId: owner.id,
  });

  revalidateAdminPages();
}

export async function saveVehicleAction(formData: FormData) {
  const { workspace, user } = await requireCurrentAdminContext();

  // Parsed inside a guard, not thrown from. A ZodError here produced
  // the same anonymous error page as a database failure, so "the year
  // is blank" and "that plate is taken" were indistinguishable from
  // the outside -- both arrived as a digest and a shrug. Naming the
  // field is the whole difference between a bug report and a fix.
  const result = vehicleSchema.safeParse({
    id: cleanOptional(formData.get("id")),
    ownerId: cleanOptional(formData.get("ownerId")),
    // Folded at the boundary. A plate is nearly always pasted from
    // Turo, and Turo has at least one that carries a Cyrillic A --
    // drawn exactly like the Latin one, so a hand-added car and an
    // imported car can look identical and never match each other.
    plateNumber: foldLatinLookalikes(String(formData.get("plateNumber") ?? "").trim()),
    nickname: formData.get("nickname"),
    brand: formData.get("brand"),
    model: formData.get("model"),
    year: formData.get("year"),
    vin: cleanOptional(formData.get("vin")),
    status: formData.get("status"),
    // A checkbox posts "on" or nothing at all, so it is read as
    // presence rather than parsed as a boolean.
    isArchived: formData.get("isArchived") != null,
    turoListingName: cleanOptional(formData.get("turoListingName")),
    // Normalised the same way the email parser normalises the co-host
    // prefix, so "Kevin's vehicle", "Kevin" and "kevin" all land on the
    // same account rather than forking it into three.
    turoAccount:
      cleanOptional(formData.get("turoAccount"))
        ?.replace(/'s\s+vehicles?$/i, "")
        .trim()
        .toLowerCase() || null,
    turoVehicleCode: cleanOptional(formData.get("turoVehicleCode")),
    purchasePrice: cleanOptional(formData.get("purchasePrice")),
    ownerCommissionRate: cleanOptional(formData.get("ownerCommissionRate")),
    cleaningFee: cleanOptional(formData.get("cleaningFee")),
    pickupPassword: cleanOptional(formData.get("pickupPassword")),
    bookingTaxName: cleanOptional(formData.get("bookingTaxName")),
    bookingTaxRate: cleanOptional(formData.get("bookingTaxRate")),
    notes: cleanOptional(formData.get("notes")),
  });

  if (!result.success) {
    const firstIssue = result.error.issues[0];
    const field = firstIssue?.path?.join(".") || "form";
    redirect(
      `/vehicles?error=invalid_field&field=${encodeURIComponent(field)}` +
        `&reason=${encodeURIComponent(firstIssue?.message ?? "")}`,
    );
  }

  const parsed = result.data;
  const { id, ownerCommissionRate, cleaningFee, bookingTaxRate, ...vehicleData } = parsed;
  const normalizedVehicleData = {
    ...vehicleData,
    ownerCommissionRate:
      ownerCommissionRate == null ? null : +(ownerCommissionRate / 100).toFixed(4),
    cleaningFee: roundCurrencyAmount(cleaningFee),
    bookingTaxRate: bookingTaxRate == null ? null : +bookingTaxRate.toFixed(3),
  };

  const existingVehicle = id
    ? await prisma.vehicle.findFirst({
        where: { id, workspaceId: workspace.id },
      })
    : null;

  // A plate is globally unique, across every workspace, and this path
  // did not handle the collision at all -- Prisma threw P2002, the
  // server action 500'd, and the operator got an error page with a
  // digest and no idea that the cause was a plate already on file.
  //
  // It is easy to hit without realising: the plate is folded to Latin
  // now, so pasting A661GL with Turo's Cyrillic A lands on exactly the
  // string an earlier import already created. Which is correct -- it
  // IS the same car -- but "you already have this car" is a sentence,
  // not a crash.
  let vehicle: Awaited<ReturnType<typeof prisma.vehicle.create>> | null = null;
  let conflictPlate: string | null = null;
  let conflictIsElsewhere = false;

  try {
    vehicle = existingVehicle
      ? await prisma.vehicle.update({
          where: { id: existingVehicle.id },
          data: normalizedVehicleData,
        })
      : await prisma.vehicle.create({
          data: {
            ...normalizedVehicleData,
            workspaceId: workspace.id,
          },
        });
  } catch (error) {
    if (!isUniquePlateError(error)) throw error;

    // Look it up globally on purpose. A plate held by another
    // workspace is invisible in this fleet list, which is the case
    // that looks most like a bug from the inside -- the car is not
    // there and cannot be added.
    const holder = await prisma.vehicle.findUnique({
      where: { plateNumber: normalizedVehicleData.plateNumber },
      select: { workspaceId: true, plateNumber: true, nickname: true },
    });
    conflictPlate = holder?.plateNumber ?? normalizedVehicleData.plateNumber;
    conflictIsElsewhere = Boolean(holder && holder.workspaceId !== workspace.id);
  }

  // Redirects throw, so this sits outside the catch above rather than
  // being swallowed by it.
  if (!vehicle) {
    redirect(
      `/vehicles?error=${conflictIsElsewhere ? "plate_taken_elsewhere" : "plate_taken"}` +
        `&plate=${encodeURIComponent(conflictPlate ?? "")}`,
    );
  }

  await syncVehicleOwnerLedger(vehicle.id);

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: id ? "vehicle_updated" : "vehicle_created",
    entityType: "Vehicle",
    entityId: vehicle.id,
    metadata: { plateNumber: vehicle.plateNumber },
  });

  revalidateAdminPages();
}

export async function saveVehiclePurchasePriceAction(formData: FormData) {
  const { workspace, user } = await requireCurrentAdminContext();
  const id = formData.get("id")?.toString().trim();
  if (!id) return;

  const rawPurchasePrice = cleanOptional(formData.get("purchasePrice"));
  const purchasePrice =
    rawPurchasePrice == null ? null : z.coerce.number().nonnegative().parse(rawPurchasePrice);

  const existingVehicle = await prisma.vehicle.findFirst({
    where: { id, workspaceId: workspace.id },
  });
  if (!existingVehicle) return;

  const vehicle = await prisma.vehicle.update({
    where: { id: existingVehicle.id },
    data: { purchasePrice },
  });

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "vehicle_purchase_price_updated",
    entityType: "Vehicle",
    entityId: vehicle.id,
    metadata: {
      plateNumber: vehicle.plateNumber,
      purchasePrice,
    },
  });

  revalidateAdminPages();
}

export async function saveVehicleDirectBookingAction(formData: FormData) {
  const { workspace, user } = await requireCurrentAdminContext();
  const id = formData.get("id")?.toString().trim();
  if (!id) return;

  const directBookingEnabled = formData.get("directBookingEnabled")?.toString() === "on";
  const rawDailyRate = cleanOptional(formData.get("bookingDailyRate"));
  const rawInsuranceFee = cleanOptional(formData.get("bookingInsuranceFee"));
  const rawDepositAmount = cleanOptional(formData.get("bookingDepositAmount"));
  const bookingTaxName = cleanOptional(formData.get("bookingTaxName"));
  const rawTaxRate = cleanOptional(formData.get("bookingTaxRate"));
  const bookingIntro = cleanOptional(formData.get("bookingIntro"));

  const bookingDailyRate =
    rawDailyRate == null ? null : z.coerce.number().nonnegative().parse(rawDailyRate);
  const bookingInsuranceFee =
    rawInsuranceFee == null ? null : z.coerce.number().nonnegative().parse(rawInsuranceFee);
  const bookingDepositAmount =
    rawDepositAmount == null ? null : z.coerce.number().nonnegative().parse(rawDepositAmount);
  const bookingTaxRate =
    rawTaxRate == null ? null : z.coerce.number().min(0).max(100).parse(rawTaxRate);

  const existingVehicle = await prisma.vehicle.findFirst({
    where: { id, workspaceId: workspace.id },
  });
  if (!existingVehicle) return;

  const vehicle = await prisma.vehicle.update({
    where: { id: existingVehicle.id },
    data: {
      directBookingEnabled,
      bookingDailyRate,
      bookingInsuranceFee,
      bookingDepositAmount,
      bookingTaxName,
      bookingTaxRate: bookingTaxRate == null ? null : +bookingTaxRate.toFixed(3),
      bookingIntro,
    },
  });

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "vehicle_direct_booking_updated",
    entityType: "Vehicle",
    entityId: vehicle.id,
    metadata: {
      plateNumber: vehicle.plateNumber,
      directBookingEnabled,
      bookingDailyRate,
      bookingInsuranceFee,
      bookingDepositAmount,
      bookingTaxName,
      bookingTaxRate,
    },
  });

  revalidateAdminPages();
  revalidatePath(`/reserve/${vehicle.id}`);
}

export async function deleteVehicleAction(formData: FormData) {
  const { workspace, user } = await requireCurrentAdminContext();
  const id = formData.get("id")?.toString();
  if (!id) return;

  const vehicle = await prisma.vehicle.findFirst({
    where: { id, workspaceId: workspace.id },
  });
  if (!vehicle) return;

  const deactivated = await prisma.vehicle.update({
    where: { id: vehicle.id },
    data: {
      status: VehicleStatus.inactive,
      directBookingEnabled: false,
    },
  });

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "vehicle_deactivated",
    entityType: "Vehicle",
    entityId: deactivated.id,
    metadata: { plateNumber: deactivated.plateNumber },
  });

  revalidateAdminPages();
}

export async function saveOfflineOrderAction(formData: FormData) {
  const { workspace, user } = await requireCurrentAdminContext();
  const parsed = orderSchema.parse({
    id: cleanOptional(formData.get("id")),
    vehicleId: formData.get("vehicleId"),
    renterName: formData.get("renterName"),
    renterPhone: cleanOptional(formData.get("renterPhone")),
    pickupDatetime: formData.get("pickupDatetime"),
    returnDatetime: formData.get("returnDatetime"),
    totalPrice: cleanOptional(formData.get("totalPrice")),
    depositAmount: cleanOptional(formData.get("depositAmount")),
    status: formData.get("status"),
    pickupLocation: cleanOptional(formData.get("pickupLocation")),
    returnLocation: cleanOptional(formData.get("returnLocation")),
    paymentMethod: cleanOptional(formData.get("paymentMethod")),
    contractNumber: cleanOptional(formData.get("contractNumber")),
    notes: cleanOptional(formData.get("notes")),
  });

  const vehicle = await prisma.vehicle.findFirst({
    where: {
      id: parsed.vehicleId,
      workspaceId: workspace.id,
    },
  });
  if (!vehicle) {
    redirect("/orders?error=vehicle-not-found");
  }

  const payload = {
    workspaceId: workspace.id,
    vehicleId: parsed.vehicleId,
    renterName: parsed.renterName,
    renterPhone: parsed.renterPhone,
    pickupDatetime: new Date(parsed.pickupDatetime),
    returnDatetime: new Date(parsed.returnDatetime),
    totalPrice: roundCurrencyAmount(parsed.totalPrice),
    depositAmount: roundCurrencyAmount(parsed.depositAmount),
    status: parsed.status,
    pickupLocation: parsed.pickupLocation,
    returnLocation: parsed.returnLocation,
    paymentMethod: parsed.paymentMethod,
    contractNumber: parsed.contractNumber,
    notes: parsed.notes,
    source: OrderSource.offline,
    createdBy: user.name,
  };

  const existingOrder = parsed.id
    ? await prisma.order.findFirst({
        where: { id: parsed.id, workspaceId: workspace.id },
      })
    : null;

  const order = existingOrder
    ? await prisma.order.update({
        where: { id: existingOrder.id },
        data: payload,
      })
    : await prisma.order.create({
        data: payload,
      });

  await reconcileVehicleConflicts(parsed.vehicleId);
  await syncOrderOwnerLedger(order.id);

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: parsed.id ? "offline_order_updated" : "offline_order_created",
    entityType: "Order",
    entityId: order.id,
    metadata: {
      source: "offline",
      renterName: order.renterName,
      vehicleId: order.vehicleId,
    },
  });

  revalidateAdminPages();
}

export async function updateOrderStatusAction(formData: FormData) {
  const { workspace, user } = await requireCurrentAdminContext();
  const id = formData.get("id")?.toString();
  const status = formData.get("status")?.toString() as OrderStatus | undefined;

  if (!id || !status) return;

  const existingOrder = await prisma.order.findFirst({
    where: { id, workspaceId: workspace.id },
  });
  if (!existingOrder) return;

  const order = await prisma.order.update({
    where: { id: existingOrder.id },
    data: { status },
  });

  await reconcileVehicleConflicts(order.vehicleId);
  await syncOrderOwnerLedger(order.id);
  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "order_status_updated",
    entityType: "Order",
    entityId: id,
    metadata: { status },
  });

  revalidateAdminPages();
}

export async function deleteOrderAction(formData: FormData) {
  const { workspace, user } = await requireCurrentAdminContext();
  const id = formData.get("id")?.toString();
  if (!id) return;

  const existing = await prisma.order.findFirst({
    where: { id, workspaceId: workspace.id },
  });
  if (!existing) return;

  if (existing.source === OrderSource.turo) {
    redirect("/orders?error=turo-order-readonly");
  }

  const archivedOrder = await prisma.order.update({
    where: { id: existing.id },
    data: {
      isArchived: true,
      status: OrderStatus.cancelled,
    },
  });
  await syncOrderOwnerLedger(archivedOrder.id);
  await reconcileVehicleConflicts(existing.vehicleId);

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "offline_order_deleted",
    entityType: "Order",
    entityId: existing.id,
  });

  revalidateAdminPages();
}

export async function createShareLinkAction(formData: FormData) {
  const { workspace, user } = await requireCurrentAdminContext();
  const ownerId = formData.get("ownerId")?.toString();
  if (!ownerId) return;

  const password = cleanOptional(formData.get("password"));
  const expiresAtValue = cleanOptional(formData.get("expiresAt"));
  const visibility =
    (formData.get("visibility")?.toString() as ShareVisibility | undefined) ??
    ShareVisibility.standard;

  const owner = await prisma.owner.findFirst({
    where: { id: ownerId, workspaceId: workspace.id },
    select: { id: true },
  });
  if (!owner) return;

  const shareLink = await prisma.shareLink.create({
    data: {
      workspaceId: workspace.id,
      ownerId: owner.id,
      token: randomBytes(18).toString("hex"),
      passwordHash: password ? await bcrypt.hash(password, 10) : undefined,
      expiresAt: expiresAtValue ? new Date(expiresAtValue) : undefined,
      visibility,
      createdBy: user.name,
    },
  });

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "share_link_created",
    entityType: "ShareLink",
    entityId: shareLink.id,
    metadata: { ownerId, visibility },
  });

  revalidateAdminPages();
}

export async function revokeShareLinkAction(formData: FormData) {
  const { workspace, user } = await requireCurrentAdminContext();
  const id = formData.get("id")?.toString();
  if (!id) return;

  const existingShareLink = await prisma.shareLink.findFirst({
    where: { id, workspaceId: workspace.id },
  });
  if (!existingShareLink) return;

  await prisma.shareLink.update({
    where: { id: existingShareLink.id },
    data: { isActive: false },
  });

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "share_link_revoked",
    entityType: "ShareLink",
    entityId: existingShareLink.id,
  });

  revalidateAdminPages();
}

export async function deleteShareLinkAction(formData: FormData) {
  const { workspace, user } = await requireCurrentAdminContext();
  const id = formData.get("id")?.toString();
  if (!id) return;

  const existingShareLink = await prisma.shareLink.findFirst({
    where: { id, workspaceId: workspace.id },
  });
  if (!existingShareLink) return;

  await prisma.shareLink.delete({
    where: { id: existingShareLink.id },
  });

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "share_link_deleted",
    entityType: "ShareLink",
    entityId: existingShareLink.id,
  });

  revalidateAdminPages();
}

export async function unlockShareLinkAction(formData: FormData) {
  const token = formData.get("token")?.toString();
  const password = formData.get("password")?.toString() ?? "";
  if (!token) redirect("/login");

  const ip = await getClientIp();
  // Bucket on the token itself — every recipient of the link gets
  // their own pool. Pair with IP so a single attacker rotating tokens
  // still trips the IP cap.
  const tokenDecision = await checkRateLimit({
    scope: "share_unlock_token",
    identifier: token,
    maxAttempts: SHARE_UNLOCK_LIMIT,
    windowMs: SHARE_UNLOCK_WINDOW_MS,
  });
  if (!tokenDecision.allowed) {
    redirect(`/share/${token}?error=throttled`);
  }
  const ipDecision = await checkRateLimit({
    scope: "share_unlock_ip",
    identifier: ip,
    maxAttempts: SHARE_UNLOCK_LIMIT * 4,
    windowMs: SHARE_UNLOCK_WINDOW_MS,
  });
  if (!ipDecision.allowed) {
    redirect(`/share/${token}?error=throttled`);
  }

  const shareLink = await prisma.shareLink.findUnique({
    where: { token },
  });

  if (!shareLink || !shareLink.passwordHash) {
    redirect(`/share/${token}`);
  }

  const valid = await bcrypt.compare(password, shareLink.passwordHash);
  if (!valid) {
    await recordFailedAttempt({
      scope: "share_unlock_token",
      identifier: token,
      windowMs: SHARE_UNLOCK_WINDOW_MS,
    });
    await recordFailedAttempt({
      scope: "share_unlock_ip",
      identifier: ip,
      windowMs: SHARE_UNLOCK_WINDOW_MS,
    });
    redirect(`/share/${token}?error=password`);
  }

  await resetAttempts({ scope: "share_unlock_token", identifier: token });
  await resetAttempts({ scope: "share_unlock_ip", identifier: ip });
  await grantShareAccess(token, shareLink.passwordHash);
  redirect(`/share/${token}`);
}


/**
 * A canned reply, saved or updated.
 *
 * One action for both: `templateId` present means this is an edit of
 * an existing template, absent means a new one. The form is the same
 * either way, which is what lets "edit" mean "open this template's
 * values back into the add form" on the client rather than a second
 * code path here.
 *
 * `vehicleId` empty means general -- offered for any conversation.
 * Set, it has to resolve to a vehicle in this workspace, the same
 * requirement every other vehicle-scoped write in this file makes.
 */
export async function saveMessageTemplateAction(formData: FormData) {
  const { workspace, user } = await requireCurrentAdminContext();

  const templateId = formData.get("templateId")?.toString() || null;
  const label = cleanText(formData.get("label")?.toString());
  const content = cleanText(formData.get("content")?.toString());
  if (!label || !content) return;

  const vehicleIdRaw = formData.get("vehicleId")?.toString();
  let vehicleId: string | null = null;
  if (vehicleIdRaw) {
    const vehicle = await prisma.vehicle.findFirst({
      where: { id: vehicleIdRaw, workspaceId: workspace.id },
      select: { id: true },
    });
    if (!vehicle) return;
    vehicleId = vehicle.id;
  }

  if (templateId) {
    const existing = await prisma.messageTemplate.findFirst({
      where: { id: templateId, workspaceId: workspace.id },
      select: { id: true },
    });
    if (!existing) return;
    await prisma.messageTemplate.update({
      where: { id: existing.id },
      data: { label, content, vehicleId },
    });
  } else {
    await prisma.messageTemplate.create({
      data: { workspaceId: workspace.id, label, content, vehicleId },
    });
  }

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: templateId ? "message_template_updated" : "message_template_created",
    entityType: "MessageTemplate",
    entityId: templateId ?? label,
    metadata: { label, vehicleId },
  });

  revalidatePath("/messages");
}

export async function deleteMessageTemplateAction(formData: FormData) {
  const { workspace, user } = await requireCurrentAdminContext();

  const templateId = formData.get("templateId")?.toString() ?? "";
  const template = await prisma.messageTemplate.findFirst({
    where: { id: templateId, workspaceId: workspace.id },
    select: { id: true, label: true },
  });
  if (!template) return;

  await prisma.messageTemplate.delete({ where: { id: template.id } });

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "message_template_deleted",
    entityType: "MessageTemplate",
    entityId: template.id,
    metadata: { label: template.label },
  });

  revalidatePath("/messages");
}
