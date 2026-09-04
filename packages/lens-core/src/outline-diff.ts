import type {
  BodyTextAnchor,
  DocumentSnapshot,
  OutlineChange,
  ParagraphSnapshot,
} from "./types";
import {
  alignParagraphSnapshots,
  type ParagraphAlignmentStep,
} from "./text-diff";
import { diffTextSegments } from "./review-ink";
import { normalizeExactText } from "./text";

export type OutlineParagraph = ParagraphSnapshot & {
  outline: NonNullable<ParagraphSnapshot["outline"]>;
};

export interface OutlineAlignmentStep {
  type: ParagraphAlignmentStep["type"];
  original?: OutlineParagraph;
  modified?: OutlineParagraph;
}

/**
 * Compares generated outline entries separately from ordinary body text.
 * The numbering remains semantic metadata; it is never guessed from strings.
 */
export function compareOutlineSnapshots(
  original: DocumentSnapshot,
  modified: DocumentSnapshot,
): OutlineChange[] {
  const alignment = alignOutlineSnapshots(original, modified);
  const changed = alignment.filter((step) =>
    step.type !== "equal" ||
    normalizeExactText(step.original?.text ?? "") !== normalizeExactText(step.modified?.text ?? ""),
  );
  return changed.map((step, index) => toOutlineChange(step, alignment, index));
}

/**
 * Aligns both outline streams without treating generated numbering as identity.
 * Number labels routinely shift after an insertion; title/level continuity is
 * the stable input used by both the outline diff and the merged Structure tree.
 */
export function alignOutlineSnapshots(
  original: DocumentSnapshot,
  modified: DocumentSnapshot,
): OutlineAlignmentStep[] {
  const before = original.paragraphs.filter(hasOutline);
  const after = modified.paragraphs.filter(hasOutline);
  const aligned = alignParagraphSnapshots(
    before.map(outlineComparable),
    after.map(outlineComparable),
  ).map((step) => alignmentStep(step, before, after));
  return coalesceStructuralReplacements(aligned);
}

function outlineComparable(paragraph: OutlineParagraph): OutlineParagraph {
  return {
    ...paragraph,
    alignmentIdentity: `${paragraph.outline.level}:${paragraph.normalizedText}`,
    alignmentText: `${paragraph.outline.level}:${paragraph.outline.number}:${paragraph.normalizedText}`,
  };
}

function alignmentStep(
  step: ParagraphAlignmentStep,
  original: OutlineParagraph[],
  modified: OutlineParagraph[],
): OutlineAlignmentStep {
  if (step.type === "added") return { type: step.type, modified: modified[step.modified] };
  if (step.type === "removed") return { type: step.type, original: original[step.original] };
  return {
    type: step.type,
    original: original[step.original],
    modified: modified[step.modified],
  };
}

function coalesceStructuralReplacements(
  alignment: readonly OutlineAlignmentStep[],
): OutlineAlignmentStep[] {
  const result: OutlineAlignmentStep[] = [];
  for (let index = 0; index < alignment.length; index += 1) {
    const current = alignment[index];
    const next = alignment[index + 1];
    if (current.type === "added" && next?.type === "removed" &&
      sameStructuralSlot(next.original, current.modified)) {
      result.push({ type: "modified", original: next.original, modified: current.modified });
      index += 1;
      continue;
    }
    if (current.type === "removed" && next?.type === "added" &&
      sameStructuralSlot(current.original, next.modified)) {
      result.push({ type: "modified", original: current.original, modified: next.modified });
      index += 1;
      continue;
    }
    result.push(current);
  }
  return result;
}

function sameStructuralSlot(
  original: OutlineParagraph | undefined,
  modified: OutlineParagraph | undefined,
): boolean {
  return Boolean(original && modified &&
    original.outline.level === modified.outline.level &&
    original.outline.number === modified.outline.number);
}

function toOutlineChange(
  step: OutlineAlignmentStep,
  alignment: readonly OutlineAlignmentStep[],
  index: number,
): OutlineChange {
  const before = step.original;
  const after = step.modified;
  const representative = after ?? before;
  if (!representative) {
    throw new Error("개요 변경에 개요 metadata가 없습니다.");
  }
  const kind = step.type === "equal" ? "modified" : step.type;
  return {
    id: `outline-${index + 1}`,
    type: "outline",
    kind,
    detail: kind === "modified"
      ? "renamed"
      : kind === "added"
        ? "outline-added"
        : "outline-removed",
    level: representative.outline.level,
    locationLabel: `${representative.outline.number} ${representative.text}`.trim(),
    originalText: before?.text,
    modifiedText: after?.text,
    originalAnchor: before ? wholeOutlineAnchor(before) : undefined,
    modifiedAnchor: after ? wholeOutlineAnchor(after) : undefined,
    originalContextAnchor: before ? undefined : nearestContextAnchor(alignment, step, "original"),
    modifiedContextAnchor: after ? undefined : nearestContextAnchor(alignment, step, "modified"),
    segments: before && after ? diffTextSegments(before.text, after.text) : undefined,
  };
}

function nearestContextAnchor(
  alignment: readonly OutlineAlignmentStep[],
  target: OutlineAlignmentStep,
  side: "original" | "modified",
): BodyTextAnchor | undefined {
  const position = alignment.indexOf(target);
  for (let distance = 1; distance < alignment.length; distance += 1) {
    const before = alignment[position - distance]?.[side];
    if (before) return contextOutlineAnchor(before);
    const after = alignment[position + distance]?.[side];
    if (after) return contextOutlineAnchor(after);
  }
  return undefined;
}

function wholeOutlineAnchor(paragraph: ParagraphSnapshot): BodyTextAnchor {
  if (!paragraph.outline) throw new Error("개요 metadata가 없습니다.");
  return {
    target: "body-text",
    sectionIndex: paragraph.sectionIndex,
    paragraphIndex: paragraph.paragraphIndex,
    textRange: { start: 0, end: paragraph.text.length },
    textFingerprint: paragraph.fingerprint,
    generatedPrefix: {
      text: paragraph.outline.number,
      pageIndex: paragraph.outline.pageIndex,
    },
    confidence: "exact",
  };
}

function contextOutlineAnchor(paragraph: OutlineParagraph): BodyTextAnchor {
  return {
    ...wholeOutlineAnchor(paragraph),
    textRange: { start: 0, end: Math.min(1, paragraph.text.length) },
    confidence: "contextual",
  };
}

function hasOutline(
  paragraph: ParagraphSnapshot,
): paragraph is ParagraphSnapshot & { outline: NonNullable<ParagraphSnapshot["outline"]> } {
  return paragraph.outline !== undefined;
}
