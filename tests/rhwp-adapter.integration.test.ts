import { beforeAll, describe, expect, it } from "vitest";
import { createRhwpDocument } from "@hwpx-lens/hwpx-adapter";
import { RhwpDiffAdapter } from "../packages/hwpx-adapter/src/rhwp-diff-adapter";
import { RhwpTextDiffAdapter } from "../packages/hwpx-adapter/src/rhwp-text-diff-adapter";
import { loadBodyTextFixture } from "./helpers/hwpx-fixture";
import { createTableFixture, initializeRhwpTestRuntime } from "./helpers/rhwp-test-runtime";

beforeAll(async () => {
  await initializeRhwpTestRuntime();
});

describe("rhwp public adapter contract", () => {
  it("loads, snapshots, renders, and locates a public body paragraph", async () => {
    const document = await createRhwpDocument(await loadBodyTextFixture());
    try {
      const snapshot = await document.createSnapshot();
      const paragraph = snapshot.paragraphs.find((item) => item.text === "11223344");
      expect(paragraph).toBeDefined();
      expect(document.rendering.pageCount()).toBe(1);

      const page = await document.rendering.renderPage(0);
      expect(page.svg).toMatch(/^<svg/);
      expect(page.svg).not.toMatch(/<script|(?:href|src)=["']https?:\/\//i);

      const target = await document.rendering.resolveVisualTarget({
        target: "body-text",
        sectionIndex: paragraph!.sectionIndex,
        paragraphIndex: paragraph!.paragraphIndex,
        textRange: { start: 0, end: paragraph!.text.length },
        confidence: "exact",
      });
      const size = await document.rendering.pageSize(target.pageIndex);
      expect(target.rects.length).toBeGreaterThan(0);
      expect(target.rects.every((rect) => rect.x >= 0 && rect.y >= 0)).toBe(true);
      expect(target.rects.every((rect) => rect.x + rect.width <= size.width + 0.1)).toBe(true);
      expect(target.rects.every((rect) => rect.y + rect.height <= size.height + 0.1)).toBe(true);
    } finally {
      document.dispose();
    }
  });

  it("maps two text-only modifications on both documents", async () => {
    const originalBytes = await loadBodyTextFixture();
    const modifiedBytes = await loadBodyTextFixture("modified");
    const original = await createRhwpDocument(originalBytes);
    const modified = await createRhwpDocument(modifiedBytes);

    try {
      const changes = await new RhwpTextDiffAdapter().compare(
        await original.createSnapshot(),
        await modified.createSnapshot(),
      );
      expect(changes).toHaveLength(2);
      expect(changes.every((change) => change.type === "text" && change.kind === "modified")).toBe(
        true,
      );

      for (const change of changes) {
        const originalTarget = await original.rendering.resolveVisualTarget(change.originalAnchor!);
        const modifiedTarget = await modified.rendering.resolveVisualTarget(change.modifiedAnchor!);
        expect(originalTarget.rects.length).toBeGreaterThan(0);
        expect(modifiedTarget.rects.length).toBeGreaterThan(0);
      }
    } finally {
      original.dispose();
      modified.dispose();
    }
  });

  it("extracts, compares, and locates a changed table cell using public APIs", async () => {
    const original = await createRhwpDocument(await createTableFixture("변경 전 셀"));
    const modified = await createRhwpDocument(await createTableFixture("변경 후 셀"));

    try {
      const changes = await new RhwpDiffAdapter().compare(
        await original.createSnapshot(),
        await modified.createSnapshot(),
      );
      const tableChanges = changes.filter((change) => change.type === "table");
      expect(tableChanges).toHaveLength(1);
      expect(tableChanges[0]).toMatchObject({
        kind: "modified",
        detail: "cell-text",
        originalText: "변경 전 셀",
        modifiedText: "변경 후 셀",
      });

      const originalTarget = await original.rendering.resolveVisualTarget(
        tableChanges[0].originalAnchor!,
      );
      const modifiedTarget = await modified.rendering.resolveVisualTarget(
        tableChanges[0].modifiedAnchor!,
      );
      expect(originalTarget.rects.length).toBeGreaterThan(0);
      expect(modifiedTarget.rects.length).toBeGreaterThan(0);
    } finally {
      original.dispose();
      modified.dispose();
    }
  });

  it("treats a re-zipped semantic equivalent as unchanged and frees resources", async () => {
    const bytes = await loadBodyTextFixture();
    const repacked = await loadBodyTextFixture("repacked");
    const original = await createRhwpDocument(bytes);
    const equivalent = await createRhwpDocument(repacked);
    const originalRendering = original.rendering;

    expect(
      await new RhwpTextDiffAdapter().compare(
        await original.createSnapshot(),
        await equivalent.createSnapshot(),
      ),
    ).toEqual([]);

    original.dispose();
    equivalent.dispose();
    expect(() => originalRendering.pageCount()).toThrow(/닫힌 HWPX/);
  });
});
