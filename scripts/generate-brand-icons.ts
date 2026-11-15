/**
 * Re-draws every committed PNG of the TATO mark from `lib/brand-mark.ts`:
 * the Android TWA launcher icons, the Expo staff app's assets, Walkaround's
 * app icon and the WeChat mini program's mark. The web
 * icons need nothing -- they are drawn on request.
 *
 *   npx tsx scripts/generate-brand-icons.ts
 *
 * Run it after changing the mark, then rebuild the APK
 * (`scripts/build-android-apk.sh`): the launcher icon is baked into the
 * binary, so a new mark reaches installed phones only with a new APK.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";

import { BRAND, brandMarkSvg } from "../lib/brand-mark";

const root = path.resolve(__dirname, "..");

type Job = {
  file: string;
  size: number;
  svg: string;
  /** iOS rejects an app icon with an alpha channel. */
  opaque?: boolean;
};

const ANDROID_RES = "android/app/src/main/res";
const DENSITIES: Array<[string, number]> = [
  ["mdpi", 1],
  ["hdpi", 1.5],
  ["xhdpi", 2],
  ["xxhdpi", 3],
  ["xxxhdpi", 4],
];

const jobs: Job[] = [];

for (const [density, k] of DENSITIES) {
  // Legacy launcher icon (pre-Android 8): 48dp, our own rounded tile.
  jobs.push({
    file: `${ANDROID_RES}/mipmap-${density}/ic_launcher.png`,
    size: Math.round(48 * k),
    svg: brandMarkSvg({ variant: "word", radius: BRAND.tileRadius }),
  });
  // Adaptive-icon background (mipmap-anydpi-v26/ic_launcher.xml): the
  // launcher masks it and shows only the middle ~61%, so the word is
  // shrunk to stay inside that circle. Same pixel sizes as before.
  jobs.push({
    file: `${ANDROID_RES}/mipmap-${density}/ic_maskable.png`,
    size: Math.round(82 * k),
    svg: brandMarkSvg({ variant: "word", scale: 0.8 }),
  });
}

const STAFF = "staff-ios-app/assets";
jobs.push(
  // iOS app icon: square, opaque; iOS rounds it.
  { file: `${STAFF}/icon.png`, size: 1024, svg: brandMarkSvg({ variant: "word" }), opaque: true },
  // Expo adaptive icon, as layers.
  { file: `${STAFF}/android-icon-background.png`, size: 512, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="${BRAND.ink}"/></svg>` },
  { file: `${STAFF}/android-icon-foreground.png`, size: 512, svg: brandMarkSvg({ variant: "word", tile: false, scale: 0.8 }) },
  { file: `${STAFF}/android-icon-monochrome.png`, size: 432, svg: brandMarkSvg({ variant: "word", tile: false, scale: 0.8, mono: "#ffffff" }) },
  { file: `${STAFF}/splash-icon.png`, size: 1024, svg: brandMarkSvg({ variant: "word", tile: false }) },
  // Browser tab of the Expo web build: the one-letter form.
  { file: `${STAFF}/favicon.png`, size: 48, svg: brandMarkSvg({ variant: "t", radius: BRAND.tileRadius }) },
);

// Other domains' copies, so one run updates every logo. The files belong
// to their sessions (Walkaround, sync); this script only redraws them.
jobs.push(
  // Walkaround's iOS app icon: like the staff app's, opaque 1024.
  {
    file: "inspection-ios-app/Sources/Assets.xcassets/AppIcon.appiconset/icon-1024.png",
    size: 1024,
    svg: brandMarkSvg({ variant: "word" }),
    opaque: true,
  },
  // The WeChat mini program's sign-in and binding pages (it cannot import TS).
  { file: "wechat-miniprogram/images/brand-mark.png", size: 264, svg: brandMarkSvg({ variant: "t", radius: BRAND.tileRadius }) },
);

async function main() {
  for (const job of jobs) {
    const out = path.join(root, job.file);
    mkdirSync(path.dirname(out), { recursive: true });
    let img = sharp(Buffer.from(job.svg), { density: 72 * (job.size / BRAND.box) * 4 }).resize(job.size, job.size);
    if (job.opaque) img = img.flatten({ background: BRAND.ink }).removeAlpha();
    await img.png().toFile(out);
    console.log(`${job.file}  ${job.size}px`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
