/**
 * Checks the server-side verification of vehicle-condition photographs.
 *
 * The thing being guarded: the server must read a photo's metadata the way a
 * stranger's parser would, and must not take the uploading phone's word for
 * anything. Turo rejected this fleet's photos once already over metadata it
 * could not find, so "our library says it's there" is not the standard.
 *
 *   npx tsx scripts/check-inspection-evidence.ts [path/to/real-photo.jpg]
 *
 * Pass a real photograph to check the parser against one, which is worth
 * doing after any change to how the app writes metadata.
 *
 * Exits non-zero on any disagreement.
 */
import { createHash } from "crypto";
import { readFileSync } from "fs";

import { clockIsSuspect, readExif, toInstant, verifyUpload } from "@/lib/inspection-evidence";
import { CLAIM_WINDOW_HOURS, dueState } from "@/lib/inspection-review";

let failed = 0;

function check(ok: boolean, what: string, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  ${detail}` : ""}`);
}

// --- A JPEG with EXIF, assembled by hand ------------------------------------
//
// Built rather than checked in. A fixture nobody can read the provenance of is
// the wrong thing to have in a repository about provenance, and hand assembly
// means the expected values are visible right here next to the assertions.

const NUL = String.fromCharCode(0);

type ExifInput = {
  make?: string;
  model?: string;
  dateTimeOriginal?: string;
  offsetTimeOriginal?: string;
  latitude?: number;
  longitude?: number;
};

function buildExifJpeg(input: ExifInput): Buffer {
  const data: Buffer[] = [];
  let dataLength = 0;

  /** Values longer than four bytes live in a blob area after the IFDs; the
   *  rest sit inline in the entry, exactly as the TIFF spec requires. */
  const stash = (buffer: Buffer) => {
    const handle = { offset: dataLength };
    data.push(buffer);
    dataLength += buffer.length;
    return handle;
  };

  const asciiValue = (text: string) => {
    const buffer = Buffer.from(text + NUL, "latin1");
    return {
      count: buffer.length,
      inline: buffer.length <= 4 ? buffer : null,
      blob: buffer.length > 4 ? stash(buffer) : null,
    };
  };

  const dmsValue = (degrees: number) => {
    const absolute = Math.abs(degrees);
    const d = Math.floor(absolute);
    const m = Math.floor((absolute - d) * 60);
    const s = Math.round((absolute - d - m / 60) * 3600 * 10000);
    const buffer = Buffer.alloc(24);
    buffer.writeUInt32LE(d, 0);
    buffer.writeUInt32LE(1, 4);
    buffer.writeUInt32LE(m, 8);
    buffer.writeUInt32LE(1, 12);
    buffer.writeUInt32LE(s, 16);
    buffer.writeUInt32LE(10000, 20);
    return { count: 3, blob: stash(buffer) };
  };

  type Entry = {
    tag: number;
    type: number;
    count: number;
    inline?: Buffer;
    blob?: { offset: number };
    long?: number;
  };
  const ifd0: Entry[] = [];
  const exif: Entry[] = [];
  const gps: Entry[] = [];

  const pushAscii = (list: Entry[], tag: number, text: string) => {
    const value = asciiValue(text);
    list.push({
      tag,
      type: 2,
      count: value.count,
      inline: value.inline ?? undefined,
      blob: value.blob ?? undefined,
    });
  };

  if (input.make) pushAscii(ifd0, 0x010f, input.make);
  if (input.model) pushAscii(ifd0, 0x0110, input.model);
  if (input.dateTimeOriginal) pushAscii(exif, 0x9003, input.dateTimeOriginal);
  if (input.offsetTimeOriginal) pushAscii(exif, 0x9011, input.offsetTimeOriginal);
  if (input.latitude !== undefined) {
    pushAscii(gps, 0x0001, input.latitude >= 0 ? "N" : "S");
    const value = dmsValue(input.latitude);
    gps.push({ tag: 0x0002, type: 5, count: value.count, blob: value.blob });
  }
  if (input.longitude !== undefined) {
    pushAscii(gps, 0x0003, input.longitude >= 0 ? "E" : "W");
    const value = dmsValue(input.longitude);
    gps.push({ tag: 0x0004, type: 5, count: value.count, blob: value.blob });
  }

  // Pointers into the sub-IFDs live in IFD0, so their sizes have to be known
  // before IFD0 itself can be written.
  const sizeOf = (entries: Entry[]) => 2 + entries.length * 12 + 4;
  const ifd0Size = 2 + (ifd0.length + (exif.length ? 1 : 0) + (gps.length ? 1 : 0)) * 12 + 4;
  const ifd0At = 8;
  const exifAt = ifd0At + ifd0Size;
  const gpsAt = exifAt + (exif.length ? sizeOf(exif) : 0);
  const blobsAt = gpsAt + (gps.length ? sizeOf(gps) : 0);

  if (exif.length) ifd0.push({ tag: 0x8769, type: 4, count: 1, long: exifAt });
  if (gps.length) ifd0.push({ tag: 0x8825, type: 4, count: 1, long: gpsAt });

  const writeIFD = (entries: Entry[]) => {
    const buffer = Buffer.alloc(sizeOf(entries));
    buffer.writeUInt16LE(entries.length, 0);
    entries.forEach((entry, index) => {
      const at = 2 + index * 12;
      buffer.writeUInt16LE(entry.tag, at);
      buffer.writeUInt16LE(entry.type, at + 2);
      buffer.writeUInt32LE(entry.count, at + 4);
      if (entry.inline) entry.inline.copy(buffer, at + 8);
      else if (entry.blob) buffer.writeUInt32LE(blobsAt + entry.blob.offset, at + 8);
      else buffer.writeUInt32LE(entry.long ?? 0, at + 8);
    });
    return buffer;
  };

  const header = Buffer.alloc(8);
  header.write("II", 0, "latin1");
  header.writeUInt16LE(42, 2);
  header.writeUInt32LE(ifd0At, 4);

  const tiff = Buffer.concat([
    header,
    writeIFD(ifd0),
    exif.length ? writeIFD(exif) : Buffer.alloc(0),
    gps.length ? writeIFD(gps) : Buffer.alloc(0),
    ...data,
  ]);

  const app1Payload = Buffer.concat([Buffer.from("Exif" + NUL + NUL, "latin1"), tiff]);
  const app1Header = Buffer.alloc(4);
  app1Header.writeUInt16BE(0xffe1, 0);
  app1Header.writeUInt16BE(app1Payload.length + 2, 2);

  // Enough of a JPEG to be walked: SOI, the APP1, then a start-of-scan and an
  // end-of-image so the segment walker terminates the way it would on a real
  // file.
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    app1Header,
    app1Payload,
    Buffer.from([0xff, 0xda, 0x00, 0x02, 0x00, 0x00, 0xff, 0xd9]),
  ]);
}

