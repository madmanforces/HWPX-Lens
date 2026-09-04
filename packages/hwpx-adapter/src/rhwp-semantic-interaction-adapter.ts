import { HwpDocument } from "@rhwp/core";
import type {
  BodyTextAnchor,
  SemanticTextInteractionAdapter,
  SemanticTextPage,
  SemanticTextRun,
  VisualRect,
  VisualTarget,
} from "@hwpx-lens/lens-core";

const GENERATED_PARAGRAPH_INDEX = 0xffff_ffff;

interface RhwpTextLayout {
  runs?: unknown;
}

interface RhwpTextRun {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  charX: number[];
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  letterSpacing: number;
  secIdx?: number;
  paraIdx?: number;
  charStart?: number;
  parentParaIdx?: number;
  controlIdx?: number;
  cellIdx?: number;
  cellParaIdx?: number;
  cellPath?: unknown;
}

/**
 * Public-API-only bridge from rhwp page text layout to Lens semantics.
 * SVG/DOM details remain outside Lens Core.
 */
export class RhwpSemanticInteractionAdapter implements SemanticTextInteractionAdapter {
  readonly kind = "semantic-text" as const;
  private readonly pages = new Map<number, SemanticTextPage>();

  constructor(private readonly document: HwpDocument) {}

  async getTextPage(pageIndex: number): Promise<SemanticTextPage> {
    this.assertPage(pageIndex);
    const cached = this.pages.get(pageIndex);
    if (cached) return cached;

    const parsed = parseJson<RhwpTextLayout>(
      this.document.getPageTextLayout(pageIndex),
      "페이지 텍스트 레이아웃",
    );
    if (!Array.isArray(parsed.runs)) {
      throw new Error("페이지 텍스트 레이아웃의 runs가 배열이 아닙니다.");
    }

    const runs = parsed.runs
      .map((value, sourceIndex) => normalizeRun(value, pageIndex, sourceIndex))
      .map((run) => run ? this.verifyBodyAnchor(run) : undefined)
      .filter((run): run is SemanticTextRun => run !== undefined);
    const page = { pageIndex, runs };
    this.pages.set(pageIndex, page);
    return page;
  }

  async resolveTextTarget(anchor: BodyTextAnchor): Promise<VisualTarget> {
    const paragraphLength = this.document.getParagraphLength(
      anchor.sectionIndex,
      anchor.paragraphIndex,
    );
    const requested = anchor.textRange ?? { start: 0, end: Math.min(1, paragraphLength) };
    const start = clamp(requested.start, 0, paragraphLength);
    const end = clamp(requested.end, start, paragraphLength);
    const pageHints = this.selectionPageHints(anchor, start, end);
    const pages = pageHints.length > 0
      ? pageHints
      : Array.from({ length: this.document.pageCount() }, (_, pageIndex) => pageIndex);

    const rects: VisualRect[] = [];
    for (const pageIndex of pages) {
      const page = await this.getTextPage(pageIndex);
      for (const run of page.runs) {
        if (
          run.anchor?.sectionIndex !== anchor.sectionIndex ||
          run.anchor.paragraphIndex !== anchor.paragraphIndex
        ) {
          continue;
        }
        const runStart = run.anchor.textRange?.start ?? 0;
        const runEnd = run.anchor.textRange?.end ?? runStart + run.text.length;
        const overlapStart = Math.max(start, runStart);
        const overlapEnd = Math.min(end, runEnd);
        const isCaret = start === end && start >= runStart && start <= runEnd;
        if (overlapStart >= overlapEnd && !isCaret) continue;

        const localStart = clamp(overlapStart - runStart, 0, run.text.length);
        const localEnd = isCaret
          ? localStart
          : clamp(overlapEnd - runStart, localStart, run.text.length);
        const left = characterBoundary(run, localStart);
        const right = characterBoundary(run, localEnd);
        rects.push({
          pageIndex,
          x: run.rect.x + left,
          y: run.rect.y,
          width: Math.max(right - left, isCaret ? 1.5 : 0),
          height: run.rect.height,
        });
      }
    }

    if (rects.length === 0) {
      throw new Error("의미 텍스트 계층에서 변경 범위의 좌표를 찾지 못했습니다.");
    }
    const pageIndex = rects[0].pageIndex;
    return { pageIndex, rects: rects.filter((rect) => rect.pageIndex === pageIndex) };
  }

  private selectionPageHints(anchor: BodyTextAnchor, start: number, end: number): number[] {
    try {
      const effectiveEnd = Math.max(end, Math.min(start + 1, this.document.getParagraphLength(
        anchor.sectionIndex,
        anchor.paragraphIndex,
      )));
      const rects = parseJson<VisualRect[]>(
        this.document.getSelectionRects(
          anchor.sectionIndex,
          anchor.paragraphIndex,
          start,
          anchor.paragraphIndex,
          effectiveEnd,
        ),
        "본문 선택 페이지",
      );
      return [...new Set(rects.map((rect) => rect.pageIndex).filter(isPageIndex))];
    } catch {
      return [];
    }
  }

