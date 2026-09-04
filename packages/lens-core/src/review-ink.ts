import type {
  BodyTextAnchor,
  Change,
  DocumentAnchor,
  ImageChange,
  OutlineChange,
  ReviewInkKind,
  ReviewInkModel,
  ReviewInkSide,
  TextChange,
  TextChangeSegment,
  TextRange,
  TableChange,
} from "./types";

const MAX_ALIGNMENT_CELLS = 250_000;
const WHITESPACE = /^\s+$/u;

interface TextToken {
  value: string;
  start: number;
  end: number;
}

interface RawSegment {
  kind: "equal" | "added" | "removed";
  originalRange?: TextRange;
  modifiedRange?: TextRange;
  originalBoundary?: number;
  modifiedBoundary?: number;
}

/**
 * Character-level alignment with UTF-16 ranges. Code points are never split,
 * while offsets remain compatible with rhwp paragraph APIs.
 */
export function diffTextSegments(before: string, after: string): TextChangeSegment[] {
  const left = tokenize(before);
  const right = tokenize(after);
  if ((left.length + 1) * (right.length + 1) > MAX_ALIGNMENT_CELLS) {
    return fallbackSegments(before, after);
  }

  const columns = right.length + 1;
  const lcs = new Uint32Array((left.length + 1) * columns);
  for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) {
      const index = leftIndex * columns + rightIndex;
      lcs[index] = left[leftIndex].value === right[rightIndex].value
        ? lcs[(leftIndex + 1) * columns + rightIndex + 1] + 1
        : Math.max(
          lcs[(leftIndex + 1) * columns + rightIndex],
          lcs[leftIndex * columns + rightIndex + 1],
        );
    }
  }

  const raw: RawSegment[] = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length || rightIndex < right.length) {
    if (
      leftIndex < left.length &&
      rightIndex < right.length &&
      left[leftIndex].value === right[rightIndex].value
    ) {
      appendRaw(raw, "equal", left[leftIndex], right[rightIndex]);
      leftIndex += 1;
      rightIndex += 1;
    } else if (
      rightIndex < right.length &&
      (leftIndex >= left.length ||
        lcs[leftIndex * columns + rightIndex + 1] >
          lcs[(leftIndex + 1) * columns + rightIndex])
    ) {
      appendRaw(
        raw,
        "added",
        undefined,
        right[rightIndex],
        left[leftIndex]?.start ?? before.length,
      );
      rightIndex += 1;
    } else {
      appendRaw(
        raw,
        "removed",
        left[leftIndex],
        undefined,
        undefined,
        right[rightIndex]?.start ?? after.length,
      );
      leftIndex += 1;
    }
  }
  return coalesceChangedBlocks(raw, before, after);
}

/** Builds semantic review marks without knowing SVG, Canvas or DOM nodes. */
export function buildReviewInkModel(changes: readonly Change[]): ReviewInkModel[] {
  return changes.flatMap((change) => {
    if (change.type === "text") return reviewTextChange(change);
    if (change.type === "outline") return reviewOutlineChange(change);
    if (change.type === "table") return reviewTableChange(change);
    return reviewImageChange(change);
  });
}

function reviewTableChange(change: TableChange): ReviewInkModel[] {
  return reviewObjectChange(change, "table-cell");
}

function reviewImageChange(change: ImageChange): ReviewInkModel[] {
  return reviewObjectChange(change, "image-region");
}

function reviewObjectChange(
  change: TableChange | ImageChange,
  kind: ReviewInkKind,
): ReviewInkModel[] {
  const result: ReviewInkModel[] = [];
  if (change.originalAnchor) result.push(objectInk(change, "original", kind, change.originalAnchor));
  if (change.modifiedAnchor) result.push(objectInk(change, "modified", kind, change.modifiedAnchor));
  return result;
}

function objectInk(
  change: TableChange | ImageChange,
  side: ReviewInkSide,
  kind: ReviewInkKind,
  anchor: DocumentAnchor,
): ReviewInkModel {
  return { id: `${change.id}-${side}`, changeId: change.id, kind, side, anchor };
}

function reviewOutlineChange(change: OutlineChange): ReviewInkModel[] {
  if (change.kind === "added") {
    return [
      ...bodyInk(change, "modified", "text-added", change.modifiedAnchor),
      ...boundaryInk(change, "original", change.originalContextAnchor),
    ];
  }
  if (change.kind === "removed") {
    return [
      ...bodyInk(change, "original", "text-removed", change.originalAnchor),
      ...boundaryInk(change, "modified", change.modifiedContextAnchor),
    ];
  }
  return [
    ...bodyInk(change, "original", "text-modified", change.originalAnchor),
    ...bodyInk(change, "modified", "text-modified", change.modifiedAnchor),
  ];
}

