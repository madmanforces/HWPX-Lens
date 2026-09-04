import { expect, test } from "@playwright/test";
import { loadBodyTextFixture } from "../helpers/hwpx-fixture";

test("default SVG renderer selects and copies through semantic native interaction", async ({
  context,
  page,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: "http://127.0.0.1:1420",
  });
  await page.goto("/");

  const [original, modified] = await Promise.all([
    loadBodyTextFixture(),
    loadBodyTextFixture("modified"),
  ]);
  for (const [index, bytes] of [original, modified].entries()) {
    await page.locator('input[type="file"]').nth(index).setInputFiles({
      name: index === 0 ? "original.hwpx" : "modified.hwpx",
      mimeType: "application/zip",
      buffer: Buffer.from(bytes),
    });
  }

  await expect(page.locator('.page-viewport[data-renderer="svg"] .rendered-svg')).toHaveCount(2, {
    timeout: 20_000,
  });
  await expect(page.locator(".native-interaction-surface")).toHaveCount(2);

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
  const staleClipboard = "C:\\workspace\\documents\\selected-document.hwpx";
  await page.evaluate(async (value) => {
    await navigator.clipboard.writeText(value);
    const blockNativeCopy = (event: ClipboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    document.addEventListener("copy", blockNativeCopy, { capture: true, once: true });
  }, staleClipboard);
  await page.keyboard.press("Control+C");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied.length).toBeGreaterThan(1);
  expect(copied).not.toBe(staleClipboard);
  expect(copied).not.toContain(".hwpx");
  expect(copied).not.toMatch(/^(?:.\r?\n){2,}/u);

  await page.keyboard.press("Escape");
  await expect(page.locator(".native-selection-overlay")).toHaveCount(0);
});
