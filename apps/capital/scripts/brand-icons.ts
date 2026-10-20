/**
 * Writes every icon file of the app from the mark in src/lib/brand.ts:
 *
 *   src/app/icon.svg                     browser tab (Next file convention)
 *   src/app/favicon.ico                  16, 32 and 48 px, for agents that ignore SVG
 *   public/icons/cerne-apple-180.png     home screen on iOS, full bleed (iOS rounds it)
 *   public/icons/cerne-192.png           manifest, rounded square
 *   public/icons/cerne-512.png           manifest, rounded square
 *   public/icons/cerne-maskable-512.png  manifest "maskable": full bleed, mark in the safe zone
 *   public/icons/cerne-badge-96.png      notification badge: white mark on transparent
 *
 *   pnpm exec tsx scripts/brand-icons.ts
 *
 * New artwork gets new file names (ICONS in src/lib/brand.ts): launchers,
 * the browser and Cloudflare cache an icon by its URL, and a query string
 * does not always get past them. sharp is taken from Next (its optional
 * dependency, already installed) so the app does not carry a dependency
 * used only here.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { APP_ICON, ICONS, MARK_FULL, MARK_SIMPLE, MARK_TINY, markSvg, type MarkShape } from "../src/lib/brand";

const require = createRequire(import.meta.url);
/** The part of sharp used here (SVG in, PNG out). */
type Sharp = (input: Buffer) => { png(): { toBuffer(): Promise<Buffer> } };
const sharp: Sharp = require(createRequire(require.resolve("next/package.json")).resolve("sharp"));

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

/** The app icon (heartwood square, sapwood rings, resin core) as a PNG. */
async function appIcon(size: number, shape: MarkShape, opts: { radius: number; scale: number }): Promise<Buffer> {
  const svg = markSvg({ shape, ...APP_ICON, radius: opts.radius, scale: opts.scale, size });
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** PNG images packed into a .ico (PNG entries, read by every current browser). */
function ico(images: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)]);
}

function write(relative: string, data: Buffer | string) {
  const file = path.join(APP, relative);
  fs.writeFileSync(file, data);
  console.log(`wrote ${relative} (${Buffer.byteLength(data)} bytes)`);
}

async function main() {
  write("src/app/icon.svg", `${markSvg({ shape: MARK_SIMPLE, ...APP_ICON, radius: 14, scale: 0.75, size: 32 })}\n`);

  write(
    "src/app/favicon.ico",
    ico([
      { size: 16, png: await appIcon(16, MARK_TINY, { radius: 12, scale: 0.8 }) },
      { size: 32, png: await appIcon(32, MARK_SIMPLE, { radius: 14, scale: 0.78 }) },
      { size: 48, png: await appIcon(48, MARK_SIMPLE, { radius: 14, scale: 0.78 }) },
    ]),
  );

  write(`public${ICONS.apple}`, await appIcon(180, MARK_FULL, { radius: 0, scale: 0.72 }));
  write(`public${ICONS.app192}`, await appIcon(192, MARK_FULL, { radius: 14, scale: 0.75 }));
  write(`public${ICONS.app512}`, await appIcon(512, MARK_FULL, { radius: 14, scale: 0.75 }));
  // Maskable: the launcher crops to its own shape inside the central 80%
  // circle, so the mark spans 60% of a full-bleed square.
  write(`public${ICONS.maskable512}`, await appIcon(512, MARK_FULL, { radius: 0, scale: 0.6 }));

  const badge = markSvg({ shape: MARK_SIMPLE, rings: "#fff", core: "#fff", scale: 0.9, size: 96 });
  write(`public${ICONS.badge}`, await sharp(Buffer.from(badge)).png().toBuffer());
}

void main();
