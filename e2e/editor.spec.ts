import { expect, test } from "@playwright/test";

test("multiple editor attachments share one worker and can be removed independently", async ({ page }) => {
  const workers: string[] = [];
  page.on("worker", worker => workers.push(worker.url()));
  await page.goto("/examples/editor/");
  await page.getByRole("button", { name: "Add delayed sample" }).click({ clickCount: 2 });
  await expect(page.locator("article")).toHaveCount(2);
  await expect(page.locator("article .status").first()).toHaveText("Ready");
  await expect(page.locator("article .status").last()).toHaveText("Ready");
  expect(workers).toHaveLength(1);
  await expect(page.frameLocator("article >> nth=1 >> iframe").locator("img")).toHaveJSProperty("naturalWidth", 80);
  await page.getByRole("button", { name: "Remove", exact: true }).first().click();
  await expect(page.locator("article")).toHaveCount(1);
  await expect(page.frameLocator("article iframe").locator("h2")).toHaveText("Blueprint is ready");
});
