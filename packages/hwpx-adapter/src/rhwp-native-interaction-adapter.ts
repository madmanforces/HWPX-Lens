import { HwpDocument } from "@rhwp/core";
import type {
  BodyTextAnchor,
  CharacterGeometry,
  ClipboardPayload,
  NativeCellPathEntry,
  NativeDocumentPosition,
  NativeInteractionAdapter,
  NativeSelection,
  VisualRect,
  VisualTarget,
} from "@hwpx-lens/lens-core";

interface RhwpHitTestResult {
  sectionIndex?: unknown;
  paragraphIndex?: unknown;
  charOffset?: unknown;
  parentParaIndex?: unknown;
  controlIndex?: unknown;
  cellIndex?: unknown;
  cellParaIndex?: unknown;
  cellPath?: unknown;
  isTextBox?: unknown;
}

interface RhwpCursorRect {
  pageIndex?: unknown;
  x?: unknown;
  y?: unknown;
  height?: unknown;
}

interface RhwpOutlineNavigation {
  outline?: unknown;
}

interface RhwpPageTextLayout {
  runs?: unknown;
}

interface RhwpTextLayoutRun {
  text?: unknown;
  x?: unknown;
  y?: unknown;
  w?: unknown;
  h?: unknown;
  secIdx?: unknown;
  paraIdx?: unknown;
  charStart?: unknown;
}

/**
 * Calls only public HwpDocument methods for Canvas hit-testing, selection
 * geometry and copy. Runtime JSON fields are normalized here; the missing
 * public TypeScript contract for cell hit metadata is documented by the PoC.
 * No Studio cursor or input-handler implementation is used here.
 */
export class RhwpNativeInteractionAdapter implements NativeInteractionAdapter {
  readonly kind = "native" as const;
  private readonly outlinePrefixes: Map<string, { number: string; pageIndex: number }>;
  private readonly pageTextLayoutCache = new Map<number, RhwpTextLayoutRun[]>();

  constructor(private readonly document: HwpDocument) {
    this.outlinePrefixes = readOutlinePrefixes(document);
  }

  hitTest(pageIndex: number, x: number, y: number): NativeDocumentPosition {
    this.assertPagePoint(pageIndex, x, y);
    const hit = parseJson<RhwpHitTestResult>(
      this.document.hitTest(pageIndex, x, y),
      "문서 hit-test",
    );
    const sectionIndex = requireIndex(hit.sectionIndex, "구역");
    const paragraphIndex = requireIndex(hit.paragraphIndex, "문단");
    const charOffset = requireIndex(hit.charOffset, "글자");
    const path = parseCellPath(hit.cellPath);

    if (
      hit.isTextBox !== true &&
      hit.parentParaIndex !== undefined &&
      hit.controlIndex !== undefined &&
      hit.cellIndex !== undefined
    ) {
      const parentParagraphIndex = requireIndex(hit.parentParaIndex, "표 부모 문단");
      const controlIndex = requireIndex(hit.controlIndex, "표 컨트롤");
      const cellIndex = requireIndex(hit.cellIndex, "표 셀");
      const cellParagraphIndex = path.at(-1)?.cellParaIndex ??
        optionalIndex(hit.cellParaIndex) ?? paragraphIndex;
      const cellPath = path.length > 0
        ? path
        : [{ controlIndex, cellIndex, cellParaIndex: cellParagraphIndex }];

      return {
        target: "table-cell-text",
        pageIndex,
        sectionIndex,
        parentParagraphIndex,
        controlIndex,
        cellIndex,
        cellParagraphIndex,
        charOffset,
        cellPath,
      };
    }

    return {
      target: "body-text",
      pageIndex,
      sectionIndex,
      paragraphIndex,
      charOffset,
    };
  }

