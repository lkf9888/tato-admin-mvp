"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { getMessages, type Locale } from "@/lib/i18n";

type VehicleOption = { id: string; label: string; photoCount: number };

/** Turo's CDN serves any size; this is the one the rental site shows well. */
export const TURO_IMPORT_SIZE = "1440x960";

/**
 * The bookmarklet. It runs on a Turo listing in the operator's own
 * browser -- where Cloudflare lets it read the listing, which our
 * server cannot -- collects that car's photo ids in listing order, and
 * opens this page with them. Nothing is sent anywhere else, and no
 * token is involved: the import itself happens here, signed in.
 */
function buildBookmarklet(origin: string) {
  const code = `(async()=>{try{
var m=location.pathname.match(/\\/(\\d{4,})(?:[\\/?#]|$)/);
if(!/turo\\.com$/.test(location.hostname)||!m){alert('TATO: open a car listing on turo.com first.');return;}
var id=m[1],text='';
try{var r=await fetch('/api/vehicle/detail?vehicleId='+id,{credentials:'include'});text=await r.text();}catch(e){}
var re=/images\\.turo\\.com\\/media\\/vehicle\\/images\\/([A-Za-z0-9_-]{8,64})\\./g,ids=[],x;
while((x=re.exec(text))){if(ids.indexOf(x[1])<0)ids.push(x[1]);}
if(!ids.length){var imgs=document.querySelectorAll('img');for(var i=0;i<imgs.length;i++){var s=(imgs[i].currentSrc||imgs[i].src||'').match(/images\\.turo\\.com\\/media\\/vehicle\\/images\\/([A-Za-z0-9_-]{8,64})\\./);if(s&&ids.indexOf(s[1])<0)ids.push(s[1]);}}
if(!ids.length){alert('TATO: no photos found on this page.');return;}
window.open('${origin}/direct-booking/turo-photos?listing='+id+'&ids='+ids.slice(0,12).join(','),'_blank');
}catch(e){alert('TATO: '+e.message);}})();`;
  return `javascript:${encodeURIComponent(code.replace(/\n/g, ""))}`;
}

export function TuroBookmarklet({ locale, origin }: { locale: Locale; origin: string }) {
  const copy = getMessages(locale).directBookingTuroImport;
  const linkRef = useRef<HTMLAnchorElement>(null);
  // Set outside React: React 19 refuses to render a javascript: href.
  useEffect(() => {
    linkRef.current?.setAttribute("href", buildBookmarklet(origin));
  }, [origin]);

  return (
    <div className="rounded-md border border-dashed border-[color:var(--line-strong)] bg-[var(--surface-muted)] px-3 py-3 text-[12px] leading-5 text-[color:var(--ink-mid)]">
      <p className="font-medium text-[color:var(--ink)]">{copy.installTitle}</p>
      <p className="mt-1">{copy.installCopy}</p>
      <a
        ref={linkRef}
        onClick={(event) => event.preventDefault()}
        className="mt-2 inline-block cursor-grab rounded-md bg-[var(--ink)] px-3 py-1.5 text-[12px] font-semibold text-white"
        style={{ backgroundColor: "var(--ink)", color: "#ffffff" }}
      >
        {copy.bookmarkletName}
      </a>
    </div>
  );
}

export function TuroPhotoImport({
  locale,
  listingId,
  photoIds,
  vehicles,
  matchedVehicleId,
}: {
  locale: Locale;
  listingId: string;
  photoIds: string[];
  vehicles: VehicleOption[];
  matchedVehicleId: string | null;
}) {
  const copy = getMessages(locale).directBookingTuroImport;
  const [vehicleId, setVehicleId] = useState(matchedVehicleId ?? "");
  const [selected, setSelected] = useState<string[]>(photoIds);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const target = vehicles.find((vehicle) => vehicle.id === vehicleId);

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : photoIds.filter((item) => item === id || current.includes(item)),
    );
  }

  function runImport() {
    if (!vehicleId || selected.length === 0) return;
    setResult(null);
    startTransition(async () => {
      const response = await fetch(`/api/vehicles/${vehicleId}/attachments/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          urls: selected.map(
            (id) => `https://images.turo.com/media/vehicle/images/${id}.${TURO_IMPORT_SIZE}.jpg`,
          ),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        imported?: number;
        skipped?: number;
        failed?: unknown[];
        error?: string;
      };
      setResult(
        response.ok
          ? {
              ok: (data.failed?.length ?? 0) === 0,
              text: copy.result(data.imported ?? 0, data.skipped ?? 0, data.failed?.length ?? 0),
            }
          : { ok: false, text: copy.failed(data.error ?? String(response.status)) },
      );
    });
  }

  return (
    <section className="rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.88)] px-3 py-3">
      <h3 className="text-[1.05rem] font-semibold text-[color:var(--ink)]">{copy.title}</h3>
      <p className="mt-1 text-[12px] text-[color:var(--ink-soft)]">{copy.listing(listingId, photoIds.length)}</p>

      <label className="mt-3 block max-w-md">
        <span className="mb-1 block text-[11px] font-medium text-[color:var(--ink)]">{copy.targetLabel}</span>
        <select
          value={vehicleId}
          onChange={(event) => setVehicleId(event.target.value)}
          className="w-full rounded-md border border-[color:var(--line)] bg-white px-3 py-2 text-[13px]"
        >
          <option value="">{copy.targetPlaceholder}</option>
          {vehicles.map((vehicle) => (
            <option key={vehicle.id} value={vehicle.id}>
              {vehicle.label}
              {vehicle.id === matchedVehicleId ? ` · ${copy.matched}` : ""}
            </option>
          ))}
        </select>
        {target ? (
          <span className="mt-1 block text-[11px] text-[color:var(--ink-soft)]">
            {copy.existingPhotos(target.photoCount)}
          </span>
        ) : null}
      </label>

      <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {photoIds.map((id, index) => {
          const checked = selected.includes(id);
          return (
            <button
              key={id}
              type="button"
              onClick={() => toggle(id)}
              className={`relative overflow-hidden rounded-md border-2 ${
                checked ? "border-[var(--ink)]" : "border-transparent opacity-40"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`https://images.turo.com/media/vehicle/images/${id}.320x213.jpg`}
                alt=""
                className="aspect-[3/2] w-full object-cover"
              />
              <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 text-[10px] text-white">
                {index + 1}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={runImport}
          disabled={!vehicleId || selected.length === 0 || pending}
          className="rounded-md bg-[var(--ink)] px-4 py-2 text-[12px] font-medium text-white disabled:opacity-50"
          style={{ backgroundColor: "var(--ink)", color: "#ffffff" }}
        >
          {pending ? copy.importing : copy.importAction(selected.length)}
        </button>
        {result ? (
          <p className={`text-[12px] ${result.ok ? "text-[color:var(--ok-fg)]" : "text-[color:var(--bad-fg)]"}`}>
            {result.text}
          </p>
        ) : null}
      </div>
      <p className="mt-2 text-[11px] leading-4 text-[color:var(--ink-soft)]">{copy.orderNote}</p>
    </section>
  );
}
