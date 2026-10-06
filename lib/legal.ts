import "server-only";

import type { RentalSite } from "@prisma/client";

import { getWorkspaceBookingPolicy } from "@/lib/booking-policy-server";
import { getMessages, type Locale } from "@/lib/i18n";
import type { LegalDocument, PlatformLegalFacts, RenterLegalFacts } from "@/lib/i18n/messages/legal";

/**
 * The facts the legal pages are filled with.
 *
 * TATO's own pages need things code cannot decide -- who the contracting
 * entity is, where it is, which courts -- so they come from environment
 * variables, settable on Railway without a deploy. Until all are set the
 * page says it is an unpublished draft rather than being quietly wrong
 * about who you are agreeing with.
 *
 * A rental site's pages are filled from the site itself (brand, contact,
 * address) and its booking rules, so they cannot disagree with what the
 * booking page says.
 *
 * Neither has been reviewed by a lawyer.
 */

export const LEGAL_DOCS = ["privacy", "terms"] as const;
export type LegalDoc = (typeof LEGAL_DOCS)[number];

export function isLegalDoc(value: string): value is LegalDoc {
  return (LEGAL_DOCS as readonly string[]).includes(value);
}

/** When the wording of the templates last changed. */
const TEMPLATE_DATE = "2026-10-05";

function env(name: string) {
  return process.env[name]?.trim() || null;
}

export type LegalPage = {
  document: LegalDocument;
  effectiveDate: string;
  /** Something the page needs is not filled in yet. */
  draft: boolean;
};

export function getPlatformLegalPage(doc: LegalDoc, locale: Locale): LegalPage {
  const values = {
    entity: env("LEGAL_ENTITY_NAME"),
    address: env("LEGAL_ENTITY_ADDRESS"),
    email: env("LEGAL_CONTACT_EMAIL"),
    jurisdiction: env("LEGAL_JURISDICTION"),
  };
  const facts: PlatformLegalFacts = {
    entity: values.entity ?? "[LEGAL_ENTITY_NAME]",
    address: values.address ?? "[LEGAL_ENTITY_ADDRESS]",
    email: values.email ?? "[LEGAL_CONTACT_EMAIL]",
    jurisdiction: values.jurisdiction ?? "[LEGAL_JURISDICTION]",
  };
  const copy = getMessages(locale).legal;
  return {
    document: doc === "privacy" ? copy.platformPrivacy(facts) : copy.platformTerms(facts),
    effectiveDate: env("LEGAL_EFFECTIVE_DATE") ?? TEMPLATE_DATE,
    draft: Object.values(values).some((value) => value === null) || !env("LEGAL_EFFECTIVE_DATE"),
  };
}

export async function getRenterLegalPage(
  site: Pick<
    RentalSite,
    "workspaceId" | "brandName" | "contactEmail" | "contactPhone" | "contactAddress" | "analyticsId" | "adsConversionSendTo"
  >,
  doc: LegalDoc,
  locale: Locale,
): Promise<LegalPage> {
  const messages = getMessages(locale);
  const policy = await getWorkspaceBookingPolicy(site.workspaceId);
  const contact = [site.contactEmail, site.contactPhone].map((value) => value?.trim()).filter(Boolean).join(" · ");
  const facts: RenterLegalFacts = {
    brand: site.brandName,
    contact: contact || null,
    address: site.contactAddress?.trim() || null,
    cancellation: messages.cancellationPolicies[policy.cancellationPolicy].summary,
    analytics: Boolean(site.analyticsId?.trim() || site.adsConversionSendTo?.trim()),
  };
  return {
    document: doc === "privacy" ? messages.legal.renterPrivacy(facts) : messages.legal.renterTerms(facts),
    effectiveDate: TEMPLATE_DATE,
    // A privacy policy with no way to reach anyone is not finished.
    draft: !site.contactEmail?.trim(),
  };
}
