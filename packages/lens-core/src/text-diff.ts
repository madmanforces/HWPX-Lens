import type {
  Change,
  DocumentAnchor,
  DocumentSnapshot,
  ParagraphSnapshot,
  TextChange,
} from "./types";
import { diffTextSegments } from "./review-ink";
import { findChangedRange, normalizeExactText } from "./text";

export type ParagraphAlignmentStep =
  | { type: "equal"; original: number; modified: number }
  | { type: "modified"; original: number; modified: number }
  | { type: "removed"; original: number }
  | { type: "added"; modified: number };

const INSERT_DELETE_COST = 1;
const MIN_MODIFICATION_SIMILARITY = 0.5;
const MAX_DYNAMIC_PROGRAMMING_CELLS = 50_000;
const MAX_DYNAMIC_PROGRAMMING_EDGE = 400;
const GREEDY_LOOKAHEAD = 32;
const MAX_EXACT_SIMILARITY_LENGTH = 512;

export function compareTextSnapshots(
  original: DocumentSnapshot,
  modified: DocumentSnapshot,
): Change[] {
  return compareParagraphs(
    original.paragraphs.filter((paragraph) => !paragraph.outline),
    modified.paragraphs.filter((paragraph) => !paragraph.outline),
  );
}

/** Shared paragraph alignment used by body and outline comparison. */
export function compareParagraphs(
  originalParagraphs: ParagraphSnapshot[],
  modifiedParagraphs: ParagraphSnapshot[],
): TextChange[] {
  const steps = alignParagraphSnapshots(originalParagraphs, modifiedParagraphs);
  const changes: Change[] = [];

  for (const step of steps) {
    if (step.type === "equal") {
      const before = originalParagraphs[step.original];
      const after = modifiedParagraphs[step.modified];
      if (normalizeExactText(before.text) !== normalizeExactText(after.text)) {
        changes.push(modifiedChange(`text-${changes.length + 1}`, before, after));
      }
      continue;
    }

    const id = `text-${changes.length + 1}`;
    if (step.type === "modified") {
      const before = originalParagraphs[step.original];
      const after = modifiedParagraphs[step.modified];
      changes.push(modifiedChange(id, before, after));
      continue;
    }

    if (step.type === "removed") {
      const paragraph = originalParagraphs[step.original];
      changes.push({
        id,
        type: "text",
        kind: "removed",
        detail: "content",
        originalText: paragraph.text,
        originalAnchor: anchorFor(
          paragraph,
          { start: 0, end: paragraph.text.length },
          "exact",
        ),
        modifiedContextAnchor: nearestContextAnchor(
          modifiedParagraphs,
          findNeighborModifiedIndex(steps, step),
        ),
      });
      continue;
    }

    const paragraph = modifiedParagraphs[step.modified];
    changes.push({
      id,
      type: "text",
      kind: "added",
      detail: "content",
      modifiedText: paragraph.text,
      modifiedAnchor: anchorFor(
        paragraph,
        { start: 0, end: paragraph.text.length },
        "exact",
      ),
      originalContextAnchor: nearestContextAnchor(
        originalParagraphs,
        findNeighborOriginalIndex(steps, step),
      ),
    });
  }

  return changes as TextChange[];
}

function modifiedChange(
  id: string,
  before: ParagraphSnapshot,
  after: ParagraphSnapshot,
): TextChange {
  const ranges = findChangedRange(before.text, after.text);
  const segments = diffTextSegments(before.text, after.text);
  const changed = segments.filter((segment) => segment.kind !== "equal");
  return {
    id,
    type: "text",
    kind: "modified",
    detail: changed.length > 0 && changed.every((segment) => segment.whitespace)
      ? "whitespace"
      : "content",
    originalText: before.text,
    modifiedText: after.text,
    originalAnchor: anchorFor(before, ranges.before, "contextual"),
    modifiedAnchor: anchorFor(after, ranges.after, "contextual"),
    segments,
  };
}

export function alignParagraphSnapshots(
  original: ParagraphSnapshot[],
  modified: ParagraphSnapshot[],
): ParagraphAlignmentStep[] {
  const anchors = findStableAnchors(original, modified);
  const result: ParagraphAlignmentStep[] = [];
  let originalStart = 0;
  let modifiedStart = 0;
  for (const anchor of anchors) {
    result.push(...alignSegment(
      original,
      modified,
      originalStart,
      anchor.original,
      modifiedStart,
      anchor.modified,
    ));
    result.push({ type: "equal", original: anchor.original, modified: anchor.modified });
    originalStart = anchor.original + 1;
    modifiedStart = anchor.modified + 1;
  }
  result.push(...alignSegment(
    original,
    modified,
    originalStart,
    original.length,
    modifiedStart,
    modified.length,
  ));
  return result;
}

