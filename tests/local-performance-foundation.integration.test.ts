import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, expect, it } from "vitest";
import {
  createRhwpCanvasPocDocument,
  createRhwpDocument,
  RhwpTextDiffAdapter,
} from "@hwpx-lens/hwpx-adapter";
import { createParagraphSnapshot, type DocumentSnapshot } from "@hwpx-lens/lens-core";
import { initializeRhwpTestRuntime } from "./helpers/rhwp-test-runtime";

beforeAll(initializeRhwpTestRuntime);

const localFixture = process.env.HWPX_LENS_LOCAL_FIXTURE;

it.runIf(Boolean(localFixture))(
  "records a privacy-safe two-document local performance profile",
  async () => {
    const fixturePath = path.resolve(localFixture!);
    const fixtureRoot = `${path.resolve("local-fixtures")}${path.sep}`;
    expect(fixturePath.startsWith(fixtureRoot)).toBe(true);
    const bytes = await readFile(fixturePath);
    const memoryBefore = process.memoryUsage();

    const originalOpen = await measure(() => createRhwpCanvasPocDocument(bytes));
    const modifiedOpen = await measure(() => createRhwpCanvasPocDocument(bytes));
    const svgOpen = await measure(() => createRhwpDocument(bytes));
    const original = originalOpen.value;
    const modified = modifiedOpen.value;
    const svg = svgOpen.value;

    try {
      const originalSnapshot = await measure(() => original.createSnapshot());
      const modifiedSnapshot = await measure(() => modified.createSnapshot());
      const changedSnapshot = withOneSameLengthChange(modifiedSnapshot.value);
      const compared = await measure(() =>
        new RhwpTextDiffAdapter().compare(originalSnapshot.value, changedSnapshot),
      );
      expect(compared.value).toHaveLength(1);

      const change = compared.value[0];
      const originalAnchor = change.originalAnchor ?? change.originalContextAnchor;
      const modifiedAnchor = change.modifiedAnchor ?? change.modifiedContextAnchor;
      const mapped = await measure(async () => Promise.all([
        originalAnchor ? original.interaction!.resolveTextTarget(originalAnchor as never) : undefined,
        modifiedAnchor ? modified.interaction!.resolveTextTarget(modifiedAnchor as never) : undefined,
      ]));
      expect(mapped.value.every((target) => target?.rects.length)).toBe(true);

      const pageMetadata = await measure(async () => {
        const sizes = [];
        for (let pageIndex = 0; pageIndex < original.rendering.pageCount(); pageIndex += 1) {
          sizes.push(await original.rendering.pageSize(pageIndex));
        }
        return sizes;
      });
      const samplePages = [...new Set([0, 3, 15, original.rendering.pageCount() - 1])]
        .filter((pageIndex) => pageIndex >= 0 && pageIndex < original.rendering.pageCount());
      const canvasDescriptors = await measure(async () => Promise.all(
        samplePages.map((pageIndex) => original.rendering.renderPage(pageIndex)),
      ));
      const svgPages = await measure(async () => Promise.all(
        samplePages.map((pageIndex) => svg.rendering.renderPage(pageIndex)),
      ));
      expect(canvasDescriptors.value.every((page) => page.kind === "canvas2d")).toBe(true);
      expect(svgPages.value.every((page) => page.kind === "svg")).toBe(true);

      const snapshot = originalSnapshot.value;
      const memoryAfter = process.memoryUsage();
      const result = {
        schemaVersion: 1,
        fixture: "local-only-fixture",
        compressedBytes: bytes.byteLength,
        pageCount: original.rendering.pageCount(),
        paragraphCount: snapshot.paragraphs.length,
        tableCount: snapshot.tables.length,
        tableCellCount: snapshot.tables.reduce((total, table) => total + table.cells.length, 0),
        imageCount: snapshot.images?.length ?? 0,
        timingsMs: {
          openOriginal: originalOpen.durationMs,
          openModified: modifiedOpen.durationMs,
          openSvgDiagnostic: svgOpen.durationMs,
          snapshotOriginal: originalSnapshot.durationMs,
          snapshotModified: modifiedSnapshot.durationMs,
          diffOneChange: compared.durationMs,
          mapOneChangeBothSides: mapped.durationMs,
          allPageMetadata: pageMetadata.durationMs,
          fourCanvasDescriptors: canvasDescriptors.durationMs,
          fourSvgPages: svgPages.durationMs,
        },
        processMemoryMiB: {
          rssBefore: mib(memoryBefore.rss),
          rssAfter: mib(memoryAfter.rss),
          heapUsedBefore: mib(memoryBefore.heapUsed),
          heapUsedAfter: mib(memoryAfter.heapUsed),
          externalBefore: mib(memoryBefore.external),
          externalAfter: mib(memoryAfter.external),
        },
      };
      const outputPath = path.resolve("test-results/performance/local-performance-foundation.json");
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
      expect(result.timingsMs.diffOneChange).toBeLessThan(2_000);
    } finally {
      original.dispose();
      modified.dispose();
      svg.dispose();
    }
  },
  120_000,
);

async function measure<T>(operation: () => T | Promise<T>): Promise<{ value: T; durationMs: number }> {
  const startedAt = performance.now();
  const value = await operation();
  return { value, durationMs: Number((performance.now() - startedAt).toFixed(3)) };
}

function withOneSameLengthChange(snapshot: DocumentSnapshot): DocumentSnapshot {
  const paragraphIndex = snapshot.paragraphs.findIndex((paragraph) => paragraph.text.length >= 2);
  if (paragraphIndex < 0) throw new Error("성능 fixture에 변경 가능한 본문이 없습니다.");
  const paragraph = snapshot.paragraphs[paragraphIndex];
  const last = paragraph.text.at(-1) === "가" ? "나" : "가";
  const replacement = createParagraphSnapshot(
    paragraph.sectionIndex,
    paragraph.paragraphIndex,
    `${paragraph.text.slice(0, -1)}${last}`,
  );
  if (!replacement) throw new Error("성능 fixture 변경 문단을 만들지 못했습니다.");
  const paragraphs = snapshot.paragraphs.slice();
  paragraphs[paragraphIndex] = replacement;
  return { paragraphs, tables: snapshot.tables, images: snapshot.images };
}

function mib(bytes: number): number {
  return Number((bytes / 1024 / 1024).toFixed(2));
}
