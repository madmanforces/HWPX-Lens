import { createHash } from "node:crypto";
import { HwpDocument } from "@rhwp/core";
import { sanitizeRenderedSvg } from "../../packages/hwpx-adapter/src/svg-safety";

interface RhwpPageInfo {
  width?: unknown;
  height?: unknown;
}

interface RhwpLayoutRun {
  text?: unknown;
  x?: unknown;
  y?: unknown;
  w?: unknown;
  h?: unknown;
  secIdx?: unknown;
  paraIdx?: unknown;
  charStart?: unknown;
  cellPath?: unknown;
  parentParaIdx?: unknown;
  controlIdx?: unknown;
  cellIdx?: unknown;
  cellParaIdx?: unknown;
}

interface RhwpTextLayout {
  runs?: unknown;
}

interface VisualRect {
  pageIndex?: unknown;
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
}

export interface ParagraphFidelityDiagnostic {
  sectionIndex: number;
  paragraphIndex: number;
  textFingerprint: string;
  textLength: number;
  meaningfulCharacters: number;
  layoutCoveredMeaningfulCharacters: number;
  pageHint: number | null;
  layoutPages: number[];
  selectionRectCount: number;
  selectionPages: number[];
  flags: string[];
}

export interface PageFidelityDiagnostic {
  pageIndex: number;
  width: number;
  height: number;
  layoutRunCount: number;
  bodyRunCount: number;
  cellRunCount: number;
  generatedRunCount: number;
  layoutMeaningfulCharacters: number;
  rawSvgMeaningfulCharacters: number;
  sanitizedSvgMeaningfulCharacters: number;
  rawSvgTextDeficit: number;
  sanitizedSvgTextDeficit: number;
  sanitizerTextDrift: number;
  captionNumberTokens: number;
  textElements: number;
  imageElements: number;
  sourceImageKeyCount: number;
  imageMimeCounts: Record<string, number>;
  sanitizedBlockedImages: number;
  clipPaths: number;
  clipSuspectTextElements: number;
  clipSuspectDirections: Record<string, number>;
  clipSuspectSamples: Array<{
    direction: string;
    textFingerprint: string;
    x: number;
    y: number;
    clipX: number;
    clipY: number;
    clipWidth: number;
    clipHeight: number;
  }>;
  outOfPageLayoutRuns: number;
  outOfPageBodyRuns: number;
  outOfPageCellRuns: number;
  outOfPageGeneratedRuns: number;
  emptyOutOfPageLayoutRuns: number;
  outOfPageLeftRuns: number;
  outOfPageTopRuns: number;
  outOfPageRightRuns: number;
  outOfPageBottomRuns: number;
  nearPageBottomLayoutRuns: number;
  layoutBounds: { minX: number | null; minY: number | null; maxX: number | null; maxY: number | null };
  outOfPageSamples: Array<{
    kind: "body" | "cell" | "generated";
    sectionIndex: number | null;
    paragraphIndex: number | null;
    parentParagraphIndex: number | null;
    controlIndex: number | null;
    cellIndex: number | null;
    cellParagraphIndex: number | null;
    charStart: number | null;
    textFingerprint: string;
    textLength: number;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
}

export interface TextCompletenessAuditResult {
  schemaVersion: 1;
  pageCount: number;
  sourceParagraphCount: number;
  semanticParagraphCount: number;
  semanticMeaningfulCharacters: number;
  mappedParagraphCount: number;
  paragraphsWithSelectionGeometry: number;
  paragraphsWithMissingLayoutText: number;
  missingLayoutMeaningfulCharacters: number;
  selectionGeometryFailures: number;
  pageHintMismatches: number;
  bodyLayoutRunMismatches: number;
  pagesWithRawSvgTextDeficit: number;
  rawSvgTextDeficit: number;
  pagesWithSanitizerTextDrift: number;
  sanitizerTextDrift: number;
  pagesWithOutOfBoundsText: number;
  outOfPageLayoutRuns: number;
  emptyOutOfPageLayoutRuns: number;
  pagesWithClipSuspects: number;
  clipSuspectTextElements: number;
  captionNumberTokens: number;
  sourceImageKeyCount: number;
  sourceImageFormatCounts: Record<string, number>;
  durationMs: number;
  suspects: ParagraphFidelityDiagnostic[];
  pages: PageFidelityDiagnostic[];
}

interface ParagraphState {
  sectionIndex: number;
  paragraphIndex: number;
  text: string;
  meaningfulCharacters: number;
  covered: boolean[];
  layoutPages: Set<number>;
  bodyRunMismatch: boolean;
}

/**
 * Public-API-only diagnostic. It deliberately keeps source text out of the
 * returned structure so ignored local fixtures cannot leak into reports.
 */
export function auditRhwpTextCompleteness(bytes: Uint8Array): TextCompletenessAuditResult {
  const startedAt = performance.now();
  const document = new HwpDocument(bytes);
  try {
    const paragraphStates = collectParagraphStates(document);
    const pages: PageFidelityDiagnostic[] = [];
    const sourceImageKeys = new Set<string>();
    let bodyLayoutRunMismatches = 0;

    for (let pageIndex = 0; pageIndex < document.pageCount(); pageIndex += 1) {
      const pageInfo = parsePageInfo(document.getPageInfo(pageIndex));
      const layout = parseJson<RhwpTextLayout>(document.getPageTextLayout(pageIndex));
      const runs = Array.isArray(layout.runs) ? layout.runs : [];
      let bodyRunCount = 0;
      let cellRunCount = 0;
      let generatedRunCount = 0;
      let outOfPageLayoutRuns = 0;
      let outOfPageBodyRuns = 0;
      let outOfPageCellRuns = 0;
      let outOfPageGeneratedRuns = 0;
      let emptyOutOfPageLayoutRuns = 0;
      let outOfPageLeftRuns = 0;
      let outOfPageTopRuns = 0;
      let outOfPageRightRuns = 0;
      let outOfPageBottomRuns = 0;
      let nearPageBottomLayoutRuns = 0;
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      const outOfPageSamples: PageFidelityDiagnostic["outOfPageSamples"] = [];
      const layoutText: string[] = [];

      for (const value of runs) {
        if (!isRecord(value)) continue;
        const run = value as RhwpLayoutRun;
        if (typeof run.text !== "string") continue;
        layoutText.push(run.text);
        const isCellRun = Array.isArray(run.cellPath);
        const isBodyRun = !isCellRun &&
          Number.isInteger(run.secIdx) &&
          Number.isInteger(run.paraIdx) &&
          Number.isInteger(run.charStart) &&
          run.paraIdx !== 0xffff_ffff;
        const x = finiteNumber(run.x);
        const y = finiteNumber(run.y);
        const width = finiteNumber(run.w);
        const height = finiteNumber(run.h);
        if (x !== null && y !== null && width !== null && height !== null) {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x + width);
          maxY = Math.max(maxY, y + height);
          const outsideLeft = x < -0.5;
          const outsideTop = y < -0.5;
          const outsideRight = x + width > pageInfo.width + 0.5;
          const outsideBottom = y + height > pageInfo.height + 0.5;
          if (outsideLeft || outsideTop || outsideRight || outsideBottom) {
            if (countMeaningful(run.text) === 0) {
              emptyOutOfPageLayoutRuns += 1;
            } else {
              outOfPageLayoutRuns += 1;
              if (isCellRun) outOfPageCellRuns += 1;
              else if (isBodyRun) outOfPageBodyRuns += 1;
              else outOfPageGeneratedRuns += 1;
            }
            if (countMeaningful(run.text) > 0 && outOfPageSamples.length < 5) {
              outOfPageSamples.push({
                kind: isCellRun ? "cell" : isBodyRun ? "body" : "generated",
                sectionIndex: integerOrNull(run.secIdx),
                paragraphIndex: integerOrNull(run.paraIdx),
                parentParagraphIndex: integerOrNull(run.parentParaIdx),
                controlIndex: integerOrNull(run.controlIdx),
                cellIndex: integerOrNull(run.cellIdx),
                cellParagraphIndex: integerOrNull(run.cellParaIdx),
                charStart: integerOrNull(run.charStart),
                textFingerprint: fingerprint(run.text),
                textLength: run.text.length,
                x,
                y,
                width,
                height,
              });
            }
          }
          if (outsideLeft) outOfPageLeftRuns += 1;
          if (outsideTop) outOfPageTopRuns += 1;
          if (outsideRight) outOfPageRightRuns += 1;
          if (outsideBottom) outOfPageBottomRuns += 1;
          const bottomBand = Math.max(1_000, pageInfo.height * 0.04);
          if (y + height >= pageInfo.height - bottomBand) nearPageBottomLayoutRuns += 1;
        }

        if (isCellRun) {
          cellRunCount += 1;
          continue;
        }
        if (isBodyRun) {
          bodyRunCount += 1;
          const key = paragraphKey(run.secIdx as number, run.paraIdx as number);
          const state = paragraphStates.get(key);
          const charStart = run.charStart as number;
          if (!state || state.text.slice(charStart, charStart + run.text.length) !== run.text) {
            bodyLayoutRunMismatches += 1;
            if (state) state.bodyRunMismatch = true;
            continue;
          }
          state.layoutPages.add(pageIndex);
          for (let offset = charStart; offset < charStart + run.text.length; offset += 1) {
            if (offset >= 0 && offset < state.covered.length) state.covered[offset] = true;
          }
        } else {
          generatedRunCount += 1;
        }
      }

      const rawSvg = document.renderPageSvg(pageIndex);
      const sanitizedSvg = sanitizeRenderedSvg(rawSvg).markup;
      const rawFacts = svgFacts(rawSvg);
      const sanitizedFacts = svgFacts(sanitizedSvg);
      const layoutJoined = layoutText.join("");
      const rawDeficit = characterMultisetDeficit(layoutJoined, rawFacts.text);
      const sanitizedDeficit = characterMultisetDeficit(layoutJoined, sanitizedFacts.text);
      const sanitizerTextDrift = characterMultisetDistance(rawFacts.text, sanitizedFacts.text);
      const pageSourceImageKeys = parseSourceImageKeys(document.getPageSourceImageKeys(pageIndex));
      pageSourceImageKeys.forEach((key) => sourceImageKeys.add(key));

      pages.push({
        pageIndex,
        width: pageInfo.width,
        height: pageInfo.height,
        layoutRunCount: runs.length,
        bodyRunCount,
        cellRunCount,
        generatedRunCount,
        layoutMeaningfulCharacters: countMeaningful(layoutJoined),
        rawSvgMeaningfulCharacters: countMeaningful(rawFacts.text),
        sanitizedSvgMeaningfulCharacters: countMeaningful(sanitizedFacts.text),
        rawSvgTextDeficit: rawDeficit,
        sanitizedSvgTextDeficit: sanitizedDeficit,
        sanitizerTextDrift,
        captionNumberTokens: countCaptionNumberTokens(layoutJoined),
        textElements: rawFacts.textElements,
        imageElements: rawFacts.imageElements,
        sourceImageKeyCount: pageSourceImageKeys.length,
        imageMimeCounts: rawFacts.imageMimeCounts,
        sanitizedBlockedImages: sanitizedFacts.blockedImages,
        clipPaths: rawFacts.clipPaths,
        clipSuspectTextElements: rawFacts.clipSuspectTextElements,
        clipSuspectDirections: rawFacts.clipSuspectDirections,
        clipSuspectSamples: rawFacts.clipSuspectSamples,
        outOfPageLayoutRuns,
        outOfPageBodyRuns,
        outOfPageCellRuns,
        outOfPageGeneratedRuns,
        emptyOutOfPageLayoutRuns,
        outOfPageLeftRuns,
        outOfPageTopRuns,
        outOfPageRightRuns,
        outOfPageBottomRuns,
        nearPageBottomLayoutRuns,
        layoutBounds: {
          minX: Number.isFinite(minX) ? minX : null,
          minY: Number.isFinite(minY) ? minY : null,
          maxX: Number.isFinite(maxX) ? maxX : null,
          maxY: Number.isFinite(maxY) ? maxY : null,
        },
        outOfPageSamples,
      });
    }

    const suspects: ParagraphFidelityDiagnostic[] = [];
    let sourceParagraphCount = 0;
    let semanticParagraphCount = 0;
    let semanticMeaningfulCharacters = 0;
    let mappedParagraphCount = 0;
    let paragraphsWithSelectionGeometry = 0;
    let paragraphsWithMissingLayoutText = 0;
    let missingLayoutMeaningfulCharacters = 0;
    let selectionGeometryFailures = 0;
    let pageHintMismatches = 0;

    for (const state of paragraphStates.values()) {
      sourceParagraphCount += 1;
      if (state.meaningfulCharacters === 0) continue;
      semanticParagraphCount += 1;
      semanticMeaningfulCharacters += state.meaningfulCharacters;
      let coveredMeaningful = 0;
      for (let offset = 0; offset < state.text.length; offset += 1) {
        if (isMeaningful(state.text[offset]) && state.covered[offset]) coveredMeaningful += 1;
      }
      if (coveredMeaningful === state.meaningfulCharacters) mappedParagraphCount += 1;
      const missing = state.meaningfulCharacters - coveredMeaningful;
      if (missing > 0) {
        paragraphsWithMissingLayoutText += 1;
        missingLayoutMeaningfulCharacters += missing;
      }

      const pageHint = parsePageHint(document.getPageOfPosition(state.sectionIndex, state.paragraphIndex));
      let selectionRects: VisualRect[] = [];
      let selectionFailed = false;
      try {
        const parsed = parseJson<unknown>(document.getSelectionRects(
          state.sectionIndex,
          state.paragraphIndex,
          0,
          state.paragraphIndex,
          state.text.length,
        ));
        selectionRects = Array.isArray(parsed) ? parsed.filter(isVisualRect) : [];
      } catch {
        selectionFailed = true;
      }
      if (selectionRects.length > 0) paragraphsWithSelectionGeometry += 1;
      else selectionGeometryFailures += 1;
      const selectionPages = uniqueSorted(selectionRects.map((rect) => rect.pageIndex as number));
      const layoutPages = uniqueSorted([...state.layoutPages]);
      const pageHintMismatch = pageHint !== null && layoutPages.length > 0 && !layoutPages.includes(pageHint);
      if (pageHintMismatch) pageHintMismatches += 1;

      const flags: string[] = [];
      if (missing > 0) flags.push("missing-layout-text");
      if (selectionRects.length === 0) flags.push(selectionFailed ? "selection-api-error" : "selection-empty");
      if (pageHintMismatch) flags.push("page-hint-mismatch");
      if (state.bodyRunMismatch) flags.push("body-run-source-mismatch");
      if (flags.length > 0) {
        suspects.push({
          sectionIndex: state.sectionIndex,
          paragraphIndex: state.paragraphIndex,
          textFingerprint: fingerprint(state.text),
          textLength: state.text.length,
          meaningfulCharacters: state.meaningfulCharacters,
          layoutCoveredMeaningfulCharacters: coveredMeaningful,
          pageHint,
          layoutPages,
          selectionRectCount: selectionRects.length,
          selectionPages,
          flags,
        });
      }
    }

    const sourceImageFormatCounts: Record<string, number> = {};
    for (const key of sourceImageKeys) {
      let format = "unreadable";
      try {
        format = sniffImageFormat(document.getSourceImageBytes(key));
      } catch {
        // Keep the diagnostic non-fatal: an unreadable source is itself a fidelity signal.
      }
      sourceImageFormatCounts[format] = (sourceImageFormatCounts[format] ?? 0) + 1;
    }

    return {
      schemaVersion: 1,
      pageCount: document.pageCount(),
      sourceParagraphCount,
      semanticParagraphCount,
      semanticMeaningfulCharacters,
      mappedParagraphCount,
      paragraphsWithSelectionGeometry,
      paragraphsWithMissingLayoutText,
      missingLayoutMeaningfulCharacters,
      selectionGeometryFailures,
      pageHintMismatches,
      bodyLayoutRunMismatches,
      pagesWithRawSvgTextDeficit: pages.filter((page) => page.rawSvgTextDeficit > 0).length,
      rawSvgTextDeficit: pages.reduce((total, page) => total + page.rawSvgTextDeficit, 0),
      pagesWithSanitizerTextDrift: pages.filter((page) => page.sanitizerTextDrift > 0).length,
      sanitizerTextDrift: pages.reduce((total, page) => total + page.sanitizerTextDrift, 0),
      pagesWithOutOfBoundsText: pages.filter((page) => page.outOfPageLayoutRuns > 0).length,
      outOfPageLayoutRuns: pages.reduce((total, page) => total + page.outOfPageLayoutRuns, 0),
      emptyOutOfPageLayoutRuns: pages.reduce((total, page) => total + page.emptyOutOfPageLayoutRuns, 0),
      pagesWithClipSuspects: pages.filter((page) => page.clipSuspectTextElements > 0).length,
      clipSuspectTextElements: pages.reduce((total, page) => total + page.clipSuspectTextElements, 0),
      captionNumberTokens: pages.reduce((total, page) => total + page.captionNumberTokens, 0),
      sourceImageKeyCount: sourceImageKeys.size,
      sourceImageFormatCounts,
      durationMs: Number((performance.now() - startedAt).toFixed(3)),
      suspects,
      pages,
    };
  } finally {
    document.free();
  }
}

