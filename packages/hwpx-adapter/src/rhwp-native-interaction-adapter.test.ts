import { describe, expect, it, vi } from "vitest";
import { RhwpNativeInteractionAdapter } from "./rhwp-native-interaction-adapter";
import type { NativeSelection } from "@hwpx-lens/lens-core";

function fakeDocument() {
  return {
    pageCount: vi.fn(() => 2),
    hitTest: vi.fn(() => JSON.stringify({ sectionIndex: 0, paragraphIndex: 4, charOffset: 2 })),
    getSelectionRects: vi.fn(() => JSON.stringify([
      { pageIndex: 0, x: 10, y: 20, width: 30, height: 12 },
    ])),
    getSelectionRectsInCell: vi.fn(() => JSON.stringify([
      { pageIndex: 0, x: 40, y: 50, width: 20, height: 12 },
    ])),
    getSelectionRectsInCellByPath: vi.fn(() => "[]"),
    getCursorRect: vi.fn((_: number, __: number, offset: number) => JSON.stringify({
      pageIndex: 0, x: 10 + offset * 8, y: 20, height: 12,
    })),
    getCursorRectInCell: vi.fn((_: number, __: number, ___: number, ____: number, _____: number, offset: number) => JSON.stringify({
      pageIndex: 0, x: 40 + offset * 8, y: 50, height: 12,
    })),
    getCursorRectByPath: vi.fn(() => JSON.stringify({ pageIndex: 0, x: 40, y: 50, height: 12 })),
    getCellParagraphLength: vi.fn(() => 12),
    getCellParagraphLengthByPath: vi.fn(() => 12),
    copySelection: vi.fn(() => JSON.stringify({ ok: true })),
    copySelectionInCell: vi.fn(() => JSON.stringify({ ok: true })),
    copySelectionInCellByPath: vi.fn(() => JSON.stringify({ ok: true })),
    exportSelectionHtml: vi.fn(() => "<p>본문</p>"),
    exportSelectionInCellHtml: vi.fn(() => "<p>셀</p>"),
    exportSelectionInCellHtmlByPath: vi.fn(() => ""),
    getClipboardText: vi.fn(() => "정상 복사"),
    getOutlineNavigation: vi.fn(() => JSON.stringify({ outline: [] })),
    getPageTextLayout: vi.fn(() => JSON.stringify({ runs: [] })),
    getTextRange: vi.fn(() => "본문"),
    getParagraphCount: vi.fn(() => 10),
    getParagraphLength: vi.fn(() => 20),
  };
}

