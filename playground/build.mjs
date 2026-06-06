// Generates a folder of real, pokeable artifacts:
//   playground/files/<name>.hmml   the binary HMML document
//   playground/files/<name>.html   the same thing as a standalone, double-clickable HTML page
//   playground/files/manifest.json index used by playground/index.html
//
// Source images live in playground/assets/ - drop your own png/jpg/webp/gif/svg
// in there and re-run `npm run pg:build`. If the folder is empty it is seeded
// with a few generated samples.
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decode, encode, extract, gzipCodec, sniffMime, toBase64 } from "../dist/index.js";
import { makePng } from "../examples/png.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const assetsDir = join(here, "assets");
const filesDir = join(here, "files");

const MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

const CSS = `
  *{box-sizing:border-box}
  body{margin:0;background:#0b1020;color:#e7ecf5;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  .wrap{display:grid;place-items:center;min-height:100vh;padding:48px;perspective:1000px}
  .card{background:linear-gradient(150deg,#20305c,#1b2340);border:1px solid #2d3a63;border-radius:20px;
        padding:18px;max-width:380px;box-shadow:0 36px 70px -24px rgba(0,0,0,.65);
        transform:rotateY(-16deg) rotateX(7deg);transform-style:preserve-3d}
  .frame{border-radius:12px;overflow:hidden;transform:translateZ(46px);box-shadow:0 18px 34px -12px rgba(0,0,0,.7)}
  .card img{display:block;width:100%;height:auto}
  .card h2{margin:18px 0 4px;font-size:18px;transform:translateZ(24px)}
  .card p{margin:0;color:#9fb4ff;font-size:13px;transform:translateZ(16px)}
  .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:16px;max-width:600px}
  .grid figure{margin:0;background:#131a30;border:1px solid #243155;border-radius:16px;overflow:hidden}
  .grid img{display:block;width:100%;height:auto}
  .grid figcaption{padding:9px 13px;font-size:12px;color:#9fb4ff}
`;

function fullPage(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} - HMML</title>
</head>
<body>${body}</body>
</html>
`;
}

async function ensureDir(d) {
  await mkdir(d, { recursive: true });
}

async function listImages(dir) {
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  return names.filter((n) => MIME[extname(n).toLowerCase()]).sort();
}

async function seedAssets() {
  await writeFile(join(assetsDir, "gradient.png"), await makePng(300, 190));
  await writeFile(
    join(assetsDir, "rings.png"),
    await makePng(240, 240, (x, y) => {
      const dx = x - 120,
        dy = y - 120,
        r = Math.sqrt(dx * dx + dy * dy);
      const t = (Math.sin(r / 7) + 1) / 2;
      return [40 + t * 200, 70 + (1 - t) * 150, 200, 255];
    }),
  );
  await writeFile(
    join(assetsDir, "checker.png"),
    await makePng(220, 220, (x, y) => {
      const c = ((x >> 4) + (y >> 4)) & 1;
      return c ? [33, 40, 64, 255] : [124, 92, 255, 255];
    }),
  );
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="170" viewBox="0 0 240 170">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#7c5cff"/><stop offset="1" stop-color="#21d4fd"/></linearGradient></defs>
  <rect width="240" height="170" rx="20" fill="url(#g)"/>
  <circle cx="78" cy="82" r="40" fill="#fff" opacity="0.9"/>
  <text x="120" y="150" font-family="sans-serif" font-size="19" fill="#fff" text-anchor="middle">SVG inside HMML</text>
</svg>`;
  await writeFile(join(assetsDir, "logo.svg"), svg, "utf8");
}

async function buildOne(name, mime, bytes) {
  const dataUri = `data:${mime};base64,${toBase64(bytes)}`;
  const markup =
    `<style>${CSS}</style>` +
    `<main class="wrap"><article class="card">` +
    `<div class="frame"><img src="${dataUri}" alt="${name}"></div>` +
    `<h2>${name}</h2><p>${mime} - stored raw, packed in one .hmml</p>` +
    `</article></main>`;

  const { html, resources } = extract(markup);
  const file = await encode({ html, resources, meta: { title: name, source: `${name}${extOf(mime)}` } }, { codec: gzipCodec, crc: true });
  await writeFile(join(filesDir, `${name}.hmml`), file);

  // Round-trip → standalone HTML (so you can double-click it too).
  const doc = await decode(file);
  await writeFile(join(filesDir, `${name}.html`), fullPage(name, doc.toHTML()), "utf8");

  const inlined = Buffer.byteLength(fullPage(name, markup), "utf8");
  return record(name, mime, bytes.length, file.length, inlined, resources.length);
}

async function buildGallery(images) {
  const figs = images
    .map((im) => `<figure><img src="data:${im.mime};base64,${toBase64(im.bytes)}" alt="${im.name}"><figcaption>${im.name} · ${im.mime}</figcaption></figure>`)
    .join("");
  const markup = `<style>${CSS}</style><main class="wrap"><section class="grid">${figs}</section></main>`;
  const { html, resources } = extract(markup);
  const file = await encode({ html, resources, meta: { title: "gallery", count: images.length } }, { codec: gzipCodec, crc: true });
  await writeFile(join(filesDir, `gallery.hmml`), file);
  const doc = await decode(file);
  await writeFile(join(filesDir, `gallery.html`), fullPage("gallery", doc.toHTML()), "utf8");
  const inlined = Buffer.byteLength(fullPage("gallery", markup), "utf8");
  return record("gallery", "multi", images.reduce((s, i) => s + i.bytes.length, 0), file.length, inlined, resources.length);
}

function extOf(mime) {
  const hit = Object.entries(MIME).find(([, m]) => m === mime);
  return hit ? hit[0] : "";
}

function record(name, mime, raw, hmml, inlinedHtml, resources) {
  return {
    name,
    mime,
    resources,
    rawBytes: raw,
    hmmlBytes: hmml,
    inlinedHtmlBytes: inlinedHtml,
    savingsPct: Number((100 * (1 - hmml / inlinedHtml)).toFixed(1)),
    hmml: `files/${name}.hmml`,
    html: `files/${name}.html`,
  };
}

async function main() {
  await ensureDir(assetsDir);
  await ensureDir(filesDir);

  let names = await listImages(assetsDir);
  if (names.length === 0) {
    console.log("assets/ empty - seeding sample images");
    await seedAssets();
    names = await listImages(assetsDir);
  }

  const loaded = [];
  for (const n of names) {
    const bytes = new Uint8Array(await readFile(join(assetsDir, n)));
    const mime = MIME[extname(n).toLowerCase()] || sniffMime(bytes) || "application/octet-stream";
    loaded.push({ name: basename(n, extname(n)), mime, bytes });
  }

  const stats = [];
  for (const it of loaded) stats.push(await buildOne(it.name, it.mime, it.bytes));
  stats.push(await buildGallery(loaded));

  await writeFile(join(filesDir, "manifest.json"), JSON.stringify({ files: stats }, null, 2), "utf8");

  console.log(`\nGenerated ${stats.length} HMML docs in playground/files/\n`);
  for (const s of stats) {
    console.log(
      `  ${s.name.padEnd(12)} ${String(s.hmmlBytes).padStart(7)} B  vs  ${String(s.inlinedHtmlBytes).padStart(7)} B html   (${s.savingsPct}% smaller)`,
    );
  }
  console.log(`\nOpen playground/index.html via 'npm run playground', or drop a .hmml onto playground/viewer.html.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