  private verifyBodyAnchor(run: SemanticTextRun): SemanticTextRun {
    const range = run.anchor?.textRange;
    if (!run.anchor || !range) return run;
    try {
      const paragraphCount = this.document.getParagraphCount(run.anchor.sectionIndex);
      if (run.anchor.paragraphIndex >= paragraphCount) throw new Error("outside paragraph range");
      const source = this.document.getTextRange(
        run.anchor.sectionIndex,
        run.anchor.paragraphIndex,
        range.start,
        range.end - range.start,
      );
      if (source === run.text) return run;
    } catch {
      // Header/footer and generated content can reuse body-looking coordinates.
    }
    return {
      ...run,
      blockId: `unmapped-${run.rect.pageIndex}-${Math.round(run.rect.y * 10)}`,
      anchor: undefined,
    };
  }

  private assertPage(pageIndex: number): void {
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= this.document.pageCount()) {
      throw new Error(`페이지 ${pageIndex + 1}의 의미 텍스트를 열 수 없습니다.`);
    }
  }
}

function normalizeRun(
  value: unknown,
  pageIndex: number,
  sourceIndex: number,
): SemanticTextRun | undefined {
  if (!isRecord(value)) return undefined;
  const run = value as unknown as RhwpTextRun;
  if (
    typeof run.text !== "string" ||
    run.text.length === 0 ||
    !isFiniteNumber(run.x) ||
    !isFiniteNumber(run.y) ||
    !isFiniteNumber(run.w) ||
    !isFiniteNumber(run.h) ||
    run.w < 0 ||
    run.h <= 0 ||
    !Array.isArray(run.charX) ||
    !run.charX.every(isFiniteNumber)
  ) {
    return undefined;
  }

  const bodyAddress =
    isNonNegativeInteger(run.secIdx) &&
    isNonNegativeInteger(run.paraIdx) &&
    run.paraIdx !== GENERATED_PARAGRAPH_INDEX &&
    isNonNegativeInteger(run.charStart) &&
    run.cellPath === undefined;
  const blockId = semanticBlockId(run, pageIndex, sourceIndex);
  return {
    id: `page-${pageIndex}-run-${sourceIndex}`,
    blockId,
    readingOrder: sourceIndex,
    text: run.text,
    rect: { pageIndex, x: run.x, y: run.y, width: run.w, height: run.h },
    characterX: normalizedCharacterX(run.charX, run.text.length, run.w),
    style: {
      fontFamily: typeof run.fontFamily === "string" ? run.fontFamily : "sans-serif",
      fontSize: isFiniteNumber(run.fontSize) && run.fontSize > 0 ? run.fontSize : run.h,
      bold: run.bold === true,
      italic: run.italic === true,
      letterSpacing: isFiniteNumber(run.letterSpacing) ? run.letterSpacing : 0,
    },
    anchor: bodyAddress
      ? {
          target: "body-text",
          sectionIndex: run.secIdx!,
          paragraphIndex: run.paraIdx!,
          textRange: { start: run.charStart!, end: run.charStart! + run.text.length },
          confidence: "exact",
        }
      : undefined,
  };
}

function semanticBlockId(run: RhwpTextRun, pageIndex: number, sourceIndex: number): string {
  if (
    isNonNegativeInteger(run.secIdx) &&
    isNonNegativeInteger(run.paraIdx) &&
    run.paraIdx !== GENERATED_PARAGRAPH_INDEX &&
    run.cellPath === undefined
  ) {
    return `body-${run.secIdx}-${run.paraIdx}`;
  }
  if (
    isNonNegativeInteger(run.secIdx) &&
    isNonNegativeInteger(run.parentParaIdx) &&
    isNonNegativeInteger(run.cellParaIdx) &&
    Array.isArray(run.cellPath)
  ) {
    return `cell-${run.secIdx}-${run.parentParaIdx}-${stablePath(run.cellPath)}-${run.cellParaIdx}`;
  }
  if (run.paraIdx === GENERATED_PARAGRAPH_INDEX) {
    return `generated-${pageIndex}-${Math.round(run.y * 10)}`;
  }
  return `visual-${pageIndex}-${sourceIndex}`;
}

function stablePath(value: unknown[]): string {
  return value.map((entry) => {
    if (!isRecord(entry)) return "?";
    return [entry.controlIndex, entry.cellIndex, entry.cellParaIndex]
      .map((part) => isNonNegativeInteger(part) ? String(part) : "?")
      .join(":");
  }).join("/");
}

function normalizedCharacterX(values: number[], textLength: number, width: number): number[] {
  if (values.length === textLength + 1 && values.every((value, index) => index === 0 || value >= values[index - 1])) {
    return [...values];
  }
  return Array.from({ length: textLength + 1 }, (_, index) =>
    textLength === 0 ? 0 : width * index / textLength,
  );
}

function characterBoundary(run: SemanticTextRun, offset: number): number {
  return run.characterX[offset] ?? run.rect.width * offset / Math.max(1, run.text.length);
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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPageIndex(value: unknown): value is number {
  return isNonNegativeInteger(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
