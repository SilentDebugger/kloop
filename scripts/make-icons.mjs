/**
 * Generates all app icons (the kloop ring — green on cream) as PNGs with zero deps.
 *
 *   node scripts/make-icons.mjs
 *
 * Outputs:
 *   apps/web/public/icon-{192,512}.png       PWA icons
 *   apps/mobile/assets/icon.png              iOS app icon (1024, opaque — iOS forbids alpha)
 *   apps/mobile/assets/favicon.png           Expo web favicon
 *   apps/mobile/assets/splash-icon.png       splash logo (transparent; cream comes from app.json)
 *   apps/mobile/assets/android-icon-*.png    adaptive icon layers (foreground/background/monochrome)
 *
 * After changing these, `npx expo prebuild` (or a fresh EAS build) picks them up
 * for the native projects.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const BG = [0xf4, 0xf2, 0xec];
const GREEN = [0x2e, 0x7d, 0x5b];

function crc32(buf) {
  let c,
    crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/**
 * Draw the ring (outer r = 0.32·size, inner r = 0.19·size, both × scale).
 *  - transparent: RGBA on transparent background (adaptive-icon layers, splash)
 *  - otherwise:   RGB ring blended onto cream
 *  - scale 0:     solid background, no ring
 */
function makePng(size, { scale = 1, transparent = false, color = GREEN } = {}) {
  const cx = size / 2;
  const rOuter = size * 0.32 * scale;
  const rInner = size * 0.19 * scale;
  const channels = transparent ? 4 : 3;
  // raw rows, each prefixed with filter byte 0
  const raw = Buffer.alloc(size * (size * channels + 1));
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0;
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - cx + 0.5, y - cx + 0.5);
      // antialias with a 1px soft edge
      const t = (edge0, edge1) => Math.min(1, Math.max(0, (d - edge0) / (edge1 - edge0)));
      const ring = scale === 0 ? 0 : (1 - t(rOuter - 0.8, rOuter + 0.8)) * t(rInner - 0.8, rInner + 0.8);
      if (transparent) {
        for (let ch = 0; ch < 3; ch++) raw[o++] = color[ch];
        raw[o++] = Math.round(ring * 255);
      } else {
        for (let ch = 0; ch < 3; ch++) raw[o++] = Math.round(BG[ch] + (color[ch] - BG[ch]) * ring);
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = transparent ? 6 : 2; // color type: RGBA / RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function write(rel, buf) {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, buf);
  console.log("wrote", file);
}

// web PWA
for (const size of [192, 512]) write(`apps/web/public/icon-${size}.png`, makePng(size));

// mobile (Expo)
write("apps/mobile/assets/icon.png", makePng(1024));
write("apps/mobile/assets/favicon.png", makePng(48));
// splash: transparent logo, backgroundColor in app.json supplies the cream.
// Rendered small-ish — `resizeMode: contain` fits the square to screen width.
write("apps/mobile/assets/splash-icon.png", makePng(1024, { scale: 0.6, transparent: true }));
// adaptive icon: keep the ring inside the 66/108dp safe zone (r ≤ 0.306·size)
write("apps/mobile/assets/android-icon-foreground.png", makePng(512, { scale: 0.8, transparent: true }));
write("apps/mobile/assets/android-icon-background.png", makePng(512, { scale: 0 }));
// monochrome layer: launcher reads the alpha channel only
write("apps/mobile/assets/android-icon-monochrome.png", makePng(432, { scale: 0.8, transparent: true, color: [255, 255, 255] }));
