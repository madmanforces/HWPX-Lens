import { describe, expect, it } from "vitest";
import type { Change, TextChange } from "./types";
import { buildReviewInkModel, diffTextSegments } from "./review-ink";
import {
  REVIEW_INK_TEXT_FIXTURES,
  REVIEW_INK_WHITESPACE_FIXTURES,
} from "./review-ink-fixtures";

function modified(before: string, after: string): TextChange {
  return {
    id: "text-1",
    type: "text",
    kind: "modified",
    originalText: before,
    modifiedText: after,
    originalAnchor: {
      target: "body-text", sectionIndex: 0, paragraphIndex: 4,
      confidence: "exact", textRange: { start: 0, end: before.length },
    },
    modifiedAnchor: {
      target: "body-text", sectionIndex: 0, paragraphIndex: 4,
      confidence: "exact", textRange: { start: 0, end: after.length },
    },
    segments: diffTextSegments(before, after),
  };
}

describe("precision text segments", () => {
  it("isolates the actually changed Korean characters", () => {
    expect(diffTextSegments("전원을 끈다.", "전원을 차단한다.")).toEqual(
      expect.arrayContaining([expect.objectContaining({
        kind: "modified",
        originalRange: { start: 4, end: 5 },
        modifiedRange: { start: 4, end: 7 },
      })]),
    );
  });

  it("keeps multiple edits separate", () => {
    const changed = diffTextSegments("가나다라마바사", "가나X라마Y사")
      .filter((segment) => segment.kind !== "equal");
    expect(changed).toHaveLength(2);
  });

  it("does not split UTF-16 surrogate pairs", () => {
    const changed = diffTextSegments("A😀B", "A🙂B")
      .find((segment) => segment.kind === "modified");
    expect(changed).toMatchObject({
      originalRange: { start: 1, end: 3 },
      modifiedRange: { start: 1, end: 3 },
    });
  });

  it.each(REVIEW_INK_TEXT_FIXTURES)("covers $name", ({ original, modified }) => {
    const changed = diffTextSegments(original, modified)
      .filter((segment) => segment.kind !== "equal");
    expect(changed.length).toBeGreaterThan(0);
  });
});

describe("review ink model", () => {
  it("puts a missing-space marker only on the side without the space", () => {
    const insert = buildReviewInkModel([modified("글자글자", "글자 글자")]);
    expect(insert).toEqual([expect.objectContaining({
      kind: "whitespace-missing",
      side: "original",
      whitespaceBoundaryOffset: 2,
      whitespaceMark: "check",
    })]);

    const remove = buildReviewInkModel([modified("글자 글자", "글자글자")]);
    expect(remove).toEqual([expect.objectContaining({
      kind: "whitespace-missing",
      side: "modified",
      whitespaceBoundaryOffset: 2,
      whitespaceMark: "join",
    })]);
  });

  it("anchors 각 붙여쓰기 exactly between 여 and 쓰", () => {
    const ink = buildReviewInkModel([modified("각 붙여쓰기", "각 붙여 쓰기")]);
    expect(ink).toEqual([expect.objectContaining({
      kind: "whitespace-missing",
      side: "original",
      whitespaceBoundaryOffset: 4,
      whitespaceMark: "check",
      anchor: expect.objectContaining({ textRange: { start: 4, end: 4 } }),
    })]);
  });

  it("maps changed text to both sides without changing document content", () => {
    const ink = buildReviewInkModel([modified("전원을 끈다.", "전원을 차단한다.")]);
    expect(ink).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "text-modified", side: "original" }),
      expect.objectContaining({ kind: "text-modified", side: "modified" }),
    ]));
  });

  it("keeps whole-paragraph additions and removals on their real document side", () => {
    const added: TextChange = {
      id: "added-1",
      type: "text",
      kind: "added",
      modifiedText: "추가된 문장",
      modifiedAnchor: {
        target: "body-text", sectionIndex: 0, paragraphIndex: 2,
        confidence: "exact", textRange: { start: 0, end: 6 },
      },
    };
    const removed: TextChange = {
      id: "removed-1",
      type: "text",
      kind: "removed",
      originalText: "삭제된 문장",
      originalAnchor: {
        target: "body-text", sectionIndex: 0, paragraphIndex: 3,
        confidence: "exact", textRange: { start: 0, end: 6 },
      },
    };

    expect(buildReviewInkModel([added, removed])).toEqual([
      expect.objectContaining({ changeId: "added-1", kind: "text-added", side: "modified" }),
      expect.objectContaining({ changeId: "removed-1", kind: "text-removed", side: "original" }),
    ]);
  });

  it("marks the exact boundary on the side where removed text no longer exists", () => {
    const ink = buildReviewInkModel([modified("시동 (START)", "시동")]);
    expect(ink).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "text-removed", side: "original" }),
      expect.objectContaining({
        kind: "text-boundary",
        side: "modified",
        textBoundaryOffset: 2,
      }),
    ]));
  });

  it("uses renderer-neutral cell and image geometry marks", () => {
    const changes = [
      {
        id: "table-1", type: "table", kind: "modified", detail: "cell-text",
        locationLabel: "표 1 · 1행 1열",
        originalAnchor: {
          target: "table-cell", sectionIndex: 0, paragraphIndex: 1, controlIndex: 0,
          tableIndex: 0, cellIndex: 0, row: 0, column: 0, rowSpan: 1, columnSpan: 1,
          confidence: "exact",
        },
        modifiedAnchor: {
          target: "table-cell", sectionIndex: 0, paragraphIndex: 1, controlIndex: 0,
          tableIndex: 0, cellIndex: 0, row: 0, column: 0, rowSpan: 1, columnSpan: 1,
          confidence: "exact",
        },
      },
      {
        id: "image-1", type: "image", kind: "modified", detail: "image-changed",
        locationLabel: "캡션 이미지 그림 2-1", binaryChanged: true, renderingChanged: true,
        classification: "captioned", captionLabel: "그림 2-1",
        originalAnchor: {
          target: "image", imageIndex: 0, paragraphIndex: 2, stableKey: "image-0",
          sectionIndex: 0, confidence: "exact",
          rect: { pageIndex: 0, x: 10, y: 20, width: 100, height: 80 },
        },
        modifiedAnchor: {
          target: "image", imageIndex: 0, paragraphIndex: 2, stableKey: "image-0",
          sectionIndex: 0, confidence: "exact",
          rect: { pageIndex: 0, x: 10, y: 20, width: 100, height: 80 },
        },
      },
    ] satisfies Change[];
    expect(buildReviewInkModel(changes)).toEqual(expect.arrayContaining([
      expect.objectContaining({ changeId: "table-1", kind: "table-cell", side: "original" }),
      expect.objectContaining({ changeId: "table-1", kind: "table-cell", side: "modified" }),
      expect.objectContaining({ changeId: "image-1", kind: "image-region", side: "original" }),
      expect.objectContaining({ changeId: "image-1", kind: "image-region", side: "modified" }),
    ]));
  });

  it.each(REVIEW_INK_WHITESPACE_FIXTURES)(
    "places every $name marker on $missingSide",
    ({ original, modified: after, missingSide, expectedMarkerCount }) => {
      const ink = buildReviewInkModel([modified(original, after)]);
      expect(ink).toHaveLength(expectedMarkerCount);
      expect(ink.every((item) => (
        item.kind === "whitespace-missing" && item.side === missingSide
      ))).toBe(true);
    },
  );
});