function reviewTextChange(change: TextChange): ReviewInkModel[] {
  if (change.kind === "added") {
    return [
      ...bodyInk(change, "modified", "text-added", change.modifiedAnchor),
      ...boundaryInk(change, "original", change.originalContextAnchor),
    ];
  }
  if (change.kind === "removed") {
    return [
      ...bodyInk(change, "original", "text-removed", change.originalAnchor),
      ...boundaryInk(change, "modified", change.modifiedContextAnchor),
    ];
  }

  const segments = change.segments ?? diffTextSegments(
    change.originalText ?? "",
    change.modifiedText ?? "",
  );
  const result: ReviewInkModel[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment.kind === "equal") continue;

    if (segment.whitespace === "inserted" && segment.modifiedRange) {
      const boundary = segment.originalBoundary ?? segment.modifiedRange.start;
      const anchor = withRange(change.originalAnchor, {
        start: boundary,
        end: boundary,
      });
      if (anchor) result.push({
        id: `${change.id}-whitespace-original-${index}`,
        changeId: change.id,
        kind: "whitespace-missing",
        side: "original",
        anchor,
        whitespaceBoundaryOffset: boundary,
        whitespaceMark: "check",
      });
      continue;
    }

    if (segment.whitespace === "removed" && segment.originalRange) {
      const boundary = segment.modifiedBoundary ?? segment.originalRange.start;
      const anchor = withRange(change.modifiedAnchor, {
        start: boundary,
        end: boundary,
      });
      if (anchor) result.push({
        id: `${change.id}-whitespace-modified-${index}`,
        changeId: change.id,
        kind: "whitespace-missing",
        side: "modified",
        anchor,
        whitespaceBoundaryOffset: boundary,
        whitespaceMark: "join",
      });
      continue;
    }

    if (segment.originalRange) {
      pushRangeInk(
        result,
        change,
        index,
        "original",
        segment.kind === "removed" ? "text-removed" : "text-modified",
        change.originalAnchor,
        segment.originalRange,
      );
    }
    if (segment.modifiedRange) {
      pushRangeInk(
        result,
        change,
        index,
        "modified",
        segment.kind === "added" ? "text-added" : "text-modified",
        change.modifiedAnchor,
        segment.modifiedRange,
      );
    }
    if (segment.originalRange && !segment.modifiedRange) {
      pushBoundaryInk(
        result,
        change,
        index,
        "modified",
        change.modifiedAnchor,
        segment.modifiedBoundary ?? segment.originalRange.start,
      );
    }
    if (segment.modifiedRange && !segment.originalRange) {
      pushBoundaryInk(
        result,
        change,
        index,
        "original",
        change.originalAnchor,
        segment.originalBoundary ?? segment.modifiedRange.start,
      );
    }
  }
  return result;
}

function bodyInk(
  change: TextChange | OutlineChange,
  side: ReviewInkSide,
  kind: ReviewInkKind,
  anchor: Change["originalAnchor"] | Change["modifiedAnchor"],
): ReviewInkModel[] {
  if (!anchor || anchor.target !== "body-text") return [];
  return [{ id: `${change.id}-${side}`, changeId: change.id, kind, side, anchor }];
}

function boundaryInk(
  change: TextChange | OutlineChange,
  side: ReviewInkSide,
  anchor: Change["originalContextAnchor"] | Change["modifiedContextAnchor"],
): ReviewInkModel[] {
  if (!anchor || anchor.target !== "body-text") return [];
  const offset = anchor.textRange?.start ?? 0;
  return [{
    id: `${change.id}-${side}-boundary`,
    changeId: change.id,
    kind: "text-boundary",
    side,
    anchor: { ...anchor, textRange: { start: offset, end: offset } },
    textBoundaryOffset: offset,
  }];
}

function pushBoundaryInk(
  target: ReviewInkModel[],
  change: TextChange,
  index: number,
  side: ReviewInkSide,
  base: Change["originalAnchor"] | Change["modifiedAnchor"],
  offset: number,
) {
  const anchor = withRange(base, { start: offset, end: offset });
  if (!anchor) return;
  target.push({
    id: `${change.id}-${side}-${index}-boundary`,
    changeId: change.id,
    kind: "text-boundary",
    side,
    anchor,
    textBoundaryOffset: offset,
  });
}

function pushRangeInk(
  target: ReviewInkModel[],
  change: TextChange,
  index: number,
  side: ReviewInkSide,
  kind: ReviewInkKind,
  base: Change["originalAnchor"] | Change["modifiedAnchor"],
  range: TextRange,
) {
  const anchor = withRange(base, range);
  if (!anchor || range.end <= range.start) return;
  target.push({
    id: `${change.id}-${side}-${index}`,
    changeId: change.id,
    kind,
    side,
    anchor,
  });
}

