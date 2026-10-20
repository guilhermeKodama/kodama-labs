#!/usr/bin/env node
/**
 * Rasterize public/icon.svg into the Capital PWA and favicon files.
 *
 * Not a runtime dependency. Install the rasterizer, then run from apps/capital:
 *
 *   npm install --no-save --no-package-lock @resvg/resvg-js
 *   node scripts/generate-app-icon.mjs
 *
 * Writes:
 *   public/icon-192.png            purpose "any"
 *   public/icon-512.png            purpose "any"
 *   public/icon-maskable-512.png   coin inside the 80% maskable safe zone, full-bleed #0a0a0a
 *   public/favicon-32.png
 *   public/apple-touch-icon.png    180
 *   src/app/favicon.ico            16 and 32
 *
 * The maskable file is the same artwork, zoomed so the coin's outer edge
 * sits at 76% of the canvas (inside the 80% safe-zone circle) on a
 * full-bleed black field. Bump the ?v= query in the manifest, the service
 * worker, and the metadata icons when this artwork changes.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const masterPath = path.join(appDir, "public/icon.svg");

const BLACK = { r: 0x0a, g: 0x0a, b: 0x0a };
// Coin outer diameter in the 1024 master. Maskable art stays inside the
// central 80% circle; 76% leaves a margin for the mask antialiasing.
const COIN_DIAMETER = 600;
const MASKABLE_COIN_FRACTION = 0.76;
const SAFE_ZONE = 0.8;

let Resvg;
try {
  ({ Resvg } = require("@resvg/resvg-js"));
} catch {
  console.error(
    "\n@resvg/resvg-js is not installed.\n" +
      "From apps/capital: npm install --no-save --no-package-lock @resvg/resvg-js\n",
  );
  process.exit(1);
}

const master = fs.readFileSync(masterPath, "utf8");

function render(svg, size) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: size },
    shapeRendering: 2,
    font: { loadSystemFonts: false },
    background: "#0a0a0a",
  });
  const image = resvg.render();
  if (image.width !== size || image.height !== size) {
    throw new Error(`expected ${size}px, got ${image.width}x${image.height}`);
  }
  return image;
}

function pixel(image, x, y) {
  const i = (y * image.width + x) * 4;
  const p = image.pixels;
  return { r: p[i], g: p[i + 1], b: p[i + 2], a: p[i + 3] };
}

function assertFullBleedBlack(image, label) {
  const corners = [
    [0, 0],
    [image.width - 1, 0],
    [0, image.height - 1],
    [image.width - 1, image.height - 1],
  ];
  for (const [x, y] of corners) {
    const p = pixel(image, x, y);
    if (p.r !== BLACK.r || p.g !== BLACK.g || p.b !== BLACK.b || p.a !== 255) {
      throw new Error(`${label} corner ${x},${y} is ${JSON.stringify(p)}, expected opaque #0a0a0a`);
    }
  }
}

function assertHasMark(image, label) {
  let white = 0;
  const p = image.pixels;
  for (let i = 0; i < p.length; i += 4) {
    // 16px antialiases the rings under a hard 200 cutoff; 128 still
    // rejects an empty or near-black render.
    if (p[i] > 128 && p[i + 3] === 255) white++;
  }
  if (white < image.width) throw new Error(`${label} has almost no white pixels (${white})`);
}

function assertInsideSafeZone(image, label) {
  const cx = (image.width - 1) / 2;
  const cy = (image.height - 1) / 2;
  const limit = (image.width * SAFE_ZONE) / 2;
  let max = 0;
  const p = image.pixels;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const i = (y * image.width + x) * 4;
      if (p[i] > 200) {
        const d = Math.hypot(x - cx, y - cy);
        if (d > max) max = d;
      }
    }
  }
  if (max > limit + 0.5) {
    throw new Error(`${label} white pixel at radius ${max.toFixed(1)} exceeds safe zone ${limit.toFixed(1)}`);
  }
  if (max < limit * 0.85) {
    throw new Error(`${label} coin radius ${max.toFixed(1)} does not fill the safe zone (limit ${limit.toFixed(1)})`);
  }
}

function maskableSvg() {
  const view = COIN_DIAMETER / MASKABLE_COIN_FRACTION;
  const origin = (1024 - view) / 2;
  const box = `${origin.toFixed(3)} ${origin.toFixed(3)} ${view.toFixed(3)} ${view.toFixed(3)}`;
  const next = master.replace(/viewBox="[^"]+"/, `viewBox="${box}"`);
  if (next === master) throw new Error("master SVG has no viewBox to zoom for the maskable icon");
  return next;
}

function writePng(file, image) {
  fs.writeFileSync(path.join(appDir, file), image.asPng());
}

function ico(images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  for (let i = 0; i < count; i++) {
    const { png, size } = images[i];
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o);
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += png.length;
  }
  return Buffer.concat([header, dir, ...images.map((image) => image.png)]);
}

const any192 = render(master, 192);
const any512 = render(master, 512);
const maskable = render(maskableSvg(), 512);
const apple = render(master, 180);
const fav32 = render(master, 32);
const fav16 = render(master, 16);

for (const [label, image] of [
  ["icon-192", any192],
  ["icon-512", any512],
  ["maskable-512", maskable],
  ["apple-touch-icon", apple],
  ["favicon-32", fav32],
  ["favicon-16", fav16],
]) {
  assertFullBleedBlack(image, label);
  assertHasMark(image, label);
}
assertInsideSafeZone(maskable, "maskable-512");

writePng("public/icon-192.png", any192);
writePng("public/icon-512.png", any512);
writePng("public/icon-maskable-512.png", maskable);
writePng("public/apple-touch-icon.png", apple);
writePng("public/favicon-32.png", fav32);
fs.writeFileSync(
  path.join(appDir, "src/app/favicon.ico"),
  ico([
    { png: fav16.asPng(), size: 16 },
    { png: fav32.asPng(), size: 32 },
  ]),
);

console.log("wrote icon-192, icon-512, icon-maskable-512, apple-touch-icon, favicon-32, favicon.ico");
