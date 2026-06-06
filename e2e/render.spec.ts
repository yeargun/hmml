import { expect, test } from "@playwright/test";

test("decodes and renders an HMML document in a real browser", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await page.goto("/examples/browser/index.html");

  // The demo publishes its results here once the full round-trip completes.
  await page.waitForFunction(() => (window as any).__hmmlDemo?.ready === true, undefined, { timeout: 20000 });
  const demo = await page.evaluate(() => (window as any).__hmmlDemo);

  expect(demo.error, `demo error: ${demo.error}`).toBeFalsy();
  expect(demo.roundTrip, "markup must round-trip exactly").toBe(true);
  expect(demo.resources).toBeGreaterThan(0);
  expect(demo.fileSize).toBeLessThan(demo.selfContained); // smaller than base64 HTML

  // The decoded image must actually paint (jsdom can't prove this - a real engine can).
  const img = page.locator("#stage img");
  await expect(img).toBeVisible();
  const dims = await img.evaluate(async (el: HTMLImageElement) => {
    await el.decode();
    return { w: el.naturalWidth, h: el.naturalHeight, src: el.src };
  });
  expect(dims.w).toBe(demo.imgW);
  expect(dims.h).toBe(demo.imgH);
  expect(dims.src.startsWith("blob:")).toBe(true); // resolved via object URL

  await page.screenshot({ path: "e2e/render.png" });
  expect(errors, `console/page errors: ${errors.join("\n")}`).toEqual([]);
});
