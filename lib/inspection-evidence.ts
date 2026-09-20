import { createHash } from "crypto";

/**
 * Server-side verification of a vehicle-condition photograph.
 *
 * The rule this file exists to enforce: **nothing the phone says about a
 * photo is taken on trust.** The app reports a digest, a capture time and a
 * location; all three are re-derived here from the bytes that actually
 * arrived. A client can be out of date, buggy, or — since this is also the
 * evidence trail for staff conduct — motivated.
 *
 * Turo's claims team rejects photographs whose metadata lacks date, time or
 * geolocation, and has already rejected this fleet's once. So the same facts
 * an adjuster will look for are extracted and stored per shot, at the moment
 * of upload, where a gap can still be fixed by walking outside and shooting
 * again.
 */

export type EvidenceGap = "notJPEG" | "noCaptureTime" | "noTimeZoneOffset" | "noLocation";

export type ExifFacts = {
  /** Local capture time combined with its offset. */
  capturedAt: Date | null;
  /** The raw local timestamp, as written: `2026:09:09 17:26:40`. */
  localCaptureTime: string | null;
  utcOffset: string | null;
  latitude: number | null;
  longitude: number | null;
  cameraMake: string | null;
  cameraModel: string | null;
  software: string | null;
};

export type UploadRejection = {
  error: "DIGEST_MISMATCH" | "NOT_A_JPEG" | "NO_CAPTURE_TIME" | "EMPTY_FILE";
  status: number;
  detail?: string;
};

export type VerifiedUpload = {
  sha256: string;
  byteCount: number;
  facts: ExifFacts;
  /** What an insurer would find missing. Recorded, not necessarily fatal. */
  gaps: EvidenceGap[];
  /**
   * The phone's clock minus the server's, in seconds, at the moment of
   * upload. A phone's clock is user-settable, so EXIF times are only as
   * trustworthy as the device that wrote them; this is the one cross-check
   * the server can make on its own. Null when the client did not report.
   */
  clockSkewSeconds: number | null;
};

/**
 * What gets rejected outright, and what merely gets recorded.
 *
 * **Rejected** are the things that cannot happen legitimately: bytes that do
 * not hash to what the sender said, a file that is not a JPEG, a photograph
 * with no capture time at all. Each means a bug or a corrupted transfer, and
 * storing it would put a file in the archive that can never be used.
 *
 * **Recorded** is a missing location. It is tempting to reject those too, and
 * it would be wrong: underground car parks exist, and a photograph with no
 * fix is still the only picture of that bumper on that day. Rejecting it
 * destroys evidence we have in exchange for evidence we cannot get. The gap
 * is stored, and the session cannot be completed while any remain — which
 * surfaces it while somebody can still drive the car into the open.
 */
