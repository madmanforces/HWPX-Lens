import { describe, expect, it, vi } from "vitest";
import type { LensDocument, ReviewInkModel } from "@hwpx-lens/lens-core";
import { materializeReviewInk } from "./review-ink-geometry";

describe("ReviewInkGeometry", () => {
  it("preserves every line fragment returned for a changed range", async () => {
    const rects = [
      { pageIndex: 0, x: 20, y: 40, width: 80, height: 12 },
      { pageIndex: 0, x: 20, y: 54, width: 48, height: 12 },
    ];
    const interaction = {
      kind: "native" as const,
      resolveTextTarget: vi.fn(async () => ({ pageIndex: 0, rects })),
    };
    const document = { interaction, rendering: {} } as unknown as LensDocument;
    const model: ReviewInkModel = {
      id: "multiline-1",
      changeId: "text-1",
      kind: "text-modified",
      side: "modified",
      anchor: {
        target: "body-text", sectionIndex: 0, paragraphIndex: 0,
        confidence: "exact", textRange: { start: 4, end: 20 },
      },
    };

    expect((await materializeReviewInk(model, document))?.rects).toEqual(rects);
  });

  it("anchors the whitespace check at the real boundary between characters", async () => {
    const interaction = {
      kind: "native" as const,
      resolveTextTarget: vi.fn(async () => ({ pageIndex: 0, rects: [] })),
      hitTest: vi.fn(),
      getSelectionRects: vi.fn(),
      copySelection: vi.fn(),
      getCharacterGeometry: vi.fn((position: { charOffset: number }) => position.charOffset === 1
        ? {
          position,
          rects: [{ pageIndex: 0, x: 20, y: 40, width: 10, height: 12 }],
          before: { position, pageIndex: 0, x: 20, y: 40, height: 12 },
          after: { position: { ...position, charOffset: 2 }, pageIndex: 0, x: 30, y: 40, height: 12 },
        }
        : {
          position,
          rects: [{ pageIndex: 0, x: 30, y: 40, width: 10, height: 12 }],
          before: { position, pageIndex: 0, x: 30, y: 40, height: 12 },
          after: { position: { ...position, charOffset: 3 }, pageIndex: 0, x: 40, y: 40, height: 12 },
        }),
    };
    const document = { interaction, rendering: {} } as unknown as LensDocument;
    const model: ReviewInkModel = {
      id: "space-1",
      changeId: "text-1",
      kind: "whitespace-missing",
      side: "original",
      anchor: {
        target: "body-text", sectionIndex: 0, paragraphIndex: 0,
        confidence: "exact", textRange: { start: 2, end: 2 },
      },
      whitespaceBoundaryOffset: 2,
    };
    const geometry = await materializeReviewInk(model, document);
    expect(geometry?.whitespaceBoundary).toMatchObject({
      boundaryX: 30,
      pageIndex: 0,
      mark: "check",
      marker: { x: 27, width: 6 },
    });
  });
});