  getSelectionRects(selection: NativeSelection): VisualRect[] {
    const [start, end] = orderedSelection(selection);
    const raw = start.target === "body-text"
      ? this.getBodySelectionRects(start, end)
      : this.getCellSelectionRects(start, end);
    const rects = parseJson<VisualRect[]>(raw, "선택 영역").filter(isVisualRect);
    if (start.target !== "body-text") return rects;
    const bodyEnd = requireBodyEnd(start, end);
    return start.paragraphIndex === bodyEnd.paragraphIndex
      ? this.tightenBodySelectionRects(start, bodyEnd, rects)
      : rects;
  }

  getCharacterGeometry(position: NativeDocumentPosition): CharacterGeometry | undefined {
    const length = this.getParagraphLength(position);
    if (position.charOffset < 0 || position.charOffset >= length) return undefined;

    const before = this.getCursorBoundary(position);
    const afterPosition = { ...position, charOffset: position.charOffset + 1 };
    const after = this.getCursorBoundary(afterPosition);
    const rects = this.getSelectionRects({ anchor: position, focus: afterPosition });
    if (rects.length === 0) return undefined;

    return {
      position,
      rects,
      before: { position, ...before },
      after: { position: afterPosition, ...after },
    };
  }

  copySelection(selection: NativeSelection): ClipboardPayload {
    const [start, end] = orderedSelection(selection);
    let html = "";

    if (start.target === "body-text") {
      const bodyEnd = requireBodyEnd(start, end);
      this.document.copySelection(
        start.sectionIndex,
        start.paragraphIndex,
        start.charOffset,
        bodyEnd.paragraphIndex,
        bodyEnd.charOffset,
      );
      html = this.document.exportSelectionHtml(
        start.sectionIndex,
        start.paragraphIndex,
        start.charOffset,
        bodyEnd.paragraphIndex,
        bodyEnd.charOffset,
      );
    } else {
      const cellEnd = requireCellEnd(start, end);
      if (start.cellPath.length > 1) {
        const pathJson = JSON.stringify(start.cellPath);
        this.document.copySelectionInCellByPath(
          start.sectionIndex,
          start.parentParagraphIndex,
          pathJson,
          start.cellParagraphIndex,
          start.charOffset,
          cellEnd.cellParagraphIndex,
          cellEnd.charOffset,
        );
        html = this.document.exportSelectionInCellHtmlByPath(
          start.sectionIndex,
          start.parentParagraphIndex,
          pathJson,
          start.cellParagraphIndex,
          start.charOffset,
          cellEnd.cellParagraphIndex,
          cellEnd.charOffset,
        );
      } else {
        this.document.copySelectionInCell(
          start.sectionIndex,
          start.parentParagraphIndex,
          start.controlIndex,
          start.cellIndex,
          start.cellParagraphIndex,
          start.charOffset,
          cellEnd.cellParagraphIndex,
          cellEnd.charOffset,
        );
        html = this.document.exportSelectionInCellHtml(
          start.sectionIndex,
          start.parentParagraphIndex,
          start.controlIndex,
          start.cellIndex,
          start.cellParagraphIndex,
          start.charOffset,
          cellEnd.cellParagraphIndex,
          cellEnd.charOffset,
        );
      }
    }

    const enginePlainText = this.document.getClipboardText();
    const plainText = start.target === "body-text"
      ? this.copyBodyTextWithOutlinePrefixes(start, requireBodyEnd(start, end), enginePlainText)
      : enginePlainText;
    return html ? { plainText, html } : { plainText };
  }

