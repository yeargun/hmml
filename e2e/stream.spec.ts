import { expect, test } from "@playwright/test";

test("loads the worker on demand and renders markup before HTTP-gzipped media", async ({ page, context }) => {
  const requests: string[] = [];
  context.on("request", request => requests.push(request.url()));
  await page.goto("/examples/stream/index.html");
  expect(requests.some(url => url.includes("/dist/"))).toBe(false);
  await page.getByRole("button", { name: "Open document" }).click();
  await expect(page.locator("#stage h2")).toHaveText("Blueprint is ready");
  expect(await page.locator("#stage img").getAttribute("src")).toBeNull();
  await expect(page.locator("#status")).toHaveText("end");
  const image = await page.locator("#stage img").evaluate(async (img: HTMLImageElement) => {
    await img.decode();
    return { width: img.naturalWidth, height: img.naturalHeight, src: img.src };
  });
  expect(image).toMatchObject({ width: 80, height: 40 });
  expect(image.src).toMatch(/^blob:/);
  // HTTP gzip is decoded by fetch, so no HMML file decompressor is loaded.
  expect(requests.some(url => /\/inflate-/.test(url))).toBe(false);
});

test("can cancel an active worker fetch and reuse the worker", async ({ page }) => {
  await page.goto("/examples/stream/index.html");
  await page.getByRole("button", { name: "Open document" }).click();
  await expect(page.locator("#stage h2")).toHaveText("Blueprint is ready");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator("#status")).toHaveText("Cancelled.");
  await page.getByRole("button", { name: "Open document" }).click();
  await expect(page.locator("#status")).toHaveText("end");
});

test("worker requests are isolated, propagate HTTP errors, and obey consumer pulls", async ({ page }) => {
  await page.goto("/examples/stream/index.html");
  const result = await page.evaluate(async () => {
    const path = "/dist/worker.js";
    const { decodeInWorker } = await import(path);
    const worker = new Worker("/examples/stream/worker.js", { type: "module" });
    try {
      let error = "";
      try { for await (const _ of decodeInWorker(worker, "/does-not-exist.hmml")) { /* drain */ } }
      catch (e) { error = String(e); }
      const collect = async () => {
        const types: string[] = [];
        const bytes: number[] = [];
        for await (const event of decodeInWorker(worker, "/__test__/stream.hmml")) {
          types.push(event.type);
          if (event.type === "resource-data") bytes.push(...event.data);
        }
        return { types, text: new TextDecoder().decode(new Uint8Array(bytes)) };
      };
      const streams = await Promise.all([collect(), collect()]);
      // Returning after a header exercises cancellation while the worker is idle.
      for await (const event of decodeInWorker(worker, "/__test__/stream.hmml")) {
        if (event.type === "header") break;
      }
      return { error, streams };
    } finally { worker.terminate(); }
  });
  expect(result.error).toContain("404");
  for (const stream of result.streams) {
    expect(stream.types).toEqual(["header", "markup", "resource-start", "resource-data", "resource-end", "end"]);
    expect(stream.text).toContain("<svg");
  }
});

test("encodes in a worker and transfers the file back", async ({ page }) => {
  await page.goto("/examples/stream/index.html");
  const html = await page.evaluate(async () => {
    const worker = new Worker("/examples/stream/encode-worker.js", { type: "module" });
    try {
      const bytes = await new Promise<Uint8Array>((resolve, reject) => {
        worker.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve(data.bytes);
        worker.onerror = reject;
        worker.postMessage({ html: "<h1>Saved in a worker</h1>" });
      });
      const path = "/dist/decode.js";
      return (await (await import(path)).decode(bytes)).html;
    } finally { worker.terminate(); }
  });
  expect(html).toBe("<h1>Saved in a worker</h1>");
});

test("loads the native file inflater lazily inside the worker when required", async ({ page, context }) => {
  const requests: string[] = [];
  context.on("request", request => requests.push(request.url()));
  await page.goto("/examples/stream/index.html");
  const types = await page.evaluate(async () => {
    const path = '/dist/worker.js';
    const { decodeInWorker } = await import(path);
    const worker = new Worker('/examples/stream/worker.js', { type: 'module' });
    const types: string[] = [];
    try {
      for await (const event of decodeInWorker(worker, '/__test__/stream.hmml?internal')) types.push(event.type);
    } finally { worker.terminate(); }
    return types;
  });
  expect(types).toContain('markup');
  expect(types[types.length - 1]).toBe('end');
  expect(requests.some(url => /\/inflate-/.test(url))).toBe(true);
});