// --- The facts a claim turns on ---------------------------------------------

const complete = buildExifJpeg({
  make: "Apple",
  model: "iPhone 16 Pro",
  dateTimeOriginal: "2026:09:09 17:26:40",
  offsetTimeOriginal: "-07:00",
  latitude: 49.192139,
  longitude: -123.128917,
});

const facts = readExif(complete);
check(facts.localCaptureTime === "2026:09:09 17:26:40", "reads the capture time", String(facts.localCaptureTime));
check(facts.utcOffset === "-07:00", "reads the offset", String(facts.utcOffset));
check(facts.cameraMake === "Apple", "reads the make", String(facts.cameraMake));
check(facts.cameraModel === "iPhone 16 Pro", "reads the model", String(facts.cameraModel));
check(
  facts.latitude !== null && Math.abs(facts.latitude - 49.192139) < 0.00002,
  "reads the latitude",
  String(facts.latitude),
);
check(
  facts.longitude !== null && Math.abs(facts.longitude - -123.128917) < 0.00002,
  "reads the longitude, signed by its ref",
  String(facts.longitude),
);
check(
  facts.capturedAt?.toISOString() === "2026-09-10T00:26:40.000Z",
  "combines local time and offset into an instant",
  String(facts.capturedAt?.toISOString()),
);

// A local time with no offset names a different instant in every zone, and a
// 24-hour window is decided in hours. Guessing one would invent the fact.
check(toInstant("2026:09:09 17:26:40", null) === null, "refuses to guess an instant without an offset");

// --- What gets rejected, and what gets recorded ------------------------------

const digestOf = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

const accepted = verifyUpload({ bytes: complete, declaredSha256: digestOf(complete) });
check(accepted.ok, "a complete photo is accepted");
check(accepted.ok && accepted.result.gaps.length === 0, "a complete photo has no gaps");

const wrongDigest = verifyUpload({ bytes: complete, declaredSha256: "0".repeat(64) });
check(!wrongDigest.ok && wrongDigest.rejection.error === "DIGEST_MISMATCH", "a digest that does not match is rejected");

