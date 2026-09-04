import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { HwpDocument, initSync } from "@rhwp/core";
import { loadBodyTextFixture } from "../helpers/hwpx-fixture";

test("analyzes eagerly, renders lazily, and reuses only the in-memory analysis cache", async ({
  page,
}) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if ((url.protocol === "http:" || url.protocol === "https:") && url.host !== "127.0.0.1:1420") {
      externalRequests.push(request.url());
    }
  });
  await page.goto("/?canvas-poc=1&render-cache-pages=5");

  const pair = await createLateChangePair();
  await loadPair(page, pair.original, pair.modified);
  await expect(page.locator('.lens-app[data-analysis-phase="ready"]')).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator(".change-card")).toHaveCount(1);

  const viewports = page.locator(".page-viewport");
  await expect(viewports).toHaveCount(2);
  for (let side = 0; side < 2; side += 1) {
    const viewport = viewports.nth(side);
    expect(Number(await viewport.getAttribute("data-page-count"))).toBeGreaterThan(5);
    expect(Number(await viewport.getAttribute("data-render-cache-size"))).toBeLessThanOrEqual(5);
    expect(await viewport.locator('.page-card[data-page-state="rendered"]').count()).toBeLessThanOrEqual(5);
    expect(await viewport.locator('.page-card[data-page-state="placeholder"]').count()).toBeGreaterThan(0);
  }

  const highlightedPages = await page.locator(".page-card:has(.review-ink-overlay .is-active)")
    .evaluateAll((cards) => cards.map((card) => Number((card as HTMLElement).dataset.pageIndex)));
  // Inserted text exists only on Modified; Original now also shows the exact
  // semantic insertion boundary instead of appearing unmarked.
  expect(highlightedPages).toHaveLength(2);
  expect(highlightedPages.every((pageIndex) => pageIndex > 5)).toBe(true);
  await expect.poll(async () => page.locator(".review-ink.is-active").first().evaluate((ink) => {
    const viewport = ink.closest(".page-viewport");
    const card = ink.closest(".page-card");
    if (!viewport || !card) return false;
    const inkBounds = ink.getBoundingClientRect();
    const viewportBounds = viewport.getBoundingClientRect();
    const cardBounds = card.getBoundingClientRect();
    return inkBounds.top >= viewportBounds.top &&
      inkBounds.bottom <= viewportBounds.bottom &&
      cardBounds.height <= viewportBounds.height;
  })).toBe(true);
  await expect(viewports.first()).toHaveAttribute("data-fit-mode", "page");

  for (let side = 0; side < 2; side += 1) {
    const viewport = viewports.nth(side);
    await viewport.locator('.page-card[data-page-index="5"]').evaluate((card) =>
      card.scrollIntoView({ block: "center" }),
    );
  }
  await expect.poll(async () =>
    Number(await viewports.first().getAttribute("data-render-evictions")),
  ).toBeGreaterThan(0);
  expect(Number(await viewports.first().getAttribute("data-render-cache-size"))).toBeLessThanOrEqual(5);

  await loadPair(page, pair.original, pair.modified);
  await expect.poll(async () => {
    const report = JSON.parse(
      await page.locator(".lens-app").getAttribute("data-analysis-report") ?? "{}",
    ) as { pairCacheHit?: boolean; snapshotCacheHits?: number };
    return report.pairCacheHit === true && report.snapshotCacheHits === 2;
  }, { timeout: 30_000 }).toBe(true);

  await expect(page.locator(".lens-app")).toHaveAttribute("data-analysis-cache-persistent", "false");
  expect(externalRequests).toEqual([]);
});

async function createLateChangePair(): Promise<{ original: Uint8Array; modified: Uint8Array }> {
  const runtime = globalThis as typeof globalThis & {
    measureTextWidth?: (font: string, text: string) => number;
  };
  runtime.measureTextWidth = (_font, text) => Array.from(text).length * 7;
  initSync({ module: await readFile(path.resolve("vendor/rhwp-0.8.6-hwpx-lens/rhwp_bg.wasm")) });
  const source = new HwpDocument(await loadBodyTextFixture());
  let original: Uint8Array;
  try {
    const currentLength = source.getParagraphLength(0, 0);
    if (currentLength > 0) source.deleteText(0, 0, 0, currentLength);
    source.insertText(0, 0, 0, repeatedSentence(800));
    original = source.exportHwpx();
  } finally {
    source.free();
  }
  const document = new HwpDocument(original);
  try {
    const length = document.getParagraphLength(0, 0);
    document.insertText(0, 0, Math.max(0, length - 1), "변경");
    return { original, modified: document.exportHwpx() };
  } finally {
    document.free();
  }
}

function repeatedSentence(count: number): string {
  return Array.from({ length: count }, (_, index) =>
    `${index + 1}. 장비의 전원을 차단하고 연결 상태를 확인한다. `,
  ).join("");
}

async function loadPair(page: import("@playwright/test").Page, original: Uint8Array, modified: Uint8Array) {
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