function collectParagraphStates(document: HwpDocument): Map<string, ParagraphState> {
  const states = new Map<string, ParagraphState>();
  for (let sectionIndex = 0; sectionIndex < document.getSectionCount(); sectionIndex += 1) {
    const count = document.getParagraphCount(sectionIndex);
    for (let paragraphIndex = 0; paragraphIndex < count; paragraphIndex += 1) {
      const length = document.getParagraphLength(sectionIndex, paragraphIndex);
      const text = document.getTextRange(sectionIndex, paragraphIndex, 0, length);
      states.set(paragraphKey(sectionIndex, paragraphIndex), {
        sectionIndex,
        paragraphIndex,
        text,
        meaningfulCharacters: countMeaningful(text),
        covered: Array(text.length).fill(false),
        layoutPages: new Set(),
        bodyRunMismatch: false,
      });
    }
  }
  return states;
}

function parsePageInfo(value: string): { width: number; height: number } {
  const parsed = parseJson<RhwpPageInfo>(value);
  const width = finiteNumber(parsed.width);
  const height = finiteNumber(parsed.height);
  if (width === null || height === null || width <= 0 || height <= 0) {
    throw new Error("rhwp returned invalid page geometry during fidelity audit.");
  }
  return { width, height };
}

function parsePageHint(value: string): number | null {
  const parsed = parseJson<unknown>(value);
  if (Number.isInteger(parsed) && (parsed as number) >= 0) return parsed as number;
  if (!isRecord(parsed)) return null;
  for (const key of ["pageIndex", "page", "pageNum", "page_idx", "page_num"]) {
    const candidate = parsed[key];
    if (Number.isInteger(candidate) && (candidate as number) >= 0) return candidate as number;
  }
  return null;
}