const notAnImage = verifyUpload({ bytes: Buffer.from("not an image") });
check(!notAnImage.ok && notAnImage.rejection.error === "NOT_A_JPEG", "a non-JPEG is rejected");

const noTime = verifyUpload({ bytes: buildExifJpeg({ make: "Apple", latitude: 49.1, longitude: -123.1 }) });
check(!noTime.ok && noTime.rejection.error === "NO_CAPTURE_TIME", "a photo with no capture time is rejected");

// The one that must NOT be rejected. Underground car parks exist, and a photo
// with no fix is still the only picture of that bumper that day. Rejecting it
// destroys evidence we have in exchange for evidence we cannot get.
const noFix = verifyUpload({
  bytes: buildExifJpeg({
    make: "Apple",
    dateTimeOriginal: "2026:09:09 17:26:40",
    offsetTimeOriginal: "-07:00",
  }),
});
check(noFix.ok, "a photo with no location is accepted, not rejected");
check(noFix.ok && noFix.result.gaps.includes("noLocation"), "...but the gap is recorded");

// --- The phone's clock is not evidence on its own ----------------------------

const now = new Date("2026-09-10T00:30:00Z");
const honest = verifyUpload({
  bytes: complete,
  deviceClockAt: new Date("2026-09-10T00:30:04Z"),
  receivedAt: now,
});
check(honest.ok && honest.result.clockSkewSeconds === 4, "records a few seconds of ordinary drift");
check(honest.ok && !clockIsSuspect(honest.result.clockSkewSeconds), "...and does not flag it");

const wound = verifyUpload({
  bytes: complete,
  deviceClockAt: new Date("2026-09-10T02:30:00Z"),
  receivedAt: now,
});
check(wound.ok && clockIsSuspect(wound.result.clockSkewSeconds), "flags a phone clock two hours out");

// --- Structural traps --------------------------------------------------------

// The bytes spelling "Exif" can occur inside compressed image data. A reader
// that searches for them rather than walking the segments would parse noise as
// a TIFF header and report confident nonsense.
const decoy = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]),
  Buffer.from([0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]),
  Buffer.from([0xff, 0xd9]),
]);
check(readExif(decoy).localCaptureTime === null, "does not mistake image data containing 'Exif' for metadata");

// --- The deadline a claim is decided by --------------------------------------
//
// Turo counts its window in hours from the start and the end of a trip. Past
// it, photographs are not late, they are worthless -- so "expired" has to be a
// state the review page can show, not a row it quietly drops.

const tripEnd = new Date("2026-09-10T12:00:00Z");
const hoursAfter = (hours: number) => new Date(tripEnd.getTime() + hours * 3600_000);

check(dueState(tripEnd, hoursAfter(-3)).state === "upcoming", "a trip that has not ended yet is upcoming");
check(dueState(tripEnd, hoursAfter(1)).state === "due", "an hour after the trip, photos are due");
check(
  dueState(tripEnd, hoursAfter(CLAIM_WINDOW_HOURS - 0.5)).state === "due",
  "half an hour before the deadline, still due",
);
check(
  dueState(tripEnd, hoursAfter(CLAIM_WINDOW_HOURS + 0.5)).state === "expired",
  "half an hour after the deadline, expired",
);
check(
  Math.abs(dueState(tripEnd, hoursAfter(4)).hoursLeft - (CLAIM_WINDOW_HOURS - 4)) < 0.001,
  "counts the hours left against the deadline, not against the trip",
);
check(
  dueState(tripEnd, hoursAfter(CLAIM_WINDOW_HOURS + 6)).hoursLeft < 0,
  "hours left goes negative once the window has closed",
);

// --- Optionally, a real photograph -------------------------------------------

const realPath = process.argv[2];
if (realPath) {
  const bytes = readFileSync(realPath);
  const real = readExif(bytes);
  console.log("");
  console.log(`Real file: ${realPath}`);
  console.log(`  capture   ${real.localCaptureTime ?? "-"} ${real.utcOffset ?? ""}`);
  console.log(`  location  ${real.latitude ?? "-"}, ${real.longitude ?? "-"}`);
  console.log(`  camera    ${real.cameraMake ?? "-"} ${real.cameraModel ?? "-"}`);
  console.log(`  software  ${real.software ?? "-"}`);
  console.log(`  sha256    ${digestOf(bytes)}`);
  check(real.localCaptureTime !== null, "real file has a capture time");
  check(real.utcOffset !== null, "real file has an offset");
  check(real.latitude !== null && real.longitude !== null, "real file has a location");
}

console.log("");
console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