function withRange(
  anchor: Change["originalAnchor"] | Change["modifiedAnchor"],
  textRange: TextRange,
): BodyTextAnchor | undefined {
  return anchor?.target === "body-text" ? { ...anchor, textRange } : undefined;
}

function appendRaw(
  target: RawSegment[],
  kind: RawSegment["kind"],
  original: TextToken | undefined,
  modified: TextToken | undefined,
  originalBoundary?: number,
  modifiedBoundary?: number,
) {
  const previous = target.at(-1);
  const originalRange = original ? { start: original.start, end: original.end } : undefined;
  const modifiedRange = modified ? { start: modified.start, end: modified.end } : undefined;
  if (previous?.kind === kind) {
    previous.originalBoundary ??= originalBoundary;
    previous.modifiedBoundary ??= modifiedBoundary;
    if (originalRange) {
      previous.originalRange = previous.originalRange
        ? { start: previous.originalRange.start, end: originalRange.end }
        : originalRange;
    }
    if (modifiedRange) {
      previous.modifiedRange = previous.modifiedRange
        ? { start: previous.modifiedRange.start, end: modifiedRange.end }
        : modifiedRange;
    }
    return;
  }
  target.push({ kind, originalRange, modifiedRange, originalBoundary, modifiedBoundary });
}

function coalesceChangedBlocks(
  raw: RawSegment[],
  before: string,
  after: string,
): TextChangeSegment[] {
  const result: TextChangeSegment[] = [];
  let index = 0;
  while (index < raw.length) {
    if (raw[index].kind === "equal") {
      result.push(raw[index]);
      index += 1;
      continue;
    }
    let end = index;
    let originalRange: TextRange | undefined;
    let modifiedRange: TextRange | undefined;
    let originalBoundary: number | undefined;
    let modifiedBoundary: number | undefined;
    while (end < raw.length && raw[end].kind !== "equal") {
      originalRange = mergeRanges(originalRange, raw[end].originalRange);
      modifiedRange = mergeRanges(modifiedRange, raw[end].modifiedRange);
      originalBoundary ??= raw[end].originalBoundary;
      modifiedBoundary ??= raw[end].modifiedBoundary;
      end += 1;
    }
    const originalText = originalRange ? before.slice(originalRange.start, originalRange.end) : "";
    const modifiedText = modifiedRange ? after.slice(modifiedRange.start, modifiedRange.end) : "";
    if (originalRange && modifiedRange) {
      result.push({ kind: "modified", originalRange, modifiedRange });
    } else if (originalRange) {
      result.push({
        kind: "removed",
        originalRange,
        modifiedBoundary,
        whitespace: WHITESPACE.test(originalText) ? "removed" : undefined,
      });
    } else if (modifiedRange) {
      result.push({
        kind: "added",
        modifiedRange,
        originalBoundary,
        whitespace: WHITESPACE.test(modifiedText) ? "inserted" : undefined,
      });
    }
    index = end;
  }
  return result;
}

function mergeRanges(current: TextRange | undefined, next: TextRange | undefined) {
  if (!next) return current;
  return current
    ? { start: Math.min(current.start, next.start), end: Math.max(current.end, next.end) }
    : next;
}

function fallbackSegments(before: string, after: string): TextChangeSegment[] {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (beforeEnd > start && afterEnd > start && before[beforeEnd - 1] === after[afterEnd - 1]) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }
  const result: TextChangeSegment[] = [];
  if (start > 0) result.push({
    kind: "equal",
    originalRange: { start: 0, end: start },
    modifiedRange: { start: 0, end: start },
  });
  const originalRange = beforeEnd > start ? { start, end: beforeEnd } : undefined;
  const modifiedRange = afterEnd > start ? { start, end: afterEnd } : undefined;
  if (originalRange && modifiedRange) result.push({ kind: "modified", originalRange, modifiedRange });
  else if (originalRange) result.push({
    kind: "removed",
    originalRange,
    modifiedBoundary: start,
    whitespace: WHITESPACE.test(before.slice(start, beforeEnd)) ? "removed" : undefined,
  });
  else if (modifiedRange) result.push({
    kind: "added",
    modifiedRange,
    originalBoundary: start,
    whitespace: WHITESPACE.test(after.slice(start, afterEnd)) ? "inserted" : undefined,
  });
  if (beforeEnd < before.length || afterEnd < after.length) result.push({
    kind: "equal",
    originalRange: { start: beforeEnd, end: before.length },
    modifiedRange: { start: afterEnd, end: after.length },
  });
  return result;
}

function tokenize(text: string): TextToken[] {
  const result: TextToken[] = [];
  for (let start = 0; start < text.length;) {
    const codePoint = text.codePointAt(start)!;
    const value = String.fromCodePoint(codePoint);
    const end = start + value.length;
    result.push({ value, start, end });
    start = end;
  }
  return result;
}
