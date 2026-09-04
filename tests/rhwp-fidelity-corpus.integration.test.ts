import { beforeAll, describe, expect, it } from "vitest";
import { createRhwpInteractionPocDocument } from "@hwpx-lens/hwpx-adapter";
import {
  createFidelityFixture,
  FIDELITY_FIXTURE_NAMES,
} from "./helpers/rhwp-fidelity-fixtures";
import { initializeRhwpTestRuntime } from "./helpers/rhwp-test-runtime";

beforeAll(initializeRhwpTestRuntime);

describe("SVG interaction fidelity corpus", () => {
  for (const name of FIDELITY_FIXTURE_NAMES) {
    it(`opens ${name} with visual and semantic pages`, async () => {
      const document = await createRhwpInteractionPocDocument(await createFidelityFixture(name));
      try {
        expect(document.rendering.pageCount()).toBeGreaterThan(0);
        const page = await document.rendering.renderPage(0);
        const text = await document.interaction!.getTextPage(0);
        expect(page.kind).toBe("svg");
        if (page.kind !== "svg") throw new Error("SVG PoC가 SVG 페이지를 반환하지 않았습니다.");
        expect(page.svg).toMatch(/^<svg/);
        expect(text.runs.length).toBeGreaterThan(0);
        expect(text.runs.every((run) => run.rect.pageIndex === 0)).toBe(true);
      } finally {
        document.dispose();
      }
    }, 30_000);
  }

  it("records repeatable renderer and interaction metrics for every fixture", async () => {
    const metrics = [];
    for (const name of FIDELITY_FIXTURE_NAMES) {
      const document = await createRhwpInteractionPocDocument(await createFidelityFixture(name));
      try {
        const snapshot = await document.createSnapshot();
        const paragraphText = new Map(snapshot.paragraphs.map((paragraph) => [
          `${paragraph.sectionIndex}:${paragraph.paragraphIndex}`,
          paragraph.text,
        ]));
        let bodyRunCount = 0;
        let mappedRunCount = 0;
        let cellRunCount = 0;
        let imageElementCount = 0;
        let captionTokenCount = 0;
        let mappingDelta = 0;
        let layoutMs = 0;
        let renderMs = 0;
        const fonts = new Set<string>();
        for (let pageIndex = 0; pageIndex < document.rendering.pageCount(); pageIndex += 1) {
          let startedAt = performance.now();
          const semanticPage = await document.interaction!.getTextPage(pageIndex);
          layoutMs += performance.now() - startedAt;
          startedAt = performance.now();
          const visualPage = await document.rendering.renderPage(pageIndex);
          renderMs += performance.now() - startedAt;
          if (visualPage.kind !== "svg") {
            throw new Error("SVG fidelity corpus가 SVG 페이지를 반환하지 않았습니다.");
          }
          imageElementCount += (visualPage.svg.match(/<image\b/g) ?? []).length;
          for (const run of semanticPage.runs) {
            fonts.add(run.style.fontFamily);
            if (/^(그림|표)\s/u.test(run.text)) captionTokenCount += 1;
            if (run.blockId.startsWith("cell-")) cellRunCount += 1;
            const range = run.anchor?.textRange;
            if (!run.anchor || !range) continue;
            bodyRunCount += 1;
            const source = paragraphText.get(`${run.anchor.sectionIndex}:${run.anchor.paragraphIndex}`);
            if (source?.slice(range.start, range.end) !== run.text) continue;
            mappedRunCount += 1;
            if (mappedRunCount === 1) {
              const target = await document.interaction!.resolveTextTarget(run.anchor);
              const rect = target.rects[0];
              mappingDelta = Math.max(
                Math.abs(rect.x - run.rect.x),
                Math.abs(rect.y - run.rect.y),
                Math.abs(rect.width - run.rect.width),
                Math.abs(rect.height - run.rect.height),
              );
            }
          }
        }
        metrics.push({
          name,
          pages: document.rendering.pageCount(),
          bodyRunCount,
          mappedRunCount,
          cellRunCount,
          imageElementCount,
          captionTokenCount,
          fontCount: fonts.size,
          mappingDelta,
          layoutMs: Number(layoutMs.toFixed(3)),
          renderMs: Number(renderMs.toFixed(3)),
        });
      } finally {
        document.dispose();
      }
    }
    console.log(JSON.stringify(metrics, null, 2));
    expect(metrics.every((metric) => metric.mappedRunCount === metric.bodyRunCount)).toBe(true);
    expect(metrics.every((metric) => metric.mappingDelta <= 0.5)).toBe(true);
  }, 60_000);
});
