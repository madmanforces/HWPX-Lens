import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, expect, it } from "vitest";
import { createRhwpCanvasPocDocument } from "@hwpx-lens/hwpx-adapter";
import type {
  NativeInteractionAdapter,
  NativeSelection,
} from "@hwpx-lens/lens-core";
import { initializeRhwpTestRuntime } from "./helpers/rhwp-test-runtime";

beforeAll(initializeRhwpTestRuntime);

const localFixture = process.env.HWPX_LENS_LOCAL_FIXTURE;

it.runIf(Boolean(localFixture))(
  "audits Canvas/native mapping and copy on a local-only fixture",
  async () => {
    const fixturePath = path.resolve(localFixture!);
    const fixtureRoot = `${path.resolve("local-fixtures")}${path.sep}`;
    expect(fixturePath.startsWith(fixtureRoot)).toBe(true);

    const startedAt = performance.now();
    const document = await createRhwpCanvasPocDocument(await readFile(fixturePath));
    try {
      expect(document.interaction?.kind).toBe("native");
      const interaction = document.interaction as NativeInteractionAdapter;
      const snapshot = await document.createSnapshot();
      const paragraph = snapshot.paragraphs.find((candidate) => candidate.text.trim().length >= 2);
      expect(paragraph).toBeDefined();
      if (!paragraph) return;

      const endOffset = Math.min(paragraph.text.length, 24);
      const target = await interaction.resolveTextTarget({
        target: "body-text",
        sectionIndex: paragraph.sectionIndex,
        paragraphIndex: paragraph.paragraphIndex,
        textRange: { start: 0, end: endOffset },
      });
      expect(target.rects.length).toBeGreaterThan(0);

      const selection: NativeSelection = {
        anchor: {
          target: "body-text",
          pageIndex: target.pageIndex,
          sectionIndex: paragraph.sectionIndex,
          paragraphIndex: paragraph.paragraphIndex,
          charOffset: 0,
        },
        focus: {
          target: "body-text",
          pageIndex: target.pageIndex,
          sectionIndex: paragraph.sectionIndex,
          paragraphIndex: paragraph.paragraphIndex,
          charOffset: endOffset,
        },
      };
      expect(interaction.getSelectionRects(selection).length).toBeGreaterThan(0);
      expect(interaction.copySelection(selection).plainText).toBe(
        paragraph.text.slice(0, endOffset),
      );

      const samplePages = [...new Set([0, 3, 15, document.rendering.pageCount() - 1])]
        .filter((pageIndex) => pageIndex >= 0 && pageIndex < document.rendering.pageCount());
      for (const pageIndex of samplePages) {
        const page = await document.rendering.renderPage(pageIndex);
        expect(page.kind).toBe("canvas2d");
        if (page.kind === "canvas2d") expect(page.paint).toBeTypeOf("function");
      }

      console.log(JSON.stringify({
        fileLabel: "local-only-fixture",
        pageCount: document.rendering.pageCount(),
        paragraphCount: snapshot.paragraphs.length,
        tableCount: snapshot.tables.length,
        mappedRectCount: target.rects.length,
        copyMatchesSemanticRange: true,
        sampledCanvasPageCount: samplePages.length,
        totalMs: Number((performance.now() - startedAt).toFixed(3)),
      }, null, 2));
    } finally {
      document.dispose();
    }
  },
  120_000,
);