  async resolveTextTarget(anchor: BodyTextAnchor): Promise<VisualTarget> {
    const paragraphCount = this.document.getParagraphCount(anchor.sectionIndex);
    if (anchor.paragraphIndex < 0 || anchor.paragraphIndex >= paragraphCount) {
      throw new Error("변경 위치가 현재 문서의 본문 범위를 벗어났습니다.");
    }
    const length = this.document.getParagraphLength(anchor.sectionIndex, anchor.paragraphIndex);
    const requested = anchor.textRange ?? { start: 0, end: Math.min(1, length) };
    const start = clamp(requested.start, 0, length);
    const end = clamp(Math.max(requested.end, start + 1), 0, length);
    const rawRects = parseJson<VisualRect[]>(
      this.document.getSelectionRects(
        anchor.sectionIndex,
        anchor.paragraphIndex,
        start,
        anchor.paragraphIndex,
        end,
      ),
      "변경 위치",
    ).filter(isVisualRect);
    const initialPage = rawRects[0]?.pageIndex ?? 0;
    const rects = this.tightenBodySelectionRects(
      {
        target: "body-text",
        pageIndex: initialPage,
        sectionIndex: anchor.sectionIndex,
        paragraphIndex: anchor.paragraphIndex,
        charOffset: start,
      },
      {
        target: "body-text",
        pageIndex: initialPage,
        sectionIndex: anchor.sectionIndex,
        paragraphIndex: anchor.paragraphIndex,
        charOffset: end,
      },
      rawRects,
    );
    if (rects.length === 0) {
      throw new Error("본문 변경 위치의 화면 좌표를 찾지 못했습니다.");
    }
    const pageIndex = rects[0].pageIndex;
    const pageRects = rects.filter((rect) => rect.pageIndex === pageIndex);
    if (anchor.generatedPrefix && start === 0 && anchor.generatedPrefix.pageIndex === pageIndex) {
      const prefix = this.findGeneratedPrefixRect(anchor, pageRects[0]);
      if (prefix) pageRects.unshift(prefix);
    }
    return { pageIndex, rects: pageRects };
  }

  private copyBodyTextWithOutlinePrefixes(
    start: Extract<NativeDocumentPosition, { target: "body-text" }>,
    end: Extract<NativeDocumentPosition, { target: "body-text" }>,
    fallback: string,
  ): string {
    const selectedOutline = Array.from(
      { length: end.paragraphIndex - start.paragraphIndex + 1 },
      (_, offset) => start.paragraphIndex + offset,
    ).some((paragraphIndex) => {
      const selectedFromStart = paragraphIndex !== start.paragraphIndex || start.charOffset === 0;
      return selectedFromStart && this.outlinePrefixes.has(`${start.sectionIndex}:${paragraphIndex}`);
    });
    if (!selectedOutline) return fallback;

    const lines: string[] = [];
    for (let paragraphIndex = start.paragraphIndex; paragraphIndex <= end.paragraphIndex; paragraphIndex += 1) {
      const paragraphLength = this.document.getParagraphLength(start.sectionIndex, paragraphIndex);
      const rangeStart = paragraphIndex === start.paragraphIndex ? start.charOffset : 0;
      const rangeEnd = paragraphIndex === end.paragraphIndex ? end.charOffset : paragraphLength;
      let text = this.document.getTextRange(
        start.sectionIndex,
        paragraphIndex,
        rangeStart,
        rangeEnd,
      );
      const outline = rangeStart === 0
        ? this.outlinePrefixes.get(`${start.sectionIndex}:${paragraphIndex}`)
        : undefined;
      if (outline) text = `${outline.number} ${text}`;
      lines.push(text);
    }
    return lines.join("\n");
  }

  private findGeneratedPrefixRect(
    anchor: BodyTextAnchor,
    firstTextRect: VisualRect,
  ): VisualRect | undefined {
    const generated = anchor.generatedPrefix;
    if (!generated) return undefined;
    const candidates = this.getPageTextLayoutRuns(generated.pageIndex).flatMap((run) => {
      if (typeof run.text !== "string" || run.text.trim() !== generated.text.trim()) return [];
      const x = optionalFinite(run.x);
      const y = optionalFinite(run.y);
      const width = optionalPositive(run.w);
      const height = optionalPositive(run.h);
      if (x === undefined || y === undefined || width === undefined || height === undefined) return [];
      const sameLine = Math.abs(y - firstTextRect.y) <= Math.max(height, firstTextRect.height) * 0.35;
      const immediatelyBefore = x + width <= firstTextRect.x + 2;
      return sameLine && immediatelyBefore
        ? [{ pageIndex: generated.pageIndex, x, y, width, height }]
        : [];
    });
    return candidates.sort((left, right) =>
      Math.abs((left.x + left.width) - firstTextRect.x) -
      Math.abs((right.x + right.width) - firstTextRect.x),
    )[0];
  }