interface StableAnchor {
  original: number;
  modified: number;
}

function findStableAnchors(
  original: ParagraphSnapshot[],
  modified: ParagraphSnapshot[],
): StableAnchor[] {
  const originalOccurrences = occurrenceMap(original);
  const modifiedOccurrences = occurrenceMap(modified);
  const candidates: StableAnchor[] = [];
  for (let originalIndex = 0; originalIndex < original.length; originalIndex += 1) {
    const key = paragraphKey(original[originalIndex]);
    const left = originalOccurrences.get(key);
    const right = modifiedOccurrences.get(key);
    if (left?.count === 1 && right?.count === 1) {
      candidates.push({ original: originalIndex, modified: right.index });
    }
  }
  return longestIncreasingAnchors(candidates);
}

function occurrenceMap(paragraphs: ParagraphSnapshot[]): Map<string, { count: number; index: number }> {
  const occurrences = new Map<string, { count: number; index: number }>();
  for (let index = 0; index < paragraphs.length; index += 1) {
    const key = paragraphKey(paragraphs[index]);
    const current = occurrences.get(key);
    occurrences.set(key, current
      ? { count: current.count + 1, index: current.index }
      : { count: 1, index });
  }
  return occurrences;
}

function paragraphKey(paragraph: ParagraphSnapshot): string {
  if (paragraph.alignmentIdentity) return paragraph.alignmentIdentity;
  return `${paragraph.fingerprint}\u0000${paragraph.alignmentText ?? paragraph.normalizedText}`;
}

/** Keeps exact anchors in document order when independently saved files contain moved paragraphs. */
function longestIncreasingAnchors(candidates: StableAnchor[]): StableAnchor[] {
  if (candidates.length === 0) return [];
  const tails: number[] = [];
  const previous = new Int32Array(candidates.length).fill(-1);

  for (let index = 0; index < candidates.length; index += 1) {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (candidates[tails[middle]].modified < candidates[index].modified) low = middle + 1;
      else high = middle;
    }
    if (low > 0) previous[index] = tails[low - 1];
    tails[low] = index;
  }

  const result: StableAnchor[] = [];
  let cursor = tails.at(-1) ?? -1;
  while (cursor >= 0) {
    result.push(candidates[cursor]);
    cursor = previous[cursor];
  }
  return result.reverse();
}

function alignSegment(
  original: ParagraphSnapshot[],
  modified: ParagraphSnapshot[],
  originalStart: number,
  originalEnd: number,
  modifiedStart: number,
  modifiedEnd: number,
): ParagraphAlignmentStep[] {
  const originalLength = originalEnd - originalStart;
  const modifiedLength = modifiedEnd - modifiedStart;
  if (originalLength === 0) {
    return Array.from({ length: modifiedLength }, (_, offset) => ({
      type: "added" as const,
      modified: modifiedStart + offset,
    }));
  }
  if (modifiedLength === 0) {
    return Array.from({ length: originalLength }, (_, offset) => ({
      type: "removed" as const,
      original: originalStart + offset,
    }));
  }
  if (
    originalLength <= MAX_DYNAMIC_PROGRAMMING_EDGE &&
    modifiedLength <= MAX_DYNAMIC_PROGRAMMING_EDGE &&
    originalLength * modifiedLength <= MAX_DYNAMIC_PROGRAMMING_CELLS
  ) {
    return alignSegmentDynamic(
      original,
      modified,
      originalStart,
      originalEnd,
      modifiedStart,
      modifiedEnd,
    );
  }
  return alignSegmentGreedy(
    original,
    modified,
    originalStart,
    originalEnd,
    modifiedStart,
    modifiedEnd,
  );
}

const ACTION_EQUAL = 1;
const ACTION_MODIFIED = 2;
const ACTION_REMOVED = 3;
const ACTION_ADDED = 4;

