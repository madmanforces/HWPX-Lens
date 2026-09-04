import { HwpDocument } from "@rhwp/core";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createRhwpCanvasPocDocument,
  createRhwpInteractionPocDocument,
} from "@hwpx-lens/hwpx-adapter";
import {
  createFidelityFixture,
  type FidelityFixtureName,
} from "./helpers/rhwp-fidelity-fixtures";
import { loadBodyTextFixture } from "./helpers/hwpx-fixture";
import { initializeRhwpTestRuntime } from "./helpers/rhwp-test-runtime";

beforeAll(initializeRhwpTestRuntime);

const TABLE_CASES: Array<{
  name: FidelityFixtureName;
  rows: number;
  columns: number;
  minimumPages?: number;
}> = [
  { name: "simple-table", rows: 3, columns: 3 },
  { name: "merged-cells-horizontal", rows: 3, columns: 3 },
  { name: "merged-cells-vertical", rows: 3, columns: 3 },
  { name: "merged-cells-complex", rows: 4, columns: 4 },
  { name: "long-table", rows: 28, columns: 3, minimumPages: 2 },
  { name: "table-cross-page", rows: 55, columns: 2, minimumPages: 2 },
  { name: "nested-paragraphs-in-cell", rows: 2, columns: 2 },
  { name: "different-cell-padding", rows: 2, columns: 2 },
  { name: "border-variations", rows: 2, columns: 2 },
  { name: "table-with-image", rows: 2, columns: 2 },
  { name: "table-near-page-bottom", rows: 8, columns: 2 },
];

describe("table fidelity gate", () => {
  for (const testCase of TABLE_CASES) {
    it(`preserves table structure and visible cell content for ${testCase.name}`, async () => {
      const bytes = await createFidelityFixture(testCase.name);
      const svgDocument = await createRhwpInteractionPocDocument(bytes);
      const canvasDocument = await createRhwpCanvasPocDocument(bytes);
      try {
        const snapshot = await svgDocument.createSnapshot();
        const table = snapshot.tables[0];
        expect(table).toBeDefined();
        expect(table.rowCount).toBe(testCase.rows);
        expect(table.columnCount).toBe(testCase.columns);
        expect(svgDocument.rendering.pageCount()).toBeGreaterThanOrEqual(testCase.minimumPages ?? 1);
        expect(canvasDocument.rendering.pageCount()).toBe(svgDocument.rendering.pageCount());

        const semanticCellBlocks = new Set<string>();
        let imageElements = 0;
        for (let pageIndex = 0; pageIndex < svgDocument.rendering.pageCount(); pageIndex += 1) {
          const [svgPage, canvasPage, semanticPage] = await Promise.all([
            svgDocument.rendering.renderPage(pageIndex),
            canvasDocument.rendering.renderPage(pageIndex),
            svgDocument.interaction!.getTextPage(pageIndex),
          ]);
          expect(svgPage.kind).toBe("svg");
          expect(canvasPage.kind).toBe("canvas2d");
          expect(Math.abs(canvasPage.viewBox[2] - svgPage.viewBox[2])).toBeLessThan(0.1);
          expect(Math.abs(canvasPage.viewBox[3] - svgPage.viewBox[3])).toBeLessThan(0.1);
          if (svgPage.kind === "svg") imageElements += (svgPage.svg.match(/<image\b/gu) ?? []).length;
          for (const run of semanticPage.runs) {
            if (run.blockId.startsWith("cell-")) semanticCellBlocks.add(run.blockId);
          }
        }

        expect(semanticCellBlocks.size).toBeGreaterThanOrEqual(table.cells.length);
        if (testCase.name === "merged-cells-horizontal") {
          expect(table.cells.some((cell) => cell.columnSpan >= 2)).toBe(true);
        }
        if (testCase.name === "merged-cells-vertical") {
          expect(table.cells.some((cell) => cell.rowSpan >= 2)).toBe(true);
        }
        if (testCase.name === "merged-cells-complex") {
          expect(table.cells.some((cell) => cell.columnSpan >= 3)).toBe(true);
          expect(table.cells.some((cell) => cell.rowSpan >= 2)).toBe(true);
        }
        if (testCase.name === "nested-paragraphs-in-cell") {
          expect(table.cells.some((cell) => cell.paragraphs.length >= 2)).toBe(true);
        }
        if (testCase.name === "different-cell-padding" || testCase.name === "border-variations") {
          const reopened = new HwpDocument(bytes);
          try {
            const first = JSON.parse(reopened.getCellProperties(
              table.sectionIndex,
              table.paragraphIndex,
              table.controlIndex,
              0,
            )) as Record<string, unknown>;
            const last = JSON.parse(reopened.getCellProperties(
              table.sectionIndex,
              table.paragraphIndex,
              table.controlIndex,
              table.cells.length - 1,
            )) as Record<string, unknown>;
            if (testCase.name === "different-cell-padding") {
              expect(first.paddingLeft).not.toBe(last.paddingLeft);
              expect(first.paddingBottom).not.toBe(last.paddingBottom);
            } else {
              expect(first.borderLeft).not.toEqual(last.borderLeft);
            }
          } finally {
            reopened.free();
          }
        }
        if (testCase.name === "table-with-image") expect(imageElements).toBeGreaterThan(0);
      } finally {
        svgDocument.dispose();
        canvasDocument.dispose();
      }
    }, 30_000);
  }

  it("keeps the missing native table-caption creation surface explicit", async () => {
    const document = new HwpDocument(await loadBodyTextFixture());
    try {
      const created = JSON.parse(document.createTable(0, 1, 0, 2, 2)) as {
        ok: boolean;
        paraIdx: number;
        controlIdx: number;
      };
      expect(created.ok).toBe(true);
      let attached = false;
      try {
        const result = JSON.parse(document.attachCaptionAt(created.paraIdx, created.controlIdx)) as { ok?: unknown };
        attached = result.ok === true;
      } catch {
        attached = false;
      }
      expect(attached).toBe(false);
    } finally {
      document.free();
    }
  });
});