export function verifyUpload(options: {
  bytes: Buffer;
  declaredSha256?: string | null;
  deviceClockAt?: Date | null;
  receivedAt?: Date;
}): { ok: true; result: VerifiedUpload } | { ok: false; rejection: UploadRejection } {
  const { bytes, declaredSha256, deviceClockAt } = options;
  const receivedAt = options.receivedAt ?? new Date();

  if (bytes.length === 0) {
    return { ok: false, rejection: { error: "EMPTY_FILE", status: 400 } };
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (declaredSha256 && declaredSha256.toLowerCase() !== sha256) {
    // Either the upload was corrupted or the sender is not describing what it
    // sent. Both make the file useless as evidence, because the archived
    // digest would no longer be a statement anyone could check.
    return {
      ok: false,
      rejection: { error: "DIGEST_MISMATCH", status: 400, detail: `expected ${declaredSha256}, received ${sha256}` },
    };
  }

  const facts = readExif(bytes);
  const gaps: EvidenceGap[] = [];

  if (!isJPEG(bytes)) {
    return { ok: false, rejection: { error: "NOT_A_JPEG", status: 415 } };
  }
  if (!facts.localCaptureTime) {
    return { ok: false, rejection: { error: "NO_CAPTURE_TIME", status: 422 } };
  }
  if (!facts.utcOffset) gaps.push("noTimeZoneOffset");
  if (facts.latitude === null || facts.longitude === null) gaps.push("noLocation");

  return {
    ok: true,
    result: {
      sha256,
      byteCount: bytes.length,
      facts,
      gaps,
      clockSkewSeconds: deviceClockAt
        ? Math.round((deviceClockAt.getTime() - receivedAt.getTime()) / 1000)
        : null,
    },
  };
}

/** Beyond this the phone's clock is wrong enough to call into question every
 *  timestamp it wrote. Two minutes covers ordinary drift and nothing else. */
export const CLOCK_SKEW_TOLERANCE_SECONDS = 120;

export function clockIsSuspect(skewSeconds: number | null): boolean {
  return skewSeconds !== null && Math.abs(skewSeconds) > CLOCK_SKEW_TOLERANCE_SECONDS;
}

// --- EXIF ------------------------------------------------------------------

const TAG = {
  make: 0x010f,
  model: 0x0110,
  software: 0x0131,
  exifIFD: 0x8769,
  gpsIFD: 0x8825,
  dateTimeOriginal: 0x9003,
  offsetTimeOriginal: 0x9011,
  gpsLatitudeRef: 0x0001,
  gpsLatitude: 0x0002,
  gpsLongitudeRef: 0x0003,
  gpsLongitude: 0x0004,
} as const;

function isJPEG(bytes: Buffer) {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

/**
 * Reads the EXIF a standard parser would read.
 *
 * Written against the TIFF layout rather than using an image library, for the
 * same reason the iOS side has its own reader: the question is not "what does
 * our toolchain think this file contains", it is "what will a stranger's
 * parser find". A library that helpfully synthesises fields from an XMP
 * packet would answer the first question and hide a file with no EXIF at all.
 */
export function readExif(bytes: Buffer): ExifFacts {
  const empty: ExifFacts = {
    capturedAt: null,
    localCaptureTime: null,
    utcOffset: null,
    latitude: null,
    longitude: null,
    cameraMake: null,
    cameraModel: null,
    software: null,
  };
  if (!isJPEG(bytes)) return empty;

  const tiffStart = findExifSegment(bytes);
  if (tiffStart === null) return empty;

  const little = bytes.toString("latin1", tiffStart, tiffStart + 2) === "II";
  const u16 = (at: number) => (little ? bytes.readUInt16LE(at) : bytes.readUInt16BE(at));
  const u32 = (at: number) => (little ? bytes.readUInt32LE(at) : bytes.readUInt32BE(at));

  type Entry = { type: number; count: number; valueOffset: number; entryAt: number };
  const readIFD = (at: number): Map<number, Entry> => {
    const entries = new Map<number, Entry>();
    if (at + 2 > bytes.length) return entries;
    const count = u16(at);
    for (let i = 0; i < count; i++) {
      const entryAt = at + 2 + i * 12;
      if (entryAt + 12 > bytes.length) break;
      entries.set(u16(entryAt), {
        type: u16(entryAt + 2),
        count: u32(entryAt + 4),
        valueOffset: u32(entryAt + 8),
        entryAt,
      });
    }
    return entries;
  };

  const ascii = (entry: Entry | undefined): string | null => {
    if (!entry || entry.type !== 2 || entry.count === 0) return null;
    const start = entry.count <= 4 ? entry.entryAt + 8 : tiffStart + entry.valueOffset;
    if (start + entry.count > bytes.length) return null;
    return bytes.toString("latin1", start, start + entry.count).replace(/\0.*$/, "").trim() || null;
  };

  const rationals = (entry: Entry | undefined): number[] | null => {
    if (!entry || (entry.type !== 5 && entry.type !== 10)) return null;
    const values: number[] = [];
    for (let i = 0; i < entry.count; i++) {
      const at = tiffStart + entry.valueOffset + i * 8;
      if (at + 8 > bytes.length) return null;
      const denominator = u32(at + 4);
      values.push(denominator === 0 ? 0 : u32(at) / denominator);
    }
    return values;
  };

  const ifd0 = readIFD(tiffStart + u32(tiffStart + 4));
  const exif = ifd0.has(TAG.exifIFD) ? readIFD(tiffStart + ifd0.get(TAG.exifIFD)!.valueOffset) : new Map();
  const gps = ifd0.has(TAG.gpsIFD) ? readIFD(tiffStart + ifd0.get(TAG.gpsIFD)!.valueOffset) : new Map();

  const coordinate = (valueTag: number, refTag: number): number | null => {
    const parts = rationals(gps.get(valueTag));
    const ref = ascii(gps.get(refTag));
    if (!parts || parts.length !== 3 || !ref) return null;
    const degrees = parts[0] + parts[1] / 60 + parts[2] / 3600;
    return ref === "S" || ref === "W" ? -degrees : degrees;
  };

  const localCaptureTime = ascii(exif.get(TAG.dateTimeOriginal));
  const utcOffset = ascii(exif.get(TAG.offsetTimeOriginal));

  return {
    localCaptureTime,
    utcOffset,
    capturedAt: toInstant(localCaptureTime, utcOffset),
    latitude: coordinate(TAG.gpsLatitude, TAG.gpsLatitudeRef),
    longitude: coordinate(TAG.gpsLongitude, TAG.gpsLongitudeRef),
    cameraMake: ascii(ifd0.get(TAG.make)),
    cameraModel: ascii(ifd0.get(TAG.model)),
    software: ascii(ifd0.get(TAG.software)),
  };
}

/**
 * Walks the JPEG's segments to the APP1 that carries EXIF.
 *
 * Deliberately a structural walk rather than a search for the `Exif\0\0`
 * bytes: those six bytes can occur inside compressed image data, and a reader
 * that finds them there would parse noise as a TIFF header and report
 * confident nonsense.
 */
function findExifSegment(bytes: Buffer): number | null {
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) {
      at++;
      continue;
    }
    const marker = bytes[at + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) return null; // image data begins; no EXIF
    const length = bytes.readUInt16BE(at + 2);
    if (length < 2) return null;
    if (marker === 0xe1 && bytes.toString("latin1", at + 4, at + 10) === "Exif\0\0") {
      return at + 10;
    }
    at += 2 + length;
  }
  return null;
}

/**
 * Combines the local timestamp with its offset.
 *
 * Returns null without an offset rather than assuming one: a local time names
 * a different instant in every zone, and the windows a claim turns on are
 * counted in hours.
 */
export function toInstant(local: string | null, offset: string | null): Date | null {
  if (!local || !offset) return null;
  const match = local.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const normalisedOffset = /^[+-]\d{2}:\d{2}$/.test(offset) ? offset : null;
  if (!normalisedOffset) return null;
  const parsed = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}${normalisedOffset}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
