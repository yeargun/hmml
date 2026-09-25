import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => { await page.goto("/examples/mount/index.html"); });

test("progressive opaque iframe shows blueprint before delayed media; Blob URLs resolve locally", async ({ page }) => {
  await page.evaluate(async () => {
    const { createFrame } = await import(String("/dist/frame.js"));
    const { createDecoder } = await import(String("/dist/decoder.js"));
    const decoder = createDecoder();
    const frame = createFrame(document.getElementById("host")!, { width: "320px", height: "240px" });
    (window as any).frameHandle = frame;
    (window as any).finished = false;
    (window as any).work = (async () => {
      for await (const event of decoder.decodeStream("/__test__/stream.hmml")) await frame.write(event, { transfer: true });
      (window as any).finished = true;
      decoder.dispose();
    })();
  });
  const frame = page.frameLocator("#host iframe");
  await expect(frame.locator("h2")).toHaveText("Blueprint is ready");
  expect(await page.evaluate(() => (window as any).finished)).toBe(false);
  await page.waitForFunction(() => (window as any).finished);
  await expect(frame.locator("img")).toHaveJSProperty("naturalWidth", 80);
  expect(await frame.locator("img").getAttribute("src")).toMatch(/^blob:null\//);
  expect(await page.locator("#host iframe").getAttribute("sandbox")).toBe("allow-scripts");
  const viewport = await page.locator("#host iframe").boundingBox();
  expect(viewport?.width).toBe(320); expect(viewport?.height).toBe(240);
  await page.evaluate(() => (window as any).frameHandle.dispose());
  await expect(page.locator("#host iframe")).toHaveCount(0);
});

test("frame confines CSS, blocks document scripts/handlers/network, and auto size grows and shrinks", async ({ page }) => {
  let network = 0;
  // Chromium also emits request events for requests rejected by CSP. Routing is
  // reached only if the browser would actually send the request to the network.
  await page.route("**/*frame-leak*", route => { network++; return route.abort(); });
  await page.evaluate(async () => {
    const { createFrame } = await import(String("/dist/frame.js"));
    addEventListener("message", event => { if (event.data === "frame-script-ran") (window as any).scriptRan = true; });
    const frame = createFrame(document.getElementById("host")!, { width: "300px", height: "auto", minHeight: 40, maxHeight: 200 });
    (window as any).frameHandle = frame;
    await frame.write({ type: "markup", html: `<style>body{margin:0;background:rgb(1,2,3)} #box{height:120px} @media(max-width:200px){#box{height:350px}}</style><div id="box">hello</div><script>parent.postMessage('frame-script-ran','*')<\/script><img src="https://example.com/frame-leak" onerror="document.body.dataset.pwned='yes'">` });
  });
  const locator = page.locator("#host iframe");
  await expect.poll(async () => (await locator.boundingBox())?.height).toBeLessThan(200);
  await expect.poll(async () => (await locator.boundingBox())?.height).toBeGreaterThanOrEqual(120);
  expect(await page.frameLocator("#host iframe").locator("body").getAttribute("data-pwned")).toBeNull();
  expect(await page.evaluate(() => (window as any).scriptRan === true)).toBe(false);
  expect(await page.locator("body").evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe("rgb(1, 2, 3)");
  expect(network).toBe(0);
  await page.evaluate(() => (window as any).frameHandle.resize({ width: "180px" }));
  await expect.poll(async () => (await locator.boundingBox())?.height).toBe(200);
  await page.evaluate(() => (window as any).frameHandle.resize({ width: "300px" }));
  await expect.poll(async () => (await locator.boundingBox())?.height).toBeLessThan(200);
});

test("resource references in styles and attributes update without replacing the DOM", async ({ page }) => {
  await page.evaluate(async () => {
    const { createFrame } = await import(String("/dist/frame.js"));
    const frame = createFrame(document.getElementById("host")!);
    (window as any).frameHandle = frame;
    await frame.write({ type: "markup", html: '<style>#box{background-image:url(hmml:pic)}</style><div id="box" style="width:40px;height:40px"></div><input value="keep"><img src="hmml:pic" srcset="hmml:pic 1x, hmml:pic 2x">' });
  });
  await page.frameLocator("#host iframe").locator("input").fill("editor selection survives");
  await page.evaluate(async () => {
    const frame = (window as any).frameHandle;
    const data = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="red"/></svg>');
    await frame.write({ type: "resource-start", id: "pic", mime: "image/svg+xml", byteLength: data.length });
    await frame.write({ type: "resource-data", id: "pic", data });
    if (!data.length) throw new Error("Input unexpectedly detached");
    await frame.write({ type: "resource-end", id: "pic" });
    await frame.write({ type: "end" });
  });
  const inner = page.frameLocator("#host iframe");
  await expect(inner.locator("input")).toHaveValue("editor selection survives");
  await expect(inner.locator("img")).toHaveJSProperty("naturalWidth", 20);
  expect(await inner.locator("#box").evaluate(element => getComputedStyle(element).backgroundImage)).toContain("blob:null/");
});

test("frame enforces media quotas and rejects pending writes on disposal", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { createFrame } = await import(String("/dist/frame.js"));
    const slot = document.getElementById("host")!;
    const frame = createFrame(slot, { maxMediaBytes: 2 });
    await frame.write({ type: "markup", html: "hello" });
    let error = "";
    try { await frame.write({ type: "resource-start", id: "huge", mime: "video/mp4", byteLength: 3 }); }
    catch (e) { error = String(e); }
    const other = createFrame(slot);
    const writing = other.write({ type: "markup", html: "pending" });
    other.dispose(); other.dispose();
    let disposed = "";
    try { await writing; } catch (e) { disposed = String(e); }
    return { error, disposed, frames: slot.querySelectorAll("iframe").length };
  });
  expect(result.error).toContain("quota"); expect(result.disposed).toContain("disposed"); expect(result.frames).toBe(0);
});

test("completed audio bytes activate a nested source element inside the sandbox", async ({ page }) => {
  await page.evaluate(async () => {
    const { createFrame } = await import(String("/dist/frame.js"));
    const frame = createFrame(document.getElementById("host")!);
    await frame.write({ type: "markup", html: '<audio controls><source src="hmml:sound" type="audio/wav"></audio>' });
    // 100 ms of silent 8 kHz, 16-bit mono PCM in a WAV container.
    const bytes = new Uint8Array(44 + 1600), view = new DataView(bytes.buffer);
    const ascii = (offset: number, value: string) => bytes.set(new TextEncoder().encode(value), offset);
    ascii(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); ascii(8, 'WAVE'); ascii(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    ascii(36, 'data'); view.setUint32(40, 1600, true);
    await frame.write({ type: "resource-start", id: "sound", mime: "audio/wav", byteLength: bytes.length });
    await frame.write({ type: "resource-data", id: "sound", data: bytes }, { transfer: true });
    await frame.write({ type: "resource-end", id: "sound" });
  });
  await expect.poll(() => page.frameLocator('#host iframe').locator('audio').evaluate((audio: HTMLAudioElement) => audio.duration)).toBeCloseTo(0.1, 2);
});
