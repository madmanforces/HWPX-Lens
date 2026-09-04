import { beforeAll, describe, expect, it } from "vitest";
import {
  createRhwpCanvasPocDocument,
  createRhwpInteractionPocDocument,
} from "@hwpx-lens/hwpx-adapter";
import type { NativeInteractionAdapter } from "@hwpx-lens/lens-core";
import {
  createFidelityFixture,
  FIDELITY_FIXTURE_NAMES,
} from "./helpers/rhwp-fidelity-fixtures";
import { initializeRhwpTestRuntime } from "./helpers/rhwp-test-runtime";

beforeAll(initializeRhwpTestRuntime);

describe("Canvas2D/native interaction fidelity corpus", () => {
  for (const name of FIDELITY_FIXTURE_NAMES) {
    it(`keeps ${name} isolated behind Canvas and native adapters`, async () => {
      const bytes = await createFidelityFixture(name);
      const canvasDocument = await createRhwpCanvasPocDocument(bytes);
      const svgDocument = await createRhwpInteractionPocDocument(bytes);
      try {
        expect(canvasDocument.interaction?.kind).toBe("native");
        expect(svgDocument.interaction?.kind).toBe("semantic-text");
        expect(canvasDocument.rendering.pageCount()).toBe(svgDocument.rendering.pageCount());

        for (let pageIndex = 0; pageIndex < canvasDocument.rendering.pageCount(); pageIndex += 1) {
          const [canvasSize, svgSize, canvasPage, svgPage] = await Promise.all([
            canvasDocument.rendering.pageSize(pageIndex),
            svgDocument.rendering.pageSize(pageIndex),
            canvasDocument.rendering.renderPage(pageIndex),
            svgDocument.rendering.renderPage(pageIndex),
          ]);
          expect(canvasSize).toEqual(svgSize);
          expect(canvasPage.kind).toBe("canvas2d");
          expect(svgPage.kind).toBe("svg");
          expect(canvasPage.viewBox[0]).toBe(svgPage.viewBox[0]);
          expect(canvasPage.viewBox[1]).toBe(svgPage.viewBox[1]);
          expect(Math.abs(canvasPage.viewBox[2] - svgPage.viewBox[2])).toBeLessThan(0.1);
          expect(Math.abs(canvasPage.viewBox[3] - svgPage.viewBox[3])).toBeLessThan(0.1);
          if (canvasPage.kind !== "canvas2d") {
            throw new Error("Canvas PoC가 Canvas2D 페이지를 반환하지 않았습니다.");
          }
          expect(canvasPage.paint).toBeTypeOf("function");
        }

        const snapshot = await canvasDocument.createSnapshot();
        expect(snapshot.paragraphs.length + snapshot.tables.length).toBeGreaterThan(0);
        const paragraph = snapshot.paragraphs.find((candidate) => candidate.text.length > 0);
        if (paragraph) {
          const interaction = canvasDocument.interaction as NativeInteractionAdapter;
          const target = await interaction.resolveTextTarget({
            target: "body-text",
            sectionIndex: paragraph.sectionIndex,
            paragraphIndex: paragraph.paragraphIndex,
            textRange: { start: 0, end: Math.min(paragraph.text.length, 8) },
          });
          expect(target.rects.length).toBeGreaterThan(0);
        }
      } finally {
        canvasDocument.dispose();
        svgDocument.dispose();
      }
    }, 30_000);
  }
});