const IMAGE_CASES: Array<{ name: FidelityFixtureName; mime: string }> = [
  { name: "image", mime: "image/png" },
  { name: "jpeg-image", mime: "image/jpeg" },
  { name: "transparent-png", mime: "image/png" },
  { name: "image-floating", mime: "image/png" },
  { name: "image-behind-text", mime: "image/png" },
  { name: "image-front-of-text", mime: "image/png" },
  { name: "image-caption", mime: "image/png" },
  { name: "resized-image", mime: "image/png" },
  { name: "cropped-image", mime: "image/png" },
];

describe("image and caption fidelity gate", () => {
  for (const testCase of IMAGE_CASES) {
    it(`preserves local image payload for ${testCase.name}`, async () => {
      const document = await createRhwpInteractionPocDocument(await createFidelityFixture(testCase.name));
      try {
        let markup = "";
        for (let pageIndex = 0; pageIndex < document.rendering.pageCount(); pageIndex += 1) {
          const page = await document.rendering.renderPage(pageIndex);
          if (page.kind === "svg") markup += page.svg;
        }
        expect(markup).toContain(`<image`);
        expect(markup).toContain(`data:${testCase.mime}`);
        expect(markup).not.toContain("data-hwpx-lens-image-status=\"blocked\"");

        if (["image-floating", "image-behind-text", "image-front-of-text", "resized-image", "cropped-image"].includes(testCase.name)) {
          const reopened = new HwpDocument(await createFidelityFixture(testCase.name));
          try {
            const controls = JSON.parse(reopened.getControls()) as Array<{
              ctrlId?: unknown;
              para?: unknown;
              controlIndex?: unknown;
            }>;
            const picture = controls.find((control) => control.ctrlId === "gso");
            expect(picture).toBeDefined();
            if (!picture || !Number.isInteger(picture.para) || !Number.isInteger(picture.controlIndex)) return;
            const properties = JSON.parse(reopened.getPictureProperties(
              0,
              picture.para as number,
              picture.controlIndex as number,
            )) as Record<string, unknown>;
            if (testCase.name === "image-floating" || testCase.name === "image-behind-text" || testCase.name === "image-front-of-text") {
              expect(properties.treatAsChar).toBe(false);
            }
            if (testCase.name === "resized-image") {
              expect(properties.width).not.toBe(properties.height);
            }
            if (testCase.name === "cropped-image") {
              expect(properties.cropLeft).toBeDefined();
              expect(properties.cropRight).toBeDefined();
            }
          } finally {
            reopened.free();
          }
        }

        if (testCase.name === "image-caption") {
          let captionCount = 0;
          for (let pageIndex = 0; pageIndex < document.rendering.pageCount(); pageIndex += 1) {
            const page = await document.interaction!.getTextPage(pageIndex);
            captionCount += page.runs.filter((run) => /^(그림|표)\s/u.test(run.text)).length;
          }
          expect(captionCount).toBeGreaterThan(0);
        }
      } finally {
        document.dispose();
      }
    }, 30_000);
  }
});