function alignSegmentDynamic(
  original: ParagraphSnapshot[],
  modified: ParagraphSnapshot[],
  originalStart: number,
  originalEnd: number,
  modifiedStart: number,
  modifiedEnd: number,
): ParagraphAlignmentStep[] {
  const rows = originalEnd - originalStart + 1;
  const columns = modifiedEnd - modifiedStart + 1;
  let previousCosts = Float64Array.from({ length: columns }, (_, index) => index);
  let currentCosts = new Float64Array(columns);
  const actions = new Uint8Array(rows * columns);
  for (let column = 1; column < columns; column += 1) actions[column] = ACTION_ADDED;

  for (let row = 1; row < rows; row += 1) {
    currentCosts[0] = row;
    actions[row * columns] = ACTION_REMOVED;
    for (let column = 1; column < columns; column += 1) {
      const beforeParagraph = original[originalStart + row - 1];
      const afterParagraph = modified[modifiedStart + column - 1];
      const before = beforeParagraph.alignmentText ?? beforeParagraph.normalizedText;
      const after = afterParagraph.alignmentText ?? afterParagraph.normalizedText;
      const actionIndex = row * columns + column;
      if (before === after) {
        currentCosts[column] = previousCosts[column - 1];
        actions[actionIndex] = ACTION_EQUAL;
        continue;
      }
      const similarity = textSimilarity(before, after);
      const substitutionCost = similarity >= MIN_MODIFICATION_SIMILARITY
        ? 1 - similarity
        : INSERT_DELETE_COST * 2 + 0.01;
      const modifiedCost = previousCosts[column - 1] + substitutionCost;
      const removedCost = previousCosts[column] + INSERT_DELETE_COST;
      const addedCost = currentCosts[column - 1] + INSERT_DELETE_COST;
      if (modifiedCost <= removedCost && modifiedCost <= addedCost) {
        currentCosts[column] = modifiedCost;
        actions[actionIndex] = ACTION_MODIFIED;
      } else if (removedCost <= addedCost) {
        currentCosts[column] = removedCost;
        actions[actionIndex] = ACTION_REMOVED;
      } else {
        currentCosts[column] = addedCost;
        actions[actionIndex] = ACTION_ADDED;
      }
    }
    [previousCosts, currentCosts] = [currentCosts, previousCosts];
  }

  const result: ParagraphAlignmentStep[] = [];
  let row = rows - 1;
  let column = columns - 1;
  while (row > 0 || column > 0) {
    const action = actions[row * columns + column];
    if (action === ACTION_EQUAL || action === ACTION_MODIFIED) {
      result.push({
        type: action === ACTION_EQUAL ? "equal" : "modified",
        original: originalStart + row - 1,
        modified: modifiedStart + column - 1,
      });
      row -= 1;
      column -= 1;
    } else if (action === ACTION_REMOVED) {
      result.push({ type: "removed", original: originalStart + row - 1 });
      row -= 1;
    } else {
      result.push({ type: "added", modified: modifiedStart + column - 1 });
      column -= 1;
    }
  }
  return result.reverse();
}

function alignSegmentGreedy(
  original: ParagraphSnapshot[],
  modified: ParagraphSnapshot[],
  originalStart: number,
  originalEnd: number,
  modifiedStart: number,
  modifiedEnd: number,
): ParagraphAlignmentStep[] {
  const result: ParagraphAlignmentStep[] = [];
  let originalIndex = originalStart;
  let modifiedIndex = modifiedStart;
  while (originalIndex < originalEnd && modifiedIndex < modifiedEnd) {
    if (sameParagraph(original[originalIndex], modified[modifiedIndex])) {
      result.push({ type: "equal", original: originalIndex, modified: modifiedIndex });
      originalIndex += 1;
      modifiedIndex += 1;
      continue;
    }
    const removedDistance = findAhead(
      original,
      originalIndex + 1,
      originalEnd,
      modified[modifiedIndex],
    );
    const addedDistance = findAhead(
      modified,
      modifiedIndex + 1,
      modifiedEnd,
      original[originalIndex],
    );
    if (removedDistance < addedDistance) {
      for (let offset = 0; offset < removedDistance; offset += 1) {
        result.push({ type: "removed", original: originalIndex++ });
      }
    } else if (addedDistance < Number.POSITIVE_INFINITY) {
      for (let offset = 0; offset < addedDistance; offset += 1) {
        result.push({ type: "added", modified: modifiedIndex++ });
      }
    } else {
      const similarity = textSimilarity(
        original[originalIndex].alignmentText ?? original[originalIndex].normalizedText,
        modified[modifiedIndex].alignmentText ?? modified[modifiedIndex].normalizedText,
      );
      if (similarity >= MIN_MODIFICATION_SIMILARITY) {
        result.push({ type: "modified", original: originalIndex++, modified: modifiedIndex++ });
      } else {
        result.push({ type: "removed", original: originalIndex++ });
        result.push({ type: "added", modified: modifiedIndex++ });
      }
    }
  }
  while (originalIndex < originalEnd) {
    result.push({ type: "removed", original: originalIndex++ });
  }
  while (modifiedIndex < modifiedEnd) {
    result.push({ type: "added", modified: modifiedIndex++ });
  }
  return result;
}

