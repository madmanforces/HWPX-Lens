import { expect, test } from "@playwright/test";
import { loadBodyTextFixture } from "../helpers/hwpx-fixture";

test("Canvas2D PoC renders, selects, copies and navigates through public APIs", async ({
  context,
  page,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: "http://127.0.0.1:1420",
  });
  await page.goto("/?canvas-poc=1");

  const [original, modified] = await Promise.all([
    loadBodyTextFixture(),
    loadBodyTextFixture("modified"),
  ]);
  await page.locator('input[type="file"]').nth(0).setInputFiles({
    name: "original.hwpx",
    mimeType: "application/zip",
    buffer: Buffer.from(original),
  });
  await page.locator('input[type="file"]').nth(1).setInputFiles({
    name: "modified.hwpx",
    mimeType: "application/zip",
    buffer: Buffer.from(modified),
  });

  await expect(page.locator("canvas")).toHaveCount(2, { timeout: 20_000 });
  await expect(page.locator('.rendered-canvas[data-renderer="canvas2d"]')).toHaveCount(2);
  await expect(page.locator(".change-nav")).toContainText("1 / 2");

  await page.getByRole("button", { name: "다음 변경" }).click();
  await expect(page.locator(".change-nav")).toContainText("2 / 2");
  await page.getByRole("button", { name: "이전 변경" }).click();
  await expect(page.locator(".change-nav")).toContainText("1 / 2");

  const surface = page.locator(".native-interaction-surface").first();
  const bounds = await surface.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) return;

  const y = bounds.y + bounds.height * 0.08;
  await page.mouse.move(bounds.x + bounds.width * 0.135, y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.20, y, { steps: 8 });
  await page.mouse.up();

  await expect(page.locator(".native-selection-overlay rect").first()).toBeVisible();
  await page.keyboard.press("Control+C");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied.length).toBeGreaterThan(1);
  expect(copied).not.toMatch(/^(?:.\r?\n){2,}/u);

  await page.keyboard.press("Escape");
  await expect(page.locator(".native-selection-overlay")).toHaveCount(0);
});
