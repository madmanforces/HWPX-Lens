import { HwpDocument } from "@rhwp/core";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { RhwpNativeInteractionAdapter } from "../packages/hwpx-adapter/src/rhwp-native-interaction-adapter";
import type { NativeSelection } from "@hwpx-lens/lens-core";
import { createFidelityFixture } from "./helpers/rhwp-fidelity-fixtures";
import { initializeRhwpTestRuntime } from "./helpers/rhwp-test-runtime";

interface LayoutRun {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  secIdx?: number;
  paraIdx?: number;
  charStart?: number;
  parentParaIdx?: number;
  controlIdx?: number;
  cellIdx?: number;
  cellParaIdx?: number;
  cellPath?: Array<{ controlIndex: number; cellIndex: number; cellParaIndex: number }>;
}

const documents: HwpDocument[] = [];

beforeAll(initializeRhwpTestRuntime);
afterEach(() => {
  while (documents.length > 0) documents.pop()?.free();
});

describe("rhwp native interaction public API", () => {
  it("hit-tests, highlights and copies a body range in logical order", async () => {
    const document = new HwpDocument(await createFidelityFixture("simple-paragraph"));
    documents.push(document);
    const adapter = new RhwpNativeInteractionAdapter(document);
    const run = findRun(document, (candidate) => candidate.text.includes("장비의 전원을"));
    const hit = adapter.hitTest(0, run.x + Math.min(run.w / 2, 8), run.y + run.h / 2);
    expect(hit.target).toBe("body-text");
    if (hit.target !== "body-text") return;

    const selection: NativeSelection = {
      anchor: { ...hit, paragraphIndex: run.paraIdx!, charOffset: run.charStart! },
      focus: {
        ...hit,
        paragraphIndex: run.paraIdx!,
        charOffset: run.charStart! + run.text.length,
      },
    };
    const rects = adapter.getSelectionRects(selection);
    expect(rects.length).toBeGreaterThan(0);
    expect(Math.min(...rects.map((rect) => rect.x))).toBeGreaterThanOrEqual(run.x - 1);
    expect(Math.max(...rects.map((rect) => rect.x + rect.width))).toBeLessThanOrEqual(run.x + run.w + 1);
    expect(Math.max(...rects.map((rect) => rect.height))).toBeGreaterThanOrEqual(run.h * 0.75);
    expect(adapter.copySelection(selection).plainText).toBe(run.text);
  });

  it("uses cell context for table text selection and copy", async () => {
    const document = new HwpDocument(await createFidelityFixture("simple-table"));
    documents.push(document);
    const adapter = new RhwpNativeInteractionAdapter(document);
    const run = findRun(document, (candidate) =>
      candidate.text.includes("항목") && candidate.parentParaIdx !== undefined,
    );
    const hit = adapter.hitTest(0, run.x + Math.min(run.w / 2, 6), run.y + run.h / 2);
    expect(hit.target).toBe("table-cell-text");
    if (hit.target !== "table-cell-text") return;

    const selection: NativeSelection = {
      anchor: { ...hit, charOffset: run.charStart ?? 0 },
      focus: { ...hit, charOffset: (run.charStart ?? 0) + run.text.length },
    };
    const rects = adapter.getSelectionRects(selection);
    expect(rects.length).toBeGreaterThan(0);
    expect(Math.min(...rects.map((rect) => rect.x))).toBeGreaterThanOrEqual(run.x - 1);
    expect(Math.max(...rects.map((rect) => rect.x + rect.width))).toBeLessThanOrEqual(run.x + run.w + 1);
    expect(adapter.copySelection(selection).plainText).toBe(run.text);
  });

  it("selects one Korean character at a time from pointer midpoints", async () => {
    const document = new HwpDocument(await createFidelityFixture("simple-paragraph"));
    documents.push(document);
    const adapter = new RhwpNativeInteractionAdapter(document);
    const run = findRun(document, (candidate) => candidate.text.includes("장비의 전원을"));
    const phrase = "전원을";
    const phraseStart = run.charStart! + run.text.indexOf(phrase);

    for (let index = 0; index < phrase.length; index += 1) {
      const position = {
        target: "body-text" as const,
        pageIndex: 0,
        sectionIndex: run.secIdx ?? 0,
        paragraphIndex: run.paraIdx!,
        charOffset: phraseStart + index,
      };
      const geometry = adapter.getCharacterGeometry(position);
      expect(geometry).toBeDefined();
      if (!geometry) continue;
      const rect = geometry.rects[0];
      const midpoint = (geometry.before.x + geometry.after.x) / 2;
      const quarter = Math.max(Math.abs(geometry.after.x - geometry.before.x) * 0.24, 0.1);
      const anchor = adapter.hitTest(rect.pageIndex, midpoint - quarter, rect.y + rect.height / 2);
      const focus = adapter.hitTest(rect.pageIndex, midpoint + quarter, rect.y + rect.height / 2);
      expect(anchor.charOffset).toBe(position.charOffset);
      expect(focus.charOffset).toBe(position.charOffset + 1);
      expect(adapter.copySelection({ anchor, focus }).plainText).toBe(phrase[index]);
    }
  });

  it("keeps exact Korean character and whitespace geometry on the semantic axis", async () => {
    const document = new HwpDocument(await createFidelityFixture("simple-paragraph"));
    documents.push(document);
    const adapter = new RhwpNativeInteractionAdapter(document);
    const run = findRun(document, (candidate) => candidate.text.includes("장비의 전원을"));
    const paragraphIndex = run.paraIdx!;
    const runStart = run.charStart!;
    const phraseStart = run.text.indexOf("전원을");
    expect(phraseStart).toBeGreaterThanOrEqual(0);

    const positions = Array.from("전원을").map((_, index) => ({
      target: "body-text" as const,
      pageIndex: 0,
      sectionIndex: run.secIdx ?? 0,
      paragraphIndex,
      charOffset: runStart + phraseStart + index,
    }));
    const geometry = positions.map((position) => adapter.getCharacterGeometry(position));
    expect(geometry.every(Boolean)).toBe(true);
    for (let index = 0; index < geometry.length - 1; index += 1) {
      const current = geometry[index]!;
      const next = geometry[index + 1]!;
      expect(current.after.position.charOffset).toBe(next.before.position.charOffset);
      expect(current.rects.length).toBeGreaterThan(0);

      const rect = current.rects[0];
      const midpoint = (current.before.x + current.after.x) / 2;
      const beforeMidpoint = adapter.hitTest(
        rect.pageIndex,
        midpoint - Math.max(Math.abs(current.after.x - current.before.x) * 0.1, 0.1),
        rect.y + rect.height / 2,
      );
      const afterMidpoint = adapter.hitTest(
        rect.pageIndex,
        midpoint + Math.max(Math.abs(current.after.x - current.before.x) * 0.1, 0.1),
        rect.y + rect.height / 2,
      );
      expect(beforeMidpoint.charOffset).toBe(current.position.charOffset);
      expect(afterMidpoint.charOffset).toBe(current.after.position.charOffset);
    }

    const exactSelection: NativeSelection = {
      anchor: positions[0],
      focus: { ...positions.at(-1)!, charOffset: positions.at(-1)!.charOffset + 1 },
    };
    expect(adapter.copySelection(exactSelection).plainText).toBe("전원을");

    const whitespaceIndex = run.text.indexOf(" ");
    expect(whitespaceIndex).toBeGreaterThanOrEqual(0);
    const whitespace = adapter.getCharacterGeometry({
      ...positions[0],
      charOffset: runStart + whitespaceIndex,
    });
    expect(whitespace?.rects.length).toBeGreaterThan(0);
    expect(whitespace?.after.position.charOffset).toBe(runStart + whitespaceIndex + 1);
  });

  it("copies exact partial and multi-line semantic ranges without per-character newlines", async () => {
    const document = new HwpDocument(await createFidelityFixture("multiline-paragraph"));
    documents.push(document);
    const adapter = new RhwpNativeInteractionAdapter(document);
    const first = findRun(document, (candidate) => candidate.text.includes("장비의 전원을"));
    const page = JSON.parse(document.getPageTextLayout(0)) as { runs?: LayoutRun[] };
    const later = page.runs?.find((candidate) =>
      candidate.paraIdx === first.paraIdx &&
      candidate.charStart !== undefined &&
      first.charStart !== undefined &&
      candidate.charStart > first.charStart,
    );
    expect(later).toBeDefined();
    if (!later) return;

    const selection: NativeSelection = {
      anchor: {
        target: "body-text",
        pageIndex: 0,
        sectionIndex: first.secIdx ?? 0,
        paragraphIndex: first.paraIdx!,
        charOffset: first.charStart!,
      },
      focus: {
        target: "body-text",
        pageIndex: 0,
        sectionIndex: later.secIdx ?? 0,
        paragraphIndex: later.paraIdx!,
        charOffset: later.charStart! + later.text.length,
      },
    };
    const copied = adapter.copySelection(selection).plainText;
    expect(copied).toContain(first.text.trim());
    expect(copied).toContain(later.text.trim());
    expect(copied).not.toMatch(/\S\r?\n\S\r?\n\S/u);
  });
});

function findRun(document: HwpDocument, predicate: (run: LayoutRun) => boolean): LayoutRun {
  for (let pageIndex = 0; pageIndex < document.pageCount(); pageIndex += 1) {
    const parsed = JSON.parse(document.getPageTextLayout(pageIndex)) as { runs?: LayoutRun[] };
    const run = parsed.runs?.find(predicate);
    if (run) return run;
  }
  throw new Error("시험할 텍스트 run을 찾지 못했습니다.");
}
