import type {
  LensDocument,
  NativeBodyPosition,
  ReviewInkGeometry,
  ReviewInkModel,
  VisualRect,
  VisualTarget,
  WhitespaceBoundaryGeometry,
} from "@hwpx-lens/lens-core";

export async function materializeReviewInk(
  model: ReviewInkModel,
  document: LensDocument,
): Promise<ReviewInkGeometry | undefined> {
  if (model.kind === "whitespace-missing") {
    return materializeWhitespace(model, document);
  }
  if (model.kind === "text-boundary") {
    return materializeTextBoundary(model, document);
  }
  const target = await locateTarget(model, document);
  if (!target || target.rects.length === 0) return undefined;
  return {
    id: model.id,
    changeId: model.changeId,
    kind: model.kind,
    side: model.side,
    pageIndex: target.pageIndex,
    rects: target.rects.filter((rect) => rect.pageIndex === target.pageIndex),
  };
}

async function materializeTextBoundary(
  model: ReviewInkModel,
  document: LensDocument,
): Promise<ReviewInkGeometry | undefined> {
  const interaction = document.interaction;
  const offset = model.textBoundaryOffset;
  if (
    model.anchor.target !== "body-text" ||
    interaction?.kind !== "native" ||
    offset === undefined ||
    offset < 0
  ) return undefined;
  const target = await interaction.resolveTextTarget({
    ...model.anchor,
    textRange: { start: Math.max(0, offset - 1), end: offset + 1 },
  });
  const base: Omit<NativeBodyPosition, "charOffset"> = {
    target: "body-text",
    pageIndex: target.pageIndex,
    sectionIndex: model.anchor.sectionIndex,
    paragraphIndex: model.anchor.paragraphIndex,
  };
  const character = offset > 0
    ? interaction.getCharacterGeometry({ ...base, charOffset: offset - 1 })
    : interaction.getCharacterGeometry({ ...base, charOffset: 0 });
  if (!character) return undefined;
  const boundary = offset > 0 ? character.after : character.before;
  return {
    id: model.id,
    changeId: model.changeId,
    kind: model.kind,
    side: model.side,
    pageIndex: boundary.pageIndex,
    rects: [],
    textBoundary: boundary,
  };
}

async function materializeWhitespace(
  model: ReviewInkModel,
  document: LensDocument,
): Promise<ReviewInkGeometry | undefined> {
  const interaction = document.interaction;
  const offset = model.whitespaceBoundaryOffset;
  if (
    model.anchor.target !== "body-text" ||
    interaction?.kind !== "native" ||
    offset === undefined ||
    offset <= 0
  ) return undefined;

  const target = await interaction.resolveTextTarget({
    ...model.anchor,
    textRange: { start: offset - 1, end: offset + 1 },
  });
  const base: Omit<NativeBodyPosition, "charOffset"> = {
    target: "body-text",
    pageIndex: target.pageIndex,
    sectionIndex: model.anchor.sectionIndex,
    paragraphIndex: model.anchor.paragraphIndex,
  };
  const before = interaction.getCharacterGeometry({ ...base, charOffset: offset - 1 });
  const after = interaction.getCharacterGeometry({ ...base, charOffset: offset });
  if (!before || !after) return undefined;

  const beforeRect = closestRect(before.rects, before.after.x, before.after.y, target.pageIndex);
  const afterRect = closestRect(after.rects, after.before.x, after.before.y, beforeRect?.pageIndex);
  if (!beforeRect || !afterRect) return undefined;
  const boundary = whitespaceBoundary(
    beforeRect,
    afterRect,
    before.after.x,
    after.before.x,
    model.whitespaceMark ?? "check",
  );
  return {
    id: model.id,
    changeId: model.changeId,
    kind: model.kind,
    side: model.side,
    pageIndex: boundary.pageIndex,
    rects: [],
    whitespaceBoundary: boundary,
  };
}

async function locateTarget(
  model: ReviewInkModel,
  document: LensDocument,
): Promise<VisualTarget | undefined> {
  try {
    if (model.anchor.target === "body-text" && document.interaction) {
      return await document.interaction.resolveTextTarget(model.anchor);
    }
    return await document.rendering.resolveVisualTarget(model.anchor);
  } catch {
    return undefined;
  }
}

function whitespaceBoundary(
  before: VisualRect,
  after: VisualRect,
  beforeBoundaryX: number,
  afterBoundaryX: number,
  mark: "check" | "join",
): WhitespaceBoundaryGeometry {
  const sameLine = before.pageIndex === after.pageIndex &&
    Math.abs(centerY(before) - centerY(after)) <= Math.max(before.height, after.height) * 0.6;
  const boundaryX = sameLine
    ? (beforeBoundaryX + afterBoundaryX) / 2
    : beforeBoundaryX;
  const baselineY = before.y + before.height;
  const markerHeight = Math.max(Math.min(before.height, after.height) * 0.3, 4);
  // This proofing mark denotes one insertion boundary, not both adjacent
  // glyphs. Keep it compact and centre it on the engine-provided caret edges.
  // The old 55%/45% spans looked like a range from an earlier to a later word.
  const localCharacterWidth = Math.min(before.width, after.width);
  const halfWidth = Math.max(Math.min(localCharacterWidth * 0.3, 5), 3);
  const left = boundaryX - halfWidth;
  const right = boundaryX + halfWidth;
  return {
    pageIndex: before.pageIndex,
    before,
    after,
    boundaryX,
    baselineY,
    mark,
    marker: {
      x: left,
      y: baselineY + Math.max(before.height * 0.08, 1),
      width: right - left,
      height: markerHeight,
    },
  };
}

function closestRect(
  rects: VisualRect[],
  x: number,
  y: number,
  pageIndex: number | undefined,
): VisualRect | undefined {
  return rects
    .filter((rect) => pageIndex === undefined || rect.pageIndex === pageIndex)
    .sort((left, right) => distance(left, x, y) - distance(right, x, y))[0];
}

function distance(rect: VisualRect, x: number, y: number): number {
  return Math.abs((rect.x + rect.width / 2) - x) + Math.abs(centerY(rect) - y);
}

function centerY(rect: VisualRect): number {
  return rect.y + rect.height / 2;
}
