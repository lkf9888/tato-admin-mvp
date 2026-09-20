import Link from "next/link";
import { notFound } from "next/navigation";

import { requireCurrentWorkspace } from "@/lib/auth";
import type { Locale } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n-server";
import { CAR_REGIONS } from "@/lib/inspection";
import { findCounterpart, sharpestByRegion, shotFlags, type ShotFlag } from "@/lib/inspection-review";
import { prisma } from "@/lib/prisma";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Params = Promise<{ sessionId: string }>;

type ShotRow = {
  id: string;
  region: string;
  sequence: number;
  capturedAt: Date | null;
  latitude: number | null;
  longitude: number | null;
  cameraModel: string | null;
  sha256: string;
  metadataPath: string;
  evidenceGaps: unknown;
  acceptedDespite: unknown;
  clockSkewSeconds: number | null;
  reportedSharpness: number | null;
};

/**
 * One walk-around, beside the one from the other end of the trip.
 *
 * The pairing is the point. A photograph of a scratch proves a scratch exists;
 * only the same angle from the handover proves the guest put it there. So the
 * layout is per-slot rather than per-session: left is what the car looked like
 * going out, right is what came back, and the eye does the comparison.
 */
export default async function InspectionDetailPage({ params }: { params: Params }) {
  const { sessionId } = await params;
  const workspace = await requireCurrentWorkspace();

  const session = await prisma.inspectionSession.findFirst({
    where: { id: sessionId, workspaceId: workspace.id },
    include: {
      vehicle: { select: { plateNumber: true, nickname: true } },
      shots: { where: { accepted: true } },
    },
  });
  if (!session) notFound();

  const [{ messages, locale }, counterpart] = await Promise.all([getI18n(), findCounterpart(session)]);
  const t = messages.inspections;

  // One photograph per part of the car per side, chosen by sharpness. A
  // free-form walk-around produces several of the same corner, which is what
  // it should produce; a comparison needs one.
  const own = sharpestByRegion(session.shots);
  const other = sharpestByRegion(counterpart?.shots ?? []);
  // Only the parts somebody actually photographed, in a fixed order so the
  // page reads the same way every time.
  const regions = CAR_REGIONS.filter((region) => own.has(region) || other.has(region));

  // The handover always renders on the left, whichever session was opened, so
  // the pair reads the same way round every time: before, then after.
  const thisIsHandover = session.kind === "checkout";

  const flagLabel: Record<ShotFlag, string> = {
    missingMetadata: t.flagMissingMetadata,
    qualityOverridden: t.flagQualityOverridden,
    suspectClock: t.flagSuspectClock,
  };

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <Link href="/inspections" className="text-sm text-blue-600 hover:underline">
          ← {t.title}
        </Link>
        <h1 className="text-2xl font-semibold text-slate-900">
          {session.vehicle?.plateNumber ?? session.vehicleLabel}
          <span className="ml-3 text-base font-normal text-slate-500">
            {session.kind === "checkout" ? t.checkout : t.checkin}
          </span>
        </h1>
        <p className="text-sm text-slate-600">
          {formatDateTime(session.startedAt, locale)} · {session.staffLabel} · {session.deviceModel}
        </p>
        <p className="text-sm text-slate-600">
          {counterpart
            ? t.comparedWith
                .replace("{kind}", counterpart.kind === "checkout" ? t.checkout : t.checkin)
                .replace("{date}", formatDateTime(counterpart.startedAt, locale))
            : t.noCounterpart}
        </p>
      </header>

      <div className="space-y-4">
        {regions.map((region) => {
          const mine = own.get(region) ?? null;
          const theirs = other.get(region) ?? null;
          const left = thisIsHandover ? mine : theirs;
          const right = thisIsHandover ? theirs : mine;

          return (
            <section key={region} className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="mb-3 text-sm font-medium text-slate-900">
                {t[`region_${region}` as keyof typeof t] ?? region}
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <ShotPane label={t.before} shot={left} t={t} locale={locale} flagLabel={flagLabel} />
                <ShotPane label={t.after} shot={right} t={t} locale={locale} flagLabel={flagLabel} />
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function ShotPane({
  label,
  shot,
  t,
  locale,
  flagLabel,
}: {
  label: string;
  shot: ShotRow | null;
  t: Record<string, string>;
  locale: Locale;
  flagLabel: Record<ShotFlag, string>;
}) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      {!shot ? (
        <div className="flex aspect-[4/3] items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-400">
          {t.missingShot}
        </div>
      ) : (
        <>
          {/* Plain <img>, not next/image: the point of this archive is that the
              bytes are the camera's own, and an optimiser that re-encodes them
              would show the viewer something other than the evidence. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/inspection/shots/${shot.id}/file`}
            alt={shot.region}
            className="aspect-[4/3] w-full rounded-md border border-slate-200 object-cover"
            loading="lazy"
          />
          <dl className="space-y-1 text-xs text-slate-600">
            <div className="flex justify-between gap-2">
              <dt>{t.capturedAt}</dt>
              <dd>{shot.capturedAt ? formatDateTime(shot.capturedAt, locale) : "—"}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>{t.location}</dt>
              <dd>
                {shot.latitude !== null && shot.longitude !== null
                  ? `${shot.latitude.toFixed(5)}, ${shot.longitude.toFixed(5)}`
                  : "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>{t.device}</dt>
              <dd>{shot.cameraModel ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>{t.digest}</dt>
              <dd className="font-mono">{shot.sha256.slice(0, 16)}…</dd>
            </div>
          </dl>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="slate">{t.shotNumber.replace("{n}", String(shot.sequence))}</Badge>
            {shotFlags(shot).map((flag) => (
              <Badge key={flag} tone="orange">
                {flagLabel[flag]}
              </Badge>
            ))}
            <a
              href={`/api/inspection/shots/${shot.id}/file`}
              download
              className="ml-auto text-xs font-medium text-blue-600 hover:underline"
            >
              {t.downloadOriginal}
            </a>
          </div>
        </>
      )}
    </div>
  );
}

function Badge({ tone, children }: { tone: "slate" | "orange"; children: React.ReactNode }) {
  const styles =
    tone === "orange"
      ? "bg-orange-50 text-orange-800 ring-orange-200"
      : "bg-slate-50 text-slate-600 ring-slate-200";
  return <span className={`rounded-full px-2 py-0.5 text-xs ring-1 ring-inset ${styles}`}>{children}</span>;
}
