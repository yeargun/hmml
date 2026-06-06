// Browser demo: generate an image, pack HTML+image into HMML, read it back, and
// render it - entirely client-side. Also publishes results on
// `window.__hmmlDemo` so the Playwright test can assert against them.
import { decode, encode, extract, gzipCodec, toBase64 } from "/dist/index.js";
import { makePng } from "/examples/png.mjs";

const IMG_W = 160;
const IMG_H = 120;

function bytes(n) {
  return n.toLocaleString() + " B";
}

async function run() {
  const stats = document.getElementById("stats");
  const stage = document.getElementById("stage");

  // 1. A real PNG (gradient), inlined into HTML as a data URI.
  const png = await makePng(IMG_W, IMG_H);
  const dataUri = `data:image/png;base64,${toBase64(png)}`;
  const original =
    `<div class="card">` +
    `<img src="${dataUri}" width="${IMG_W}" height="${IMG_H}" alt="gradient">` +
    `<p>Rendered from an HMML document decoded in this browser.</p>` +
    `</div>`;

  // 2. Lift the image out, encode (markup gzipped, image stored raw).
  const { html, resources } = extract(original);
  const file = await encode({ html, resources, meta: { title: "browser demo" } }, { codec: gzipCodec });

  // 3. Decode and render via object URLs.
  const doc = await decode(file);
  const { html: rendered } = doc.createObjectUrls();
  stage.innerHTML = rendered;

  // Report.
  const selfContained = new TextEncoder().encode(original).length;
  const roundTrip = doc.toHTML() === original;
  const savings = (100 * (1 - file.length / selfContained)).toFixed(1);

  window.__hmmlDemo = {
    ready: true,
    fileSize: file.length,
    selfContained,
    savings: Number(savings),
    resources: resources.length,
    roundTrip,
    imgW: IMG_W,
    imgH: IMG_H,
  };

  stats.innerHTML =
    `<b>round-trip exact</b><span class="${roundTrip ? "ok" : ""}">${roundTrip ? "YES" : "NO"}</span>` +
    `<b>resources</b><span>${resources.length} (stored raw)</span>` +
    `<b>self-contained HTML</b><span>${bytes(selfContained)}</span>` +
    `<b>HMML file</b><span>${bytes(file.length)}</span>` +
    `<b>savings</b><span class="ok">${savings}%</span>` +
    `<b>codec</b><span>gzip (id ${doc.codecId})</span>`;
}

run().catch((err) => {
  document.getElementById("stats").textContent = "ERROR: " + (err?.stack || err);
  window.__hmmlDemo = { ready: true, error: String(err?.message || err) };
});
