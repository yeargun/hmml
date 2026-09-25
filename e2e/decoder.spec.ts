import { expect, test } from "@playwright/test";

async function blank(page: import('@playwright/test').Page) {
  await page.goto('/examples/stream/index.html');
}

test('worker URL inputs respect the caller document base URL', async ({ page }) => {
  await blank(page);
  const html = await page.evaluate(async () => {
    const base = document.createElement('base');
    base.href = '/__test__/'; document.head.append(base);
    const path = '/dist/decode.js';
    const { decode, disposeDecoder } = await import(path);
    try { return (await decode('stream.hmml', { worker: true })).html; }
    finally { disposeDecoder(); base.remove(); }
  });
  expect(html).toContain('Blueprint is ready');
});

test('ordinary decode automatically shares one worker across many attachments and preserves input', async ({ page }) => {
  await blank(page);
  const workers: string[] = [];
  page.on('worker', worker => workers.push(worker.url()));
  const result = await page.evaluate(async () => {
    const d = '/dist/decode.js', e = '/dist/encode.js';
    const { decode, disposeDecoder } = await import(d);
    const { encode } = await import(e);
    const bytes = await encode({ html: '<p>attachment</p>', resources: [{ id: 'x', mime: 'image/gif', data: new Uint8Array([7, 8, 9]) }] });
    const docs = await Promise.all(Array.from({ length: 24 }, () => decode(bytes)));
    const streamEntry = '/dist/decode-stream.js';
    const { decodeStream } = await import(streamEntry);
    let streamed = '';
    for await (const event of decodeStream(bytes)) if (event.type === 'markup') streamed = event.html;
    const direct = await decode(bytes, { worker: false });
    const saved = { count: docs.length, lengths: bytes.byteLength, html: docs[0].html, kept: docs[0].toHTML({ resolve: 'keep' }), media: [...docs[23].resources.get('x').data], direct: direct.html, streamed };
    disposeDecoder();
    return saved;
  });
  expect(result.count).toBe(24);
  expect(result.lengths).toBeGreaterThan(0);
  expect(result.media).toEqual([7, 8, 9]);
  expect(result.kept).toBe(result.html);
  expect(result.direct).toBe(result.html);
  expect(result.streamed).toBe(result.html);
  expect(workers).toHaveLength(1);
  expect(workers[0]).toContain('decode-worker.js');
});

test('decode provides the blueprint before URL media and awaits its callback', async ({ page }) => {
  await blank(page);
  const result = await page.evaluate(async () => {
    const path = '/dist/decode.js';
    const { decode, disposeDecoder } = await import(path);
    let complete = false;
    let beforeComplete = false;
    const start = performance.now();
    let first = 0;
    const doc = await decode('/__test__/stream.hmml', { worker: true, onMarkup: async (html: string) => {
      beforeComplete = !complete && html.includes('Blueprint is ready');
      first = performance.now();
      await new Promise(resolve => setTimeout(resolve, 20));
    } });
    complete = true;
    const elapsedAfterBlueprint = performance.now() - first;
    disposeDecoder();
    return { beforeComplete, elapsedAfterBlueprint, resources: doc.resources.size, elapsed: performance.now() - start };
  });
  expect(result.beforeComplete).toBe(true);
  expect(result.resources).toBe(1);
  expect(result.elapsedAfterBlueprint).toBeGreaterThan(400);
});

test('worker opt-out and direct-only import create no workers', async ({ page, context }) => {
  await blank(page);
  const requests: string[] = [];
  context.on('request', r => requests.push(r.url()));
  let workers = 0;
  page.on('worker', () => workers++);
  const result = await page.evaluate(async () => {
    const p = '/dist/decode-direct.js', a = '/dist/decode.js', e = '/dist/encode.js';
    const { encode } = await import(e);
    const bytes = await encode({ html: 'direct' });
    const one = await (await import(p)).decode(bytes);
    const two = await (await import(a)).decode(bytes, { worker: false });
    return [one.html, two.html];
  });
  expect(result).toEqual(['direct', 'direct']);
  expect(workers).toBe(0);
  expect(requests.some(url => /decode-worker\.js/.test(url))).toBe(false);
});

test('failed startup falls back once, strict mode rejects, and inputs remain usable', async ({ page }) => {
  await blank(page);
  const result = await page.evaluate(async () => {
    const d = '/dist/decoder.js', e = '/dist/encode.js';
    const { createDecoder } = await import(d);
    const bytes = await (await import(e)).encode({ html: 'fallback' });
    let attempts = 0;
    const decoder = createDecoder({ startupTimeoutMs: 1000, workerFactory: () => { attempts++; throw new Error('CSP blocked'); } });
    const results = await Promise.all([decoder.decode(bytes), decoder.decode(bytes)]);
    let strict = '';
    try { await decoder.decode(bytes, { worker: true }); } catch (e) { strict = String(e); }
    decoder.dispose();
    return { attempts, strict, html: results.map((r: { html: string }) => r.html), bytes: bytes.length };
  });
  expect(result.attempts).toBe(1);
  expect(result.strict).toContain('CSP blocked');
  expect(result.html).toEqual(['fallback', 'fallback']);
  expect(result.bytes).toBeGreaterThan(0);
});