function parseSourceImageKeys(value: string): string[] {
  const parsed = parseJson<unknown>(value);
  if (Array.isArray(parsed)) return parsed.filter((key): key is string => typeof key === "string");
  if (!isRecord(parsed)) return [];
  const candidate = parsed.keys ?? parsed.imageKeys ?? parsed.sourceImageKeys;
  return Array.isArray(candidate) ? candidate.filter((key): key is string => typeof key === "string") : [];
}

function sniffImageFormat(bytes: Uint8Array): string {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return "bmp";
  if (bytes.length >= 4 && bytes[0] === 0xd7 && bytes[1] === 0xcd && bytes[2] === 0xc6 && bytes[3] === 0x9a) return "wmf-placeable";
  if (bytes.length >= 6 && (bytes[0] === 0x01 || bytes[0] === 0x02) && bytes[1] === 0x00 && bytes[2] === 0x09 && bytes[3] === 0x00) return "wmf";
  if (bytes.length >= 44 && bytes[0] === 0x01 && bytes[1] === 0x00 && bytes[2] === 0x00 && bytes[3] === 0x00 && bytes[40] === 0x20 && bytes[41] === 0x45 && bytes[42] === 0x4d && bytes[43] === 0x46) return "emf";
  const prefix = new TextDecoder().decode(bytes.slice(0, 128)).trimStart().toLowerCase();
  if (prefix.startsWith("<svg") || prefix.startsWith("<?xml") && prefix.includes("<svg")) return "svg";
  return "unknown";
}