  /**
   * rhwp selection rectangles are line boxes on some real documents. They can
   * begin at the paragraph content area rather than the first selected glyph,
   * which makes Review Ink cover indentation and can collapse a short range
   * into an underline-like strip. Page text-layout runs carry the exact line
   * fragment and semantic charStart, so trim same-paragraph ranges to those
   * run bounds and use engine cursor boundaries for partial runs.
   */
  private tightenBodySelectionRects(
    start: Extract<NativeDocumentPosition, { target: "body-text" }>,
    end: Extract<NativeDocumentPosition, { target: "body-text" }>,
    fallback: VisualRect[],
  ): VisualRect[] {
    if (
      fallback.length === 0 ||
      start.sectionIndex !== end.sectionIndex ||
      start.paragraphIndex !== end.paragraphIndex ||
      end.charOffset <= start.charOffset
    ) return fallback;

    const result: VisualRect[] = [];
    const pages = [...new Set(fallback.map((rect) => rect.pageIndex))];
    for (const pageIndex of pages) {
      const pageFallback = fallback.filter((rect) => rect.pageIndex === pageIndex);
      const pageRects = this.getPageTextLayoutRuns(pageIndex).flatMap((run) => {
        if (
          optionalIndex(run.secIdx) !== start.sectionIndex ||
          optionalIndex(run.paraIdx) !== start.paragraphIndex ||
          typeof run.text !== "string"
        ) return [];
        const runStart = optionalIndex(run.charStart);
        const x = optionalFinite(run.x);
        const y = optionalFinite(run.y);
        const width = optionalPositive(run.w);
        const height = optionalPositive(run.h);
        if (
          runStart === undefined || x === undefined || y === undefined ||
          width === undefined || height === undefined
        ) return [];

        const runEnd = runStart + run.text.length;
        const overlapStart = Math.max(start.charOffset, runStart);
        const overlapEnd = Math.min(end.charOffset, runEnd);
        if (overlapEnd <= overlapStart) return [];
        if (overlapStart === runStart && overlapEnd === runEnd) {
          return [{ pageIndex, x, y, width, height }];
        }

        try {
          const before = overlapStart === runStart
            ? { pageIndex, x, y, height }
            : this.getCursorBoundary({ ...start, pageIndex, charOffset: overlapStart });
          const after = overlapEnd === runEnd
            ? { pageIndex, x: x + width, y, height }
            : this.getCursorBoundary({ ...start, pageIndex, charOffset: overlapEnd });
          const samePage = before.pageIndex === pageIndex && after.pageIndex === pageIndex;
          const sameLine = Math.abs(before.y - after.y) <= Math.max(before.height, after.height) * 0.35;
          if (!samePage || !sameLine) return [];
          const left = Math.min(before.x, after.x);
          const right = Math.max(before.x, after.x);
          if (right <= left) return [];
          return [{ pageIndex, x: left, y, width: right - left, height }];
        } catch {
          return [];
        }
      });
      if (pageRects.length === 0) {
        result.push(...pageFallback);
        continue;
      }
      const tight = mergeLineRects(pageRects);
      result.push(...tight);
      // Never trade fidelity for precision: if a backend omits charStart on a
      // visible run, retain only that unmatched engine line as a safe fallback.
      result.push(...pageFallback.filter((fallbackRect) =>
        !tight.some((tightRect) => sameVisualFragment(fallbackRect, tightRect)),
      ));
    }
    return result.length > 0 ? result : fallback;
  }

