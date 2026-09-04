import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { HwpDocument, initSync } from "@rhwp/core";
import { loadBodyTextFixture } from "../helpers/hwpx-fixture";

test("renders highlighter ranges and an exact missing-space check mark", async ({ page }) => {
  await page.goto("/");
  const pair = await createPair(
    ["전원을 끈다.", "각 붙여쓰기"],
    ["전원을 차단한다.", "각 붙여 쓰기"],
  );
  await loadPair(page, pair.original, pair.modified);

  await expect(page.locator(".change-card")).toHaveCount(2, { timeout: 20_000 });
  await expect(page.locator('.review-ink--text-modified.is-active rect')).toHaveCount(2);
  await expect(page.locator('.review-ink--whitespace-missing:not(.is-active)')).toHaveCount(1);
  await expect(page.locator(".highlight-overlay")).toHaveCount(0);

  const activeRects = await page.locator('.review-ink--text-modified.is-active rect').evaluateAll(
    (rects) => rects.map((rect) => ({
      x: Number(rect.getAttribute("x")),
      width: Number(rect.getAttribute("width")),
      height: Number(rect.getAttribute("height")),
    })),
  );
  expect(activeRects.every((rect) => rect.x > 0 && rect.width > 1 && rect.width < 180)).toBe(true);
  expect(activeRects.every((rect) => rect.height > 4)).toBe(true);

  await page.locator(".change-card").nth(1).click();
  const originalMarker = page.locator(
    '[aria-label="ORIGINAL 문서"] path[data-review-ink="whitespace-missing"].is-active',
  );
  await expect(originalMarker).toHaveCount(1);
  await expect(originalMarker).toHaveAttribute("data-whitespace-mark", "check");
  await expect(page.locator(
    '[aria-label="MODIFIED 문서"] path[data-review-ink="whitespace-missing"]',
  )).toHaveCount(0);
  const markerPath = await originalMarker.getAttribute("d");
  expect(markerPath).toMatch(/^M .+ L .+ L .+$/);

  await expect(page.locator('.review-ink--text-modified:not(.is-active) rect')).toHaveCount(2);
  await expect(page.locator('[aria-label="MODIFIED 문서"] .highlight-overlay')).toHaveCount(0);
  expect(await originalMarker.evaluate((element) => getComputedStyle(element).pointerEvents)).toBe("none");
});

test("keeps the existing open-top mark for a join-space change", async ({ page }) => {
  await page.goto("/");
  const pair = await createPair(
    ["전원을 끈다.", "붙여 쓰기"],
    ["전원을 끈다.", "붙여쓰기"],
  );
  await loadPair(page, pair.original, pair.modified);

  await expect(page.locator(".change-card")).toHaveCount(1, { timeout: 20_000 });
  const marker = page.locator(
    '[aria-label="MODIFIED 문서"] path[data-whitespace-mark="join"].is-active',
  );
  await expect(marker).toHaveCount(1);
  expect(await marker.getAttribute("d")).toMatch(/^M .+ V .+ H .+ V .+$/);
});

test("renders a removed substring as a full-height highlighter instead of a red underline", async ({ page }) => {
  await page.goto("/");
  const pair = await createPair(
    ["정상모드는 정상모드이다."],
    ["정상은 정상이다."],
  );
  await loadPair(page, pair.original, pair.modified);

  await expect(page.locator(".change-card")).toHaveCount(1, { timeout: 20_000 });
  const removed = page.locator(
    '[aria-label="ORIGINAL 문서"] .review-ink--text-removed.is-active rect',
  );
  await expect(removed).toHaveCount(1);
  const rects = await removed.evaluateAll((elements) => elements.map((element) => ({
    width: Number(element.getAttribute("width")),
    height: Number(element.getAttribute("height")),
  })));
  expect(rects.every((rect) => rect.width > 1 && rect.width < 100)).toBe(true);
  expect(rects.every((rect) => rect.height > 4)).toBe(true);
});

async function createPair(before: readonly string[], after: readonly string[]) {
  const runtime = globalThis as typeof globalThis & {
    measureTextWidth?: (font: string, text: string) => number;
  };
  runtime.measureTextWidth = (_font, text) => Array.from(text).length * 7;
  try {
    initSync({ module: await readFile(path.resolve("vendor/rhwp-0.8.6-hwpx-lens/rhwp_bg.wasm")) });
  } catch {
    // Another test in this worker may already have initialized the singleton.
  }
  const source = new HwpDocument(await loadBodyTextFixture());
  let original: Uint8Array;
  try {
    before.forEach((text, paragraphIndex) => replaceParagraph(source, paragraphIndex, text));
    original = source.exportHwpx();
  } finally {
    source.free();
  }
  const modified = new HwpDocument(original);
  try {
    after.forEach((text, paragraphIndex) => replaceParagraph(modified, paragraphIndex, text));
    return { original, modified: modified.exportHwpx() };
  } finally {
    modified.free();
  }
}

function replaceParagraph(document: HwpDocument, paragraphIndex: number, text: string) {
  const length = document.getParagraphLength(0, paragraphIndex);
  if (length > 0) document.deleteText(0, paragraphIndex, 0, length);
  document.insertText(0, paragraphIndex, 0, text);
}

async function loadPair(
  page: import("@playwright/test").Page,
  original: Uint8Array,
  modified: Uint8Array,
) {
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
}
