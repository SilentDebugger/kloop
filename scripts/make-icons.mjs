/**
 * Generates the PWA icons (green ring on cream) as PNGs with zero deps.
 * Usage: node scripts/make-icons.mjs
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

function makePng(size) {
  const cx = size / 2;
  const rOuter = size * 0.32;
  const rInner = size * 0.19;
  // raw RGB rows, each prefixed with filter byte 0
  const raw = Buffer.alloc(size * (size * 3 + 1));
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0;
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - cx + 0.5, y - cx + 0.5);
      // antialias with a 1px soft edge
      const t = (edge0, edge1) => Math.min(1, Math.max(0, (d - edge0) / (edge1 - edge0)));
      const ring = (1 - t(rOuter - 0.8, rOuter + 0.8)) * t(rInner - 0.8, rInner + 0.8);
      for (let ch = 0; ch < 3; ch++) raw[o++] = Math.round(BG[ch] + (GREEN[ch] - BG[ch]) * ring);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(join(root, "apps/web/public"), { recursive: true });
for (const size of [192, 512]) {
  const file = join(root, `apps/web/public/icon-${size}.png`);
  writeFileSync(file, makePng(size));
  console.log("wrote", file);
}