  private getPageTextLayoutRuns(pageIndex: number): RhwpTextLayoutRun[] {
    const cached = this.pageTextLayoutCache.get(pageIndex);
    if (cached) {
      this.pageTextLayoutCache.delete(pageIndex);
      this.pageTextLayoutCache.set(pageIndex, cached);
      return cached;
    }
    let runs: RhwpTextLayoutRun[] = [];
    try {
      const layout = parseJson<RhwpPageTextLayout>(
        this.document.getPageTextLayout(pageIndex),
        "페이지 텍스트 layout",
      );
      runs = Array.isArray(layout.runs)
        ? layout.runs.filter(isRecord).map((run) => run as RhwpTextLayoutRun)
        : [];
    } catch {
      runs = [];
    }
    this.pageTextLayoutCache.set(pageIndex, runs);
    if (this.pageTextLayoutCache.size > 12) {
      const oldest = this.pageTextLayoutCache.keys().next().value;
      if (oldest !== undefined) this.pageTextLayoutCache.delete(oldest);
    }
    return runs;
  }

  private getBodySelectionRects(
    start: Extract<NativeDocumentPosition, { target: "body-text" }>,
    end: NativeDocumentPosition,
  ): string {
    const bodyEnd = requireBodyEnd(start, end);
    return this.document.getSelectionRects(
      start.sectionIndex,
      start.paragraphIndex,
      start.charOffset,
      bodyEnd.paragraphIndex,
      bodyEnd.charOffset,
    );
  }

  private getCellSelectionRects(
    start: Extract<NativeDocumentPosition, { target: "table-cell-text" }>,
    end: NativeDocumentPosition,
  ): string {
    const cellEnd = requireCellEnd(start, end);
    if (start.cellPath.length > 1) {
      return this.document.getSelectionRectsInCellByPath(
        start.sectionIndex,
        start.parentParagraphIndex,
        JSON.stringify(start.cellPath),
        start.cellParagraphIndex,
        start.charOffset,
        cellEnd.cellParagraphIndex,
        cellEnd.charOffset,
      );
    }
    return this.document.getSelectionRectsInCell(
      start.sectionIndex,
      start.parentParagraphIndex,
      start.controlIndex,
      start.cellIndex,
      start.cellParagraphIndex,
      start.charOffset,
      cellEnd.cellParagraphIndex,
      cellEnd.charOffset,
    );
  }

  private getParagraphLength(position: NativeDocumentPosition): number {
    if (position.target === "body-text") {
      return this.document.getParagraphLength(position.sectionIndex, position.paragraphIndex);
    }
    if (position.cellPath.length > 1) {
      return this.document.getCellParagraphLengthByPath(
        position.sectionIndex,
        position.parentParagraphIndex,
        JSON.stringify(pathForParagraph(position)),
      );
    }
    return this.document.getCellParagraphLength(
      position.sectionIndex,
      position.parentParagraphIndex,
      position.controlIndex,
      position.cellIndex,
      position.cellParagraphIndex,
    );
  }

  private getCursorBoundary(position: NativeDocumentPosition) {
    const raw = position.target === "body-text"
      ? this.document.getCursorRect(
          position.sectionIndex,
          position.paragraphIndex,
          position.charOffset,
        )
      : position.cellPath.length > 1
        ? this.document.getCursorRectByPath(
            position.sectionIndex,
            position.parentParagraphIndex,
            JSON.stringify(pathForParagraph(position)),
            position.charOffset,
          )
        : this.document.getCursorRectInCell(
            position.sectionIndex,
            position.parentParagraphIndex,
            position.controlIndex,
            position.cellIndex,
            position.cellParagraphIndex,
            position.charOffset,
          );
    const rect = parseJson<RhwpCursorRect>(raw, "문자 경계");
    return {
      pageIndex: requireIndex(rect.pageIndex, "문자 경계 페이지"),
      x: requireFinite(rect.x, "문자 경계 x"),
      y: requireFinite(rect.y, "문자 경계 y"),
      height: requirePositive(rect.height, "문자 경계 높이"),
    };
  }

