// Encode/decode throughput on a representative document (run `npm run build` first).
//
//   node bench/perf.mjs
import { performance } from "node:perf_hooks";
import { decode, encode, extract, gzipCodec, storeCodec, toBase64 } from "../dist/index.js";
import { makePng } from "../examples/png.mjs";

// A realistic-ish doc: a chunk of markup/CSS + one larger image.
const png = await makePng(900, 600, (x, y) => [(x * 211) & 255, (y * 97) & 255, ((x ^ y) * 53) & 255, 255]); // noisy ~ photo-like
const css = "<style>" + ".card{transform:matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)}".repeat(40) + "</style>";
const markup = `${css}<main class="card"><h1>HMML benchmark</h1><img src="data:image/png;base64,${toBase64(png)}"></main>`;

const { html, resources } = extract(markup);
const input = { html, resources, meta: { title: "bench" } };
const inputBytes = resources.reduce((s, r) => s + r.data.length, 0) + new TextEncoder().encode(html).length;

const fileGzip = await encode(input, { codec: gzipCodec });
const fileStore = await encode(input, { codec: storeCodec });

async function timed(fn, iters) {
  for (let i = 0; i < 5; i++) await fn(); // warmup
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) await fn();
  return (performance.now() - t0) / iters; // ms/op
}

const mbps = (ms) => (inputBytes / 1e6 / (ms / 1000)).toFixed(0);
const kb = (n) => (n / 1024).toFixed(1) + " KB";

const encG = await timed(() => encode(input, { codec: gzipCodec }), 60);
const decG = await timed(() => decode(fileGzip), 60);
const encS = await timed(() => encode(input, { codec: storeCodec }), 200);
const decS = await timed(() => decode(fileStore), 200);

const base64Html = `<!doctype html><html><body>${markup}</body></html>`;
const base64Bytes = Buffer.byteLength(base64Html, "utf8");

console.log(`\nDocument: ${kb(inputBytes)} input (1 image ${kb(png.length)} + ${kb(new TextEncoder().encode(html).length)} markup)\n`);
console.log(`  self-contained base64 HTML : ${kb(base64Bytes)}`);
console.log(`  HMML (gzip)                : ${kb(fileGzip.length)}   (${(100 * (1 - fileGzip.length / base64Bytes)).toFixed(1)}% smaller)`);
console.log(`  HMML (store)               : ${kb(fileStore.length)}\n`);
console.log(`  operation        ms/op     throughput`);
console.log(`  --------------   -------   ----------`);
console.log(`  encode (gzip)    ${encG.toFixed(3).padStart(7)}   ${mbps(encG).padStart(5)} MB/s`);
console.log(`  decode (gzip)    ${decG.toFixed(3).padStart(7)}   ${mbps(decG).padStart(5)} MB/s`);
console.log(`  encode (store)   ${encS.toFixed(3).padStart(7)}   ${mbps(encS).padStart(5)} MB/s`);
console.log(`  decode (store)   ${decS.toFixed(3).padStart(7)}   ${mbps(decS).padStart(5)} MB/s\n`);
console.log(`  (Node ${process.version}, single-threaded)`);