function svgFacts(markup: string): {
  text: string;
  textElements: number;
  imageElements: number;
  imageMimeCounts: Record<string, number>;
  blockedImages: number;
  clipPaths: number;
  clipSuspectTextElements: number;
  clipSuspectDirections: Record<string, number>;
  clipSuspectSamples: PageFidelityDiagnostic["clipSuspectSamples"];
} {
  const parsed = new DOMParser().parseFromString(markup, "image/svg+xml");
  if (parsed.querySelector("parsererror")) throw new Error("rhwp returned invalid SVG during fidelity audit.");
  const textElements = Array.from(parsed.querySelectorAll("text"));
  const images = Array.from(parsed.querySelectorAll("image"));
  const clipSuspects = textElements
    .map((element) => simpleClipSuspect(element, parsed))
    .filter((value): value is NonNullable<typeof value> => value !== null);
  const clipSuspectDirections: Record<string, number> = {};
  for (const suspect of clipSuspects) {
    clipSuspectDirections[suspect.direction] = (clipSuspectDirections[suspect.direction] ?? 0) + 1;
  }
  const imageMimeCounts: Record<string, number> = {};
  for (const image of images) {
    const reference = image.getAttribute("href") ?? image.getAttribute("xlink:href") ?? "";
    const mime = reference.match(/^data:([^;,]+)/iu)?.[1]?.toLowerCase() ?? "non-data-or-missing";
    imageMimeCounts[mime] = (imageMimeCounts[mime] ?? 0) + 1;
  }
  return {
    text: textElements.map((element) => element.textContent ?? "").join(""),
    textElements: textElements.length,
    imageElements: images.length,
    imageMimeCounts,
    blockedImages: images.filter((image) => image.getAttribute("data-hwpx-lens-image-status") === "blocked").length,
    clipPaths: parsed.querySelectorAll("clipPath").length,
    clipSuspectTextElements: clipSuspects.length,
    clipSuspectDirections,
    clipSuspectSamples: clipSuspects.slice(0, 5).map(({ text: content, ...suspect }) => ({
      ...suspect,
      textFingerprint: fingerprint(content),
    })),
  };
}

