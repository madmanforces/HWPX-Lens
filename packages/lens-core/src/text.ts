import type { ParagraphSnapshot, TextRange } from "./types";

const ZERO_WIDTH_AND_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b\ufeff\ufffc]/g;
const COLLAPSIBLE_WHITESPACE = /[\t\n\r ]+/g;

export function normalizeParagraphText(text: string): string {
  return text
    .normalize("NFC")
    .replace(ZERO_WIDTH_AND_CONTROL, "")
    .replace(COLLAPSIBLE_WHITESPACE, " ")
    .trim();
}

/** Keeps meaningful whitespace while removing Unicode serialization noise. */
export function normalizeExactText(text: string): string {
  return text.normalize("NFC").replace(ZERO_WIDTH_AND_CONTROL, "");
}

export function fingerprintText(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function createParagraphSnapshot(
  sectionIndex: number,
  paragraphIndex: number,
  text: string,
): ParagraphSnapshot | undefined {
  const normalizedText = normalizeParagraphText(text);
  if (!normalizedText) {
    return undefined;
  }

  return {
    sectionIndex,
    paragraphIndex,
    text,
    normalizedText,
    fingerprint: fingerprintText(normalizedText),
  };
}

export function findChangedRange(before: string, after: string): {
  before: TextRange;
  after: TextRange;
} {
  let prefix = 0;
  const shortest = Math.min(before.length, after.length);
  while (prefix < shortest && before[prefix] === after[prefix]) {
    prefix += 1;
  }

  let beforeSuffix = before.length;
  let afterSuffix = after.length;
  while (
    beforeSuffix > prefix &&
    afterSuffix > prefix &&
    before[beforeSuffix - 1] === after[afterSuffix - 1]
  ) {
    beforeSuffix -= 1;
    afterSuffix -= 1;
  }

  return {
    before: ensureSelectableRange(before, { start: prefix, end: beforeSuffix }),
    after: ensureSelectableRange(after, { start: prefix, end: afterSuffix }),
  };
}

export function ensureSelectableRange(text: string, range: TextRange): TextRange {
  if (range.end > range.start || text.length === 0) {
    return range;
  }
  const start = Math.max(0, Math.min(range.start, text.length - 1));
  return { start, end: Math.min(text.length, start + 1) };
}