  private assertPagePoint(pageIndex: number, x: number, y: number): void {
    if (
      !Number.isInteger(pageIndex) ||
      pageIndex < 0 ||
      pageIndex >= this.document.pageCount() ||
      !Number.isFinite(x) ||
      !Number.isFinite(y)
    ) {
      throw new Error("문서 hit-test 좌표가 올바르지 않습니다.");
    }
  }
}

function mergeLineRects(rects: VisualRect[]): VisualRect[] {
  const sorted = [...rects].sort((left, right) =>
    left.pageIndex - right.pageIndex ||
    left.y - right.y ||
    left.x - right.x,
  );
  const merged: VisualRect[] = [];
  for (const rect of sorted) {
    const previous = merged.at(-1);
    const sameLine = previous !== undefined && sameVisualLine(previous, rect, 0.35);
    const gap = previous ? rect.x - (previous.x + previous.width) : Number.POSITIVE_INFINITY;
    if (previous && sameLine && gap <= Math.max(1, Math.min(previous.height, rect.height) * 0.12)) {
      const right = Math.max(previous.x + previous.width, rect.x + rect.width);
      const bottom = Math.max(previous.y + previous.height, rect.y + rect.height);
      previous.x = Math.min(previous.x, rect.x);
      previous.y = Math.min(previous.y, rect.y);
      previous.width = right - previous.x;
      previous.height = bottom - previous.y;
    } else {
      merged.push({ ...rect });
    }
  }
  return merged;
}

function sameVisualLine(left: VisualRect, right: VisualRect, tolerance = 0.75): boolean {
  return left.pageIndex === right.pageIndex &&
    Math.abs((left.y + left.height / 2) - (right.y + right.height / 2)) <=
      Math.max(left.height, right.height) * tolerance;
}

function sameVisualFragment(left: VisualRect, right: VisualRect): boolean {
  if (!sameVisualLine(left, right)) return false;
  const horizontalGap = Math.max(
    left.x - (right.x + right.width),
    right.x - (left.x + left.width),
    0,
  );
  return horizontalGap <= Math.max(left.height, right.height);
}

function orderedSelection(
  selection: NativeSelection,
): [NativeDocumentPosition, NativeDocumentPosition] {
  assertCompatible(selection.anchor, selection.focus);
  const direction = comparePositions(selection.anchor, selection.focus);
  return direction <= 0
    ? [selection.anchor, selection.focus]
    : [selection.focus, selection.anchor];
}

function comparePositions(left: NativeDocumentPosition, right: NativeDocumentPosition): number {
  if (left.target === "body-text" && right.target === "body-text") {
    return left.paragraphIndex - right.paragraphIndex || left.charOffset - right.charOffset;
  }
  if (left.target === "table-cell-text" && right.target === "table-cell-text") {
    return left.cellParagraphIndex - right.cellParagraphIndex || left.charOffset - right.charOffset;
  }
  return 0;
}

function assertCompatible(left: NativeDocumentPosition, right: NativeDocumentPosition): void {
  if (left.target !== right.target || left.sectionIndex !== right.sectionIndex) {
    throw new Error("본문과 표 셀을 가로지르는 선택은 현재 public API 범위를 벗어납니다.");
  }
  if (left.target === "table-cell-text" && right.target === "table-cell-text") {
    if (
      left.parentParagraphIndex !== right.parentParagraphIndex ||
      cellIdentity(left.cellPath) !== cellIdentity(right.cellPath)
    ) {
      throw new Error("여러 표 셀을 가로지르는 텍스트 선택은 현재 public API 범위를 벗어납니다.");
    }
  }
}

