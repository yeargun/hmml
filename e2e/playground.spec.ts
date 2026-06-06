import { expect, test } from "@playwright/test";

test("gallery lists generated files and previews them", async ({ page }) => {
  await page.goto("/"); // server default → playground/index.html
  const items = page.locator("#grid .item");
  await expect(items.first()).toBeVisible({ timeout: 15000 });
  const count = await items.count();
  expect(count).toBeGreaterThanOrEqual(5); // checker, gradient, logo, rings, gallery
  await expect(page.locator(".note")).toBeHidden(); // manifest loaded fine
  await page.screenshot({ path: "e2e/playground.png", fullPage: true });
});

test("viewer renders a .hmml fetched by ?file=", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto("/playground/viewer.html?file=files/gradient.hmml");
  const img = page.locator("#stage img");
  await expect(img).toBeVisible({ timeout: 15000 });
  const w = await img.evaluate(async (el: HTMLImageElement) => {
    await el.decode();
    return el.naturalWidth;
  });
  expect(w).toBeGreaterThan(0);
  await expect(page.locator("#stats")).toBeVisible();
  expect(errors).toEqual([]);
});

test("create page packs a chosen image into an .hmml in-browser", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto("/playground/create.html");
  await page.setInputFiles("#files", "playground/assets/gradient.png");

  const img = page.locator("#stage img");
  await expect(img).toBeVisible({ timeout: 15000 });
  const w = await img.evaluate(async (el: HTMLImageElement) => {
    await el.decode();
    return el.naturalWidth;
  });
  expect(w).toBeGreaterThan(0);
  await expect(page.locator("#row")).toBeVisible(); // download buttons appeared
  await expect(page.locator("#stats")).toContainText("savings");
  expect(errors).toEqual([]);
});