test('concurrency is bounded; queued aborts do not fetch; disposal cancels active work', async ({ page }) => {
  await blank(page);
  let fetches = 0;
  page.on('request', r => { if (r.url().includes('/__test__/stream.hmml')) fetches++; });
  const result = await page.evaluate(async () => {
    const d = '/dist/decoder.js';
    const { createDecoder } = await import(d);
    const decoder = createDecoder({ maxConcurrent: 1, worker: true });
    const active = decoder.decodeStream('/__test__/stream.hmml');
    await active.next(); // header; hold the only slot without consuming the stream
    const controller = new AbortController();
    const queued = decoder.decode('/__test__/stream.hmml?queued', { signal: controller.signal }).then(() => 'unexpected', (e: Error) => e.name);
    await new Promise(resolve => setTimeout(resolve, 30));
    controller.abort();
    const queuedResult = await queued;
    const second = decoder.decode('/__test__/stream.hmml?disposed').then(() => 'unexpected', (e: Error) => e.message);
    decoder.dispose();
    const disposed = await second;
    let activeError = '';
    try { await active.next(); } catch (e) { activeError = String(e); }
    return { queuedResult, disposed, activeError };
  });
  expect(fetches).toBe(1);
  expect(result.queuedResult).toBe('AbortError');
  expect(result.disposed).toContain('disposed');
  expect(result.activeError).toContain('disposed');
});

test('transfer is explicit, subarray transfer is rejected, and Blob/stream inputs work', async ({ page }) => {
  await blank(page);
  const result = await page.evaluate(async () => {
    const d = '/dist/decode.js', e = '/dist/encode.js';
    const { decode, disposeDecoder } = await import(d);
    const bytes = await (await import(e)).encode({ html: 'owned' });
    const blob = new Blob([bytes]);
    const copied = bytes.slice();
    await decode(copied, { worker: true, transfer: true });
    let error = '';
    try { await decode(new Uint8Array(bytes.buffer, 1), { worker: true, transfer: true }); } catch (e) { error = String(e); }
    const one = await decode(blob, { worker: true });
    const stream = blob.stream();
    const two = await decode(stream, { worker: true });
    disposeDecoder();
    return { detached: copied.byteLength, preserved: bytes.length, error, html: [one.html, two.html], consumed: stream.locked || (await stream.getReader().read()).done };
  });
  expect(result.detached).toBe(0);
  expect(result.preserved).toBeGreaterThan(0);
  expect(result.error).toContain('entire ArrayBuffer');
  expect(result.html).toEqual(['owned', 'owned']);
  expect(result.consumed).toBe(true);
});

test('application errors after dispatch are never retried on the main thread', async ({ page }) => {
  await blank(page);
  const result = await page.evaluate(async () => {
    const d = '/dist/decode.js', e = '/dist/encode.js';
    const { decode, disposeDecoder } = await import(d);
    const bytes = await (await import(e)).encode({ html: 'once' });
    let calls = 0, error = '';
    try { await decode(bytes, { onMarkup: () => { calls++; throw new Error('renderer failed'); } }); } catch (e) { error = String(e); }
    disposeDecoder();
    return { calls, error };
  });
  expect(result.calls).toBe(1);
  expect(result.error).toContain('renderer failed');
});

test('a worker that never becomes ready times out once and falls back', async ({ page }) => {
  await blank(page);
  const result = await page.evaluate(async () => {
    const d = '/dist/decoder.js', e = '/dist/encode.js';
    const { createDecoder } = await import(d);
    const bytes = await (await import(e)).encode({ html: 'ready fallback' });
    const url = URL.createObjectURL(new Blob(['self.onmessage = () => {};'], { type: 'text/javascript' }));
    let attempts = 0;
    const decoder = createDecoder({ startupTimeoutMs: 100, workerFactory: () => { attempts++; return new Worker(url); } });
    try {
      const one = await decoder.decode(bytes);
      const two = await decoder.decode(bytes);
      return { attempts, html: [one.html, two.html] };
    } finally { decoder.dispose(); URL.revokeObjectURL(url); }
  });
  expect(result.attempts).toBe(1);
  expect(result.html).toEqual(['ready fallback', 'ready fallback']);
});

test('a crashed worker fails the request and a later request gets a new worker', async ({ page }) => {
  await blank(page);
  const result = await page.evaluate(async () => {
    const d = '/dist/decoder.js', e = '/dist/encode.js';
    const { createDecoder } = await import(d);
    const source = `import { serveDecodeWorker } from '${location.origin}/dist/worker.js'; serveDecodeWorker(self); addEventListener('message', e => { if (e.data === 'crash') throw new Error('test worker crash'); });`;
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    let activeWorker: Worker;
    let attempts = 0;
    const decoder = createDecoder({ worker: true, workerFactory: () => { attempts++; return activeWorker = new Worker(url, { type: 'module' }); } });
    try {
      const stream = decoder.decodeStream('/__test__/stream.hmml');
      await stream.next();
      activeWorker!.postMessage('crash');
      let error = '';
      try { await stream.next(); } catch (e) { error = String(e); }
      const doc = await decoder.decode(await (await import(e)).encode({ html: 'recovered' }));
      return { attempts, error, html: doc.html };
    } finally { decoder.dispose(); URL.revokeObjectURL(url); }
  });
  expect(result.attempts).toBe(2);
  expect(result.error).toContain('worker failed');
  expect(result.html).toBe('recovered');
});