function simpleClipSuspect(text: Element, document: Document): {
  direction: string;
  text: string;
  x: number;
  y: number;
  clipX: number;
  clipY: number;
  clipWidth: number;
  clipHeight: number;
} | null {
  const content = text.textContent ?? "";
  if (countMeaningful(content) === 0) return null;
  let current: Element | null = text;
  while (current) {
    if (current.hasAttribute("transform")) return null;
    const reference = current.getAttribute("clip-path")?.match(/^url\(#(.+)\)$/u)?.[1];
    if (reference) {
      const escaped = globalThis.CSS?.escape ? globalThis.CSS.escape(reference) : reference.replace(/[^a-zA-Z0-9_-]/g, "");
      const clipPath = document.querySelector(`clipPath#${escaped}`);
      const rect = clipPath?.querySelector("rect");
      if (!clipPath || !rect || clipPath.hasAttribute("transform") || rect.hasAttribute("transform")) return null;
      const clipX = numberAttribute(rect, "x", 0);
      const clipY = numberAttribute(rect, "y", 0);
      const clipWidth = numberAttribute(rect, "width", Number.POSITIVE_INFINITY);
      const clipHeight = numberAttribute(rect, "height", Number.POSITIVE_INFINITY);
      const x = numberAttribute(text, "x", Number.NaN);
      const y = numberAttribute(text, "y", Number.NaN);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        const directions = [
          x < clipX - 0.5 ? "left" : "",
          x > clipX + clipWidth + 0.5 ? "right" : "",
          y < clipY - 0.5 ? "top" : "",
          y > clipY + clipHeight + 0.5 ? "bottom" : "",
        ].filter(Boolean);
        if (directions.length > 0) {
          return { direction: directions.join("+"), text: content, x, y, clipX, clipY, clipWidth, clipHeight };
        }
      }
    }
    current = current.parentElement;
  }
  return null;
}

function numberAttribute(element: Element, name: string, fallback: number): number {
  const value = Number(element.getAttribute(name));
  return Number.isFinite(value) ? value : fallback;
}

function characterMultisetDeficit(expected: string, actual: string): number {
  const counts = meaningfulCharacterCounts(actual);
  let deficit = 0;
  for (const character of Array.from(expected)) {
    if (!isMeaningful(character)) continue;
    const available = counts.get(character) ?? 0;
    if (available > 0) counts.set(character, available - 1);
    else deficit += 1;
  }
  return deficit;
}

function characterMultisetDistance(left: string, right: string): number {
  return characterMultisetDeficit(left, right) + characterMultisetDeficit(right, left);
}

function meaningfulCharacterCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const character of Array.from(text)) {
    if (isMeaningful(character)) counts.set(character, (counts.get(character) ?? 0) + 1);
  }
  return counts;
}

function countMeaningful(text: string): number {
  return Array.from(text).filter(isMeaningful).length;
}

function countCaptionNumberTokens(text: string): number {
  return [...text.matchAll(/(?:그림|표)\s*\d+(?:[-–.]\d+)*/gu)].length;
}

function isMeaningful(character: string): boolean {
  return !/[\s\u0000-\u001f\u007f\u200b\ufeff\ufffc]/u.test(character);
}

function isVisualRect(value: unknown): value is VisualRect {
  return isRecord(value) &&
    Number.isInteger(value.pageIndex) &&
    (value.pageIndex as number) >= 0 &&
    finiteNumber(value.x) !== null &&
    finiteNumber(value.y) !== null &&
    finiteNumber(value.width) !== null &&
    finiteNumber(value.height) !== null;
}

function fingerprint(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function paragraphKey(sectionIndex: number, paragraphIndex: number): string {
  return `${sectionIndex}:${paragraphIndex}`;
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function integerOrNull(value: unknown): number | null {
  return Number.isInteger(value) ? value as number : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}