describe("RhwpNativeInteractionAdapter", () => {
  it("normalizes public body and cell hit-test results", () => {
    const document = fakeDocument();
    const adapter = new RhwpNativeInteractionAdapter(document as never);
    expect(adapter.hitTest(0, 12, 24)).toMatchObject({
      target: "body-text",
      sectionIndex: 0,
      paragraphIndex: 4,
      charOffset: 2,
    });

    document.hitTest.mockReturnValueOnce(JSON.stringify({
      sectionIndex: 0,
      paragraphIndex: 1,
      charOffset: 3,
      parentParaIndex: 7,
      controlIndex: 2,
      cellIndex: 5,
      cellParaIndex: 1,
      cellPath: [{ controlIndex: 2, cellIndex: 5, cellParaIndex: 1 }],
    }));
    expect(adapter.hitTest(0, 20, 30)).toMatchObject({
      target: "table-cell-text",
      parentParagraphIndex: 7,
      controlIndex: 2,
      cellIndex: 5,
      cellParagraphIndex: 1,
      charOffset: 3,
    });
  });

  it("orders reverse body selections and uses rhwp semantic clipboard", () => {
    const document = fakeDocument();
    const adapter = new RhwpNativeInteractionAdapter(document as never);
    const selection: NativeSelection = {
      anchor: {
        target: "body-text", pageIndex: 0, sectionIndex: 0,
        paragraphIndex: 5, charOffset: 8,
      },
      focus: {
        target: "body-text", pageIndex: 0, sectionIndex: 0,
        paragraphIndex: 4, charOffset: 2,
      },
    };

    expect(adapter.getSelectionRects(selection)).toHaveLength(1);
    expect(document.getSelectionRects).toHaveBeenCalledWith(0, 4, 2, 5, 8);
    expect(adapter.copySelection(selection)).toEqual({
      plainText: "정상 복사",
      html: "<p>본문</p>",
    });
    expect(document.copySelection).toHaveBeenCalledWith(0, 4, 2, 5, 8);
  });

  it("uses cell-specific rect and clipboard APIs", () => {
    const document = fakeDocument();
    const adapter = new RhwpNativeInteractionAdapter(document as never);
    const base = {
      target: "table-cell-text" as const,
      pageIndex: 0,
      sectionIndex: 0,
      parentParagraphIndex: 7,
      controlIndex: 2,
      cellIndex: 5,
      cellPath: [{ controlIndex: 2, cellIndex: 5, cellParaIndex: 0 }],
    };
    const selection: NativeSelection = {
      anchor: { ...base, cellParagraphIndex: 0, charOffset: 1 },
      focus: { ...base, cellParagraphIndex: 1, charOffset: 4 },
    };

    expect(adapter.getSelectionRects(selection)).toHaveLength(1);
    expect(document.getSelectionRectsInCell).toHaveBeenCalledWith(0, 7, 2, 5, 0, 1, 1, 4);
    expect(adapter.copySelection(selection)).toMatchObject({ plainText: "정상 복사" });
    expect(document.copySelectionInCell).toHaveBeenCalledWith(0, 7, 2, 5, 0, 1, 1, 4);
  });

  it("returns engine-derived character and boundary geometry", () => {
    const document = fakeDocument();
    const adapter = new RhwpNativeInteractionAdapter(document as never);
    const position = {
      target: "body-text" as const,
      pageIndex: 0,
      sectionIndex: 0,
      paragraphIndex: 4,
      charOffset: 2,
    };

    expect(adapter.getCharacterGeometry(position)).toEqual({
      position,
      rects: [{ pageIndex: 0, x: 10, y: 20, width: 30, height: 12 }],
      before: { position, pageIndex: 0, x: 26, y: 20, height: 12 },
      after: {
        position: { ...position, charOffset: 3 },
        pageIndex: 0,
        x: 34,
        y: 20,
        height: 12,
      },
    });
    expect(document.getSelectionRects).toHaveBeenCalledWith(0, 4, 2, 4, 3);
  });

  it("trims a short range to cursor and text-run bounds instead of a paragraph line box", () => {
    const document = fakeDocument();
    document.getSelectionRects.mockReturnValue(JSON.stringify([
      { pageIndex: 0, x: 10, y: 31, width: 180, height: 1 },
    ]));
    document.getPageTextLayout.mockReturnValue(JSON.stringify({ runs: [{
      text: "0123456789",
      x: 50,
      y: 20,
      w: 80,
      h: 12,
      secIdx: 0,
      paraIdx: 4,
      charStart: 0,
    }] }));
    document.getCursorRect.mockImplementation((_: number, __: number, offset: number) => JSON.stringify({
      pageIndex: 0, x: 50 + offset * 8, y: 20, height: 12,
    }));
    const adapter = new RhwpNativeInteractionAdapter(document as never);
    const base = {
      target: "body-text" as const,
      pageIndex: 0,
      sectionIndex: 0,
      paragraphIndex: 4,
    };

    expect(adapter.getSelectionRects({
      anchor: { ...base, charOffset: 2 },
      focus: { ...base, charOffset: 5 },
    })).toEqual([
      { pageIndex: 0, x: 66, y: 20, width: 24, height: 12 },
    ]);
  });

  it("uses exact per-line text runs for a multi-line paragraph", () => {
    const document = fakeDocument();
    document.getSelectionRects.mockReturnValue(JSON.stringify([
      { pageIndex: 0, x: 10, y: 20, width: 180, height: 12 },
      { pageIndex: 0, x: 10, y: 40, width: 180, height: 12 },
    ]));
    document.getPageTextLayout.mockReturnValue(JSON.stringify({ runs: [
      { text: "ABCDE", x: 50, y: 20, w: 40, h: 12, secIdx: 0, paraIdx: 4, charStart: 0 },
      { text: "FGHIJ", x: 60, y: 40, w: 40, h: 12, secIdx: 0, paraIdx: 4, charStart: 5 },
    ] }));
    const adapter = new RhwpNativeInteractionAdapter(document as never);
    const base = {
      target: "body-text" as const,
      pageIndex: 0,
      sectionIndex: 0,
      paragraphIndex: 4,
    };

    expect(adapter.getSelectionRects({
      anchor: { ...base, charOffset: 0 },
      focus: { ...base, charOffset: 10 },
    })).toEqual([
      { pageIndex: 0, x: 50, y: 20, width: 40, height: 12 },
      { pageIndex: 0, x: 60, y: 40, width: 40, height: 12 },
    ]);
  });

  it("keeps an unmatched renderer line when a layout run has no semantic offset", () => {
    const document = fakeDocument();
    document.getSelectionRects.mockReturnValue(JSON.stringify([
      { pageIndex: 0, x: 10, y: 20, width: 180, height: 12 },
      { pageIndex: 0, x: 10, y: 40, width: 180, height: 12 },
      { pageIndex: 0, x: 250, y: 20, width: 180, height: 12 },
    ]));
    document.getPageTextLayout.mockReturnValue(JSON.stringify({ runs: [
      { text: "ABCDE", x: 50, y: 20, w: 40, h: 12, secIdx: 0, paraIdx: 4, charStart: 0 },
      { text: "FGHIJ", x: 60, y: 40, w: 40, h: 12, secIdx: 0, paraIdx: 4 },
    ] }));
    const adapter = new RhwpNativeInteractionAdapter(document as never);
    const base = {
      target: "body-text" as const,
      pageIndex: 0,
      sectionIndex: 0,
      paragraphIndex: 4,
    };

    expect(adapter.getSelectionRects({
      anchor: { ...base, charOffset: 0 },
      focus: { ...base, charOffset: 10 },
    })).toEqual([
      { pageIndex: 0, x: 50, y: 20, width: 40, height: 12 },
      { pageIndex: 0, x: 10, y: 40, width: 180, height: 12 },
      { pageIndex: 0, x: 250, y: 20, width: 180, height: 12 },
    ]);
  });

  it("rejects character geometry at the paragraph end", () => {
    const adapter = new RhwpNativeInteractionAdapter(fakeDocument() as never);
    expect(adapter.getCharacterGeometry({
      target: "body-text",
      pageIndex: 0,
      sectionIndex: 0,
      paragraphIndex: 4,
      charOffset: 20,
    })).toBeUndefined();
  });

  it("rejects ranges that cross body and table contexts", () => {
    const adapter = new RhwpNativeInteractionAdapter(fakeDocument() as never);
    expect(() => adapter.getSelectionRects({
      anchor: {
        target: "body-text", pageIndex: 0, sectionIndex: 0,
        paragraphIndex: 0, charOffset: 0,
      },
      focus: {
        target: "table-cell-text", pageIndex: 0, sectionIndex: 0,
        parentParagraphIndex: 1, controlIndex: 0, cellIndex: 0,
        cellParagraphIndex: 0, charOffset: 1,
        cellPath: [{ controlIndex: 0, cellIndex: 0, cellParaIndex: 0 }],
      },
    })).toThrow(/본문과 표 셀/);
  });

  it("includes the generated outline number in copied plain text", () => {
    const document = fakeDocument();
    document.getOutlineNavigation.mockReturnValue(JSON.stringify({ outline: [{
      level: 6,
      number: "(나)",
      page: 1,
      section: 0,
      paragraph: 4,
    }] }));
    document.getTextRange.mockReturnValue("시동");
    const adapter = new RhwpNativeInteractionAdapter(document as never);
    const selection: NativeSelection = {
      anchor: {
        target: "body-text", pageIndex: 0, sectionIndex: 0,
        paragraphIndex: 4, charOffset: 0,
      },
      focus: {
        target: "body-text", pageIndex: 0, sectionIndex: 0,
        paragraphIndex: 4, charOffset: 2,
      },
    };

    expect(adapter.copySelection(selection).plainText).toBe("(나) 시동");
  });

  it("adds only the exact generated prefix run to an outline target", async () => {
    const document = fakeDocument();
    document.getOutlineNavigation.mockReturnValue(JSON.stringify({ outline: [{
      level: 6,
      number: "(가)",
      page: 1,
      section: 0,
      paragraph: 4,
    }] }));
    document.getPageTextLayout.mockReturnValue(JSON.stringify({ runs: [
      { text: "(가) ", x: 8, y: 20, w: 12, h: 12 },
      { text: "정상모드는", x: 20, y: 20, w: 60, h: 12, secIdx: 0, paraIdx: 4 },
    ] }));
    document.getSelectionRects.mockReturnValueOnce(JSON.stringify([
      { pageIndex: 0, x: 20, y: 20, width: 60, height: 12 },
    ]));
    const adapter = new RhwpNativeInteractionAdapter(document as never);

    await expect(adapter.resolveTextTarget({
      target: "body-text",
      sectionIndex: 0,
      paragraphIndex: 4,
      confidence: "exact",
      textRange: { start: 0, end: 5 },
      generatedPrefix: { text: "(가)", pageIndex: 0 },
    })).resolves.toEqual({
      pageIndex: 0,
      rects: [
        { pageIndex: 0, x: 8, y: 20, width: 12, height: 12 },
        { pageIndex: 0, x: 20, y: 20, width: 60, height: 12 },
      ],
    });
  });
});
