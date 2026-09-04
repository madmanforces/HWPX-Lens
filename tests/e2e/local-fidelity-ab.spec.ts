import { expect, test, type Page } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { HwpDocument, initSync } from "@rhwp/core";
import { JSDOM } from "jsdom";
import { sanitizeRenderedSvg } from "../../packages/hwpx-adapter/src/svg-safety";

const localFixture = process.env.HWPX_LENS_LOCAL_FIXTURE;
const targetPageIndexes = [1, 2, 11, 12, 13, 14];

test.skip(!localFixture, "Set HWPX_LENS_LOCAL_FIXTURE to an ignored local fixture.");

test("materializes raw SVG, Lens SVG, and Canvas2D evidence for known fidelity pages", async ({ browser }) => {
  test.setTimeout(300_000);
  const fixturePath = path.resolve(localFixture!);
  const fixtureRoot = `${path.resolve("local-fixtures")}${path.sep}`;
  expect(fixturePath.startsWith(fixtureRoot)).toBe(true);

  const outputDirectory = path.resolve("test-results/fidelity/v006-ab");
  await mkdir(outputDirectory, { recursive: true });
  const bytes = await readFile(fixturePath);
  globalThis.measureTextWidth = (_font, text) => Array.from(text).length * 7;
  const dom = new JSDOM();
  globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;
  globalThis.XMLSerializer = dom.window.XMLSerializer as typeof XMLSerializer;
  initSync({
    module: await readFile(path.resolve("vendor/rhwp-0.8.6-hwpx-lens/rhwp_bg.wasm")),
  });
  const document = new HwpDocument(bytes);

  try {
    for (const pageIndex of targetPageIndexes) {
      const raw = document.renderPageSvg(pageIndex);
      const sanitized = sanitizeRenderedSvg(raw).markup;
      if (pageIndex === 14) {
        assertCaptionSequences(raw);
        assertCaptionSequences(sanitized);
      }
      const pageNumber = String(pageIndex + 1).padStart(3, "0");
      await writeFile(path.join(outputDirectory, `page-${pageNumber}-raw.svg`), raw, "utf8");
      await writeFile(path.join(outputDirectory, `page-${pageNumber}-lens.svg`), sanitized, "utf8");
      await captureStandaloneSvg(browser, raw, path.join(outputDirectory, `page-${pageNumber}-raw.png`));
      await captureStandaloneSvg(browser, sanitized, path.join(outputDirectory, `page-${pageNumber}-lens.png`));
    }
  } finally {
    document.free();
  }

  await captureAppPages(browser, bytes, false, outputDirectory);
  await captureAppPages(browser, bytes, true, outputDirectory);
}, 300_000);

async function captureStandaloneSvg(
  browser: import("@playwright/test").Browser,
  markup: string,
  screenshotPath: string,
): Promise<void> {
  const page = await browser.newPage({
    viewport: { width: 1_200, height: 1_400 },
  });
  try {
    await page.setContent(
      `<!doctype html><style>html,body{margin:0;background:#ddd}#surface{width:900px;margin:0 auto;background:#fff}#surface>svg{display:block;width:100%;height:auto}</style><div id="surface">${markup}</div>`,
    );
    await page.locator("#surface").screenshot({ path: screenshotPath });
  } finally {
    await page.close();
  }
}

async function captureAppPages(
  browser: import("@playwright/test").Browser,
  bytes: Uint8Array,
  canvas: boolean,
  outputDirectory: string,
): Promise<void> {
  const page = await browser.newPage({
    viewport: { width: 1_700, height: 1_100 },
  });
  try {
    if (canvas) {
      await page.addInitScript(() => {
        const records: string[] = [];
        Object.defineProperty(window, "__hwpxLensFillText", { value: records });
        const original = CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText = function(text, x, y, maxWidth) {
          records.push(String(text));
          if (maxWidth === undefined) return original.call(this, text, x, y);
          return original.call(this, text, x, y, maxWidth);
        };
      });
    }
    await page.goto(canvas ? "/?canvas-poc=1" : "/");
    await loadPair(page, bytes);
    await expect(page.locator('.lens-app[data-analysis-phase="ready"]')).toBeVisible({ timeout: 90_000 });
    const viewport = page.locator(".page-viewport").first();
    for (const pageIndex of targetPageIndexes) {
      const card = viewport.locator(`.page-card[data-page-index="${pageIndex}"]`);
      await card.evaluate((element) => element.scrollIntoView({ block: "center" }));
      await expect(card).toHaveAttribute("data-page-state", "rendered", {
        timeout: 30_000,
      });
      if (canvas) await expect(card.locator("canvas")).toBeVisible();
      else {
        await expect(card.locator(".rendered-svg > svg")).toBeVisible();
        await assertSvgReferencesArePageLocal(card);
      }
      if (pageIndex === 14) {
        const renderedText = canvas
          ? await page.evaluate(() => (window as unknown as { __hwpxLensFillText: string[] })
              .__hwpxLensFillText.join(""))
          : await card.locator(".rendered-svg > svg").textContent() ?? "";
        assertCaptionText(renderedText);
      }
      const pageNumber = String(pageIndex + 1).padStart(3, "0");
      const renderer = canvas ? "canvas2d" : "app-svg";
      await card.screenshot({
        path: path.join(outputDirectory, `page-${pageNumber}-${renderer}.png`),
      });
    }
  } finally {
    await page.close();
  }
}

function assertCaptionSequences(markup: string): void {
  const parsed = new JSDOM(markup, { contentType: "image/svg+xml" });
  assertCaptionText(parsed.window.document.documentElement.textContent ?? "");
}

function assertCaptionText(value: string): void {
  const compact = value.replace(/\s+/gu, "");
  expect(compact).toContain("그림2-3.");
  expect(compact).toContain("표2-2.");
}

async function assertSvgReferencesArePageLocal(card: import("@playwright/test").Locator): Promise<void> {
  const failures = await card.locator(".rendered-svg > svg").evaluate((svg) => {
    const localIds = new Set(Array.from(svg.querySelectorAll("[id]"), (element) => element.id));
    const missing = new Set<string>();
    for (const element of Array.from(svg.querySelectorAll("*"))) {
      for (const attribute of Array.from(element.attributes)) {
        for (const match of attribute.value.matchAll(/url\(\s*['"]?#([^)'"\s]+)['"]?\s*\)/gu)) {
          if (!localIds.has(match[1])) missing.add(match[1]);
        }
        if ((attribute.localName === "href" || attribute.name.endsWith(":href")) && attribute.value.startsWith("#")) {
          const id = attribute.value.slice(1);
          if (!localIds.has(id)) missing.add(id);
        }
      }
    }
    return Array.from(missing);
  });
  expect(failures, "Every SVG fragment reference must resolve inside its own page.").toEqual([]);
}

async function loadPair(page: Page, bytes: Uint8Array): Promise<void> {
  const file = {
    name: "local-fixture.hwpx",
    mimeType: "application/zip",
    buffer: Buffer.from(bytes),
  };
  await page.locator('input[type="file"]').nth(0).setInputFiles(file);
  await page.locator('input[type="file"]').nth(1).setInputFiles(file);
}