function findAhead(
  paragraphs: ParagraphSnapshot[],
  start: number,
  end: number,
  target: ParagraphSnapshot,
): number {
  const limit = Math.min(end, start + GREEDY_LOOKAHEAD);
  for (let index = start; index < limit; index += 1) {
    if (sameParagraph(paragraphs[index], target)) return index - start + 1;
  }
  return Number.POSITIVE_INFINITY;
}

function sameParagraph(left: ParagraphSnapshot, right: ParagraphSnapshot): boolean {
  if (left.alignmentIdentity || right.alignmentIdentity) {
    return left.alignmentIdentity !== undefined &&
      left.alignmentIdentity === right.alignmentIdentity;
  }
  return left.fingerprint === right.fingerprint &&
    (left.alignmentText ?? left.normalizedText) ===
      (right.alignmentText ?? right.normalizedText);
}

function textSimilarity(left: string, right: string): number {
  const longest = Math.max(left.length, right.length);
  if (longest === 0) {
    return 1;
  }
  if (longest > MAX_EXACT_SIMILARITY_LENGTH) {
    return sampledTextSimilarity(left, right);
  }
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return 1 - previous[right.length] / longest;
}

function sampledTextSimilarity(left: string, right: string): number {
  let prefix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < left.length - prefix &&
    suffix < right.length - prefix &&
    left[left.length - suffix - 1] === right[right.length - suffix - 1]
  ) suffix += 1;
  const longest = Math.max(left.length, right.length, 1);
  const edgeSimilarity = (prefix + suffix) / longest;
  const leftGrams = sampledBigrams(left);
  const rightGrams = sampledBigrams(right);
  let overlap = 0;
  for (const gram of leftGrams) if (rightGrams.has(gram)) overlap += 1;
  const gramSimilarity = overlap / Math.max(leftGrams.size, rightGrams.size, 1);
  const lengthSimilarity = Math.min(left.length, right.length) / longest;
  return Math.max(edgeSimilarity, gramSimilarity * lengthSimilarity);
}

function sampledBigrams(text: string): Set<string> {
  const step = Math.max(1, Math.floor(text.length / MAX_EXACT_SIMILARITY_LENGTH));
  const grams = new Set<string>();
  for (let index = 0; index + 1 < text.length; index += step) {
    grams.add(text.slice(index, index + 2));
  }
  return grams;
}

function anchorFor(
  paragraph: ParagraphSnapshot,
  textRange: { start: number; end: number },
  confidence: DocumentAnchor["confidence"],
): DocumentAnchor {
  return {
    target: "body-text",
    sectionIndex: paragraph.sectionIndex,
    paragraphIndex: paragraph.paragraphIndex,
    textRange,
    textFingerprint: paragraph.fingerprint,
    generatedPrefix: paragraph.outline
      ? { text: paragraph.outline.number, pageIndex: paragraph.outline.pageIndex }
      : undefined,
    confidence,
  };
}

function nearestContextAnchor(
  paragraphs: ParagraphSnapshot[],
  index: number | undefined,
): DocumentAnchor | undefined {
  if (index === undefined || !paragraphs[index]) {
    return undefined;
  }
  const paragraph = paragraphs[index];
  return {
    target: "body-text",
    sectionIndex: paragraph.sectionIndex,
    paragraphIndex: paragraph.paragraphIndex,
    textRange: { start: 0, end: Math.min(1, paragraph.text.length) },
    textFingerprint: paragraph.fingerprint,
    generatedPrefix: paragraph.outline
      ? { text: paragraph.outline.number, pageIndex: paragraph.outline.pageIndex }
      : undefined,
    confidence: "contextual",
  };
}

function findNeighborOriginalIndex(
  steps: ParagraphAlignmentStep[],
  target: ParagraphAlignmentStep,
): number | undefined {
  const position = steps.indexOf(target);
  for (let distance = 1; distance < steps.length; distance += 1) {
    const before = steps[position - distance];
    if (before && isPairedStep(before)) return before.original;
    const after = steps[position + distance];
    if (after && isPairedStep(after)) return after.original;
  }
  return undefined;
}

function findNeighborModifiedIndex(
  steps: ParagraphAlignmentStep[],
  target: ParagraphAlignmentStep,
): number | undefined {
  const position = steps.indexOf(target);
  for (let distance = 1; distance < steps.length; distance += 1) {
    const before = steps[position - distance];
    if (before && isPairedStep(before)) return before.modified;
    const after = steps[position + distance];
    if (after && isPairedStep(after)) return after.modified;
  }
  return undefined;
}

function isPairedStep(
  step: ParagraphAlignmentStep,
): step is Extract<ParagraphAlignmentStep, { type: "equal" | "modified" }> {
  return step.type === "equal" || step.type === "modified";
}
