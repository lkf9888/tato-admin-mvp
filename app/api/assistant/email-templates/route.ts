import { NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/**
 * The zoo of Turo notification templates, as actually received.
 *
 * Writing parsers against screenshots is writing them against a
 * rendering. This groups the stored mail by the shape of its subject
 * and returns one real body per shape, so a parser is written against
 * the bytes that will actually be fed to it -- including the ones
 * nobody screenshotted because they seemed boring.
 *
 * Admin-only, and bodies are truncated: this returns real guest names
 * and phone numbers, because those are exactly the fields the parsers
 * have to find.
 */

/**
 * Collapse a subject to its template.
 *
 * Turo fills these from a few fixed strings with names, vehicles and
 * numbers substituted in. Dropping every capitalised word and every
 * digit leaves the connective tissue, which is the template itself:
 * "Andrew has sent you a message about your Lexus TX" and "Fatima has
 * sent you a message about your Ford Explorer" both reduce to
 * "has sent you a message about your".
 */
function subjectTemplate(subject: string) {
  return subject
    .replace(/[‘’ʼ]/g, "'")
    .replace(/^\([^)]*\)\s*[-–—]\s*/, "")
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .filter((word) => !/\d/.test(word))
    .filter((word) => !/^[A-Z]/.test(word))
    .join(" ")
    .trim()
    .toLowerCase()
    .slice(0, 120);
}

export async function GET(request: Request) {
  let context;
  try {
    context = await requireCurrentAdminContext();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const url = new URL(request.url);
  const bodyChars = Math.min(
    Math.max(Number.parseInt(url.searchParams.get("chars") ?? "", 10) || 900, 200),
    4000,
  );
  const only = url.searchParams.get("q")?.trim().toLowerCase() ?? "";

  const emails = await prisma.inboundEmail.findMany({
    where: { workspaceId: context.workspace.id },
    orderBy: { receivedAt: "desc" },
    take: 800,
    select: { subject: true, bodyText: true, kind: true, receivedAt: true },
  });

  const groups = new Map<
    string,
    { template: string; kind: string; count: number; subject: string; body: string }
  >();

  for (const email of emails) {
    const template = subjectTemplate(email.subject ?? "");
    if (!template) continue;
    if (only && !template.includes(only) && !(email.subject ?? "").toLowerCase().includes(only)) {
      continue;
    }

    const existing = groups.get(template);
    if (existing) {
      existing.count += 1;
      continue;
    }

    groups.set(template, {
      template,
      kind: email.kind,
      count: 1,
      subject: email.subject ?? "",
      body: (email.bodyText ?? "").slice(0, bodyChars),
    });
  }

  return NextResponse.json({
    scanned: emails.length,
    templates: [...groups.values()].sort((a, b) => b.count - a.count),
  });
}
