import { performance } from 'node:perf_hooks';
import { encode } from '../dist/encode.js';
import { encodeStream } from '../dist/encode-stream.js';
import { decodeStream } from '../dist/decode-stream.js';

// Reuses a 64 KiB source buffer to model a large already-encoded asset.
const size = Number(process.env.HMML_BENCH_BYTES ?? 64 * 1024 * 1024);
const fragment = new Uint8Array(64 * 1024).fill(123);
async function* media() { for (let n = 0; n < size; n += fragment.length) yield fragment.subarray(0, Math.min(fragment.length, size - n)); }
let bytesPulled = 0;
async function* source() {
  for await (const bytes of encodeStream({
    html: '<h1>Blueprint</h1><video src="hmml:movie"></video>',
    resources: [{ id: 'movie', mime: 'video/mp4', byteLength: size, data: media() }],
  })) { bytesPulled += bytes.length; yield bytes; }
}
const t0 = performance.now();
let count = 0, largest = 0;
for await (const event of decodeStream(source())) {
  if (event.type === 'markup') console.log(`Blueprint: ${(performance.now() - t0).toFixed(3)} ms, ${bytesPulled} bytes pulled (media not read yet).`);
  if (event.type === 'resource-data') { count += event.data.length; largest = Math.max(largest, event.data.length); }
}
console.log(`Streamed ${count} media bytes in ${(performance.now() - t0).toFixed(2)} ms; largest event ${largest} B.`);
// In-memory baseline throughput lives in bench/perf.mjs.
console.log(`Peak process RSS: ${(process.resourceUsage().maxRSS / 1024).toFixed(1)} MiB (includes runtime).`);
console.log(`Empty container overhead: ${(await encode({ html: '' })).length} B. Node ${process.version}.`);