function requireBodyEnd(
  start: Extract<NativeDocumentPosition, { target: "body-text" }>,
  end: NativeDocumentPosition,
): Extract<NativeDocumentPosition, { target: "body-text" }> {
  assertCompatible(start, end);
  if (end.target !== "body-text") throw new Error("본문 선택 범위가 올바르지 않습니다.");
  return end;
}

function requireCellEnd(
  start: Extract<NativeDocumentPosition, { target: "table-cell-text" }>,
  end: NativeDocumentPosition,
): Extract<NativeDocumentPosition, { target: "table-cell-text" }> {
  assertCompatible(start, end);
  if (end.target !== "table-cell-text") throw new Error("표 셀 선택 범위가 올바르지 않습니다.");
  return end;
}

function cellIdentity(path: NativeCellPathEntry[]): string {
  return path.map((entry) => `${entry.controlIndex}:${entry.cellIndex}`).join("/");
}

function pathForParagraph(
  position: Extract<NativeDocumentPosition, { target: "table-cell-text" }>,
): NativeCellPathEntry[] {
  return position.cellPath.map((entry, index) => index === position.cellPath.length - 1
    ? { ...entry, cellParaIndex: position.cellParagraphIndex }
    : entry);
}

function parseCellPath(value: unknown): NativeCellPathEntry[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (!isRecord(entry)) throw new Error("표 셀 경로가 올바르지 않습니다.");
    return {
      controlIndex: requireIndex(entry.controlIndex, "셀 경로 컨트롤"),
      cellIndex: requireIndex(entry.cellIndex, "셀 경로 셀"),
      cellParaIndex: requireIndex(entry.cellParaIndex, "셀 경로 문단"),
    };
  });
}

function readOutlinePrefixes(
  document: HwpDocument,
): Map<string, { number: string; pageIndex: number }> {
  const navigation = parseJson<RhwpOutlineNavigation>(
    document.getOutlineNavigation(),
    "개요 navigation",
  );
  const result = new Map<string, { number: string; pageIndex: number }>();
  if (!Array.isArray(navigation.outline)) return result;
  for (const raw of navigation.outline) {
    if (!isRecord(raw)) continue;
    const sectionIndex = optionalIndex(raw.section);
    const paragraphIndex = optionalIndex(raw.paragraph);
    const page = typeof raw.page === "number" && Number.isInteger(raw.page) && raw.page > 0
      ? raw.page
      : undefined;
    if (
      sectionIndex === undefined ||
      paragraphIndex === undefined ||
      page === undefined ||
      typeof raw.number !== "string" ||
      raw.number.trim().length === 0
    ) continue;
    result.set(`${sectionIndex}:${paragraphIndex}`, {
      number: raw.number.trim(),
      pageIndex: page - 1,
    });
  }
  return result;
}

function isVisualRect(rect: VisualRect): boolean {
  return (
    Number.isInteger(rect.pageIndex) && rect.pageIndex >= 0 &&
    Number.isFinite(rect.x) && Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) && Number.isFinite(rect.height) &&
    rect.width >= 0 && rect.height > 0
  );
}

function requireIndex(value: unknown, label: string): number {
  const parsed = optionalIndex(value);
  if (parsed === undefined) throw new Error(`${label} 인덱스가 올바르지 않습니다.`);
  return parsed;
}

function optionalIndex(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function requireFinite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} 값이 올바르지 않습니다.`);
  }
  return value;
}

function optionalFinite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalPositive(value: unknown): number | undefined {
  const parsed = optionalFinite(value);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
}

function requirePositive(value: unknown, label: string): number {
  const parsed = requireFinite(value, label);
  if (parsed <= 0) throw new Error(`${label} 값이 올바르지 않습니다.`);
  return parsed;
}

function parseJson<T>(value: string, label: string): T {
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    throw new Error(`${label} 응답을 해석하지 못했습니다.`, { cause: error });
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
