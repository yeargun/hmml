// Cold startup, warm reuse, per-call workers, and UI timer delay. No network/media decode.
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';
const port = 5289;
const server = spawn(process.execPath, ['e2e/server.mjs'], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit'] });
const ready = new Promise((resolve, reject) => {
  server.stdout.on('data', bytes => { if (String(bytes).includes('static server:')) resolve(); });
  server.once('exit', code => reject(new Error(`server exited: ${code}`)));
});
let browser;
try {
  await ready;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/examples/stream/index.html`);
  const result = await page.evaluate(async () => {
    const { encode } = await import('/dist/encode.js');
    const { createDecoder } = await import('/dist/decoder.js');
    const { decode: direct } = await import('/dist/decode-direct.js');
    const input = n => ({ html: '<p>Attachment</p>', resources: [{ id: 'x', mime: 'application/octet-stream', data: new Uint8Array(n).fill(31) }] });
    const small = await encode(input(8192));
    const medium = await encode(input(1024 * 1024));
    const large = await encode(input(8 * 1024 * 1024), { crc: true });
    let starts = 0;
    const factory = () => { starts++; return new Worker('/dist/decode-worker.js', { type: 'module' }); };
    const shared = createDecoder({ worker: true, workerFactory: factory });
    const duration = async fn => { const t = performance.now(); await fn(); return performance.now() - t; };
    const summarize = values => {
      const sorted = values.slice().sort((a, b) => a - b);
      return { medianMs: +sorted[Math.floor(sorted.length / 2)].toFixed(3), p95Ms: +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))].toFixed(3) };
    };
    const measure = async (fn, n = 30) => { const values = []; for (let i = 0; i < n; i++) values.push(await duration(fn)); return summarize(values); };
    try {
      const coldMs = await duration(() => shared.decode(small));
      const rows = {};
      rows['8 KiB direct'] = await measure(() => direct(small));
      rows['8 KiB shared worker, preserve input'] = await measure(() => shared.decode(small));
      rows['8 KiB fresh worker per decode'] = await measure(async () => {
        const decoder = createDecoder({ worker: true, workerFactory: factory });
        try { await decoder.decode(small); } finally { decoder.dispose(); }
      }, 10);
      rows['1 MiB direct'] = await measure(() => direct(medium));
      rows['1 MiB shared worker, preserve input'] = await measure(() => shared.decode(medium));
      const countBefore = starts;
      const batchMs = await duration(() => Promise.all(Array.from({ length: 100 }, () => shared.decode(small).then(() => undefined))));
      const addedWorkers = starts - countBefore;
      const responsiveness = async fn => {
        let previous = performance.now(), maxGap = 0;
        const timer = setInterval(() => { const now = performance.now(); maxGap = Math.max(maxGap, now - previous); previous = now; }, 5);
        const totalMs = await duration(() => Promise.all(Array.from({ length: 8 }, () => fn(large).then(() => undefined))));
        await new Promise(resolve => setTimeout(resolve, 10));
        clearInterval(timer);
        return { totalMs: +totalMs.toFixed(2), maxTimerGapMs: +maxGap.toFixed(2) };
      };
      return {
        userAgent: navigator.userAgent,
        coldWorkerMs: +coldMs.toFixed(2), rows,
        batch100: { milliseconds: +batchMs.toFixed(2), addedWorkers },
        crc8MiB_x8: { direct: await responsiveness(direct), sharedWorker: await responsiveness(bytes => shared.decode(bytes)) },
      };
    } finally { shared.dispose(); }
  });
  console.log(JSON.stringify(result, null, 2));
} finally { await browser?.close(); server.kill(); }
