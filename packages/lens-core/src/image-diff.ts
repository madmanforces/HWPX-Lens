import type {
  ImageAnchor,
  ImageChange,
  ImageSnapshot,
  MappingConfidence,
} from "./types";

type AlignmentStep =
  | { type: "equal"; original: number; modified: number }
  | { type: "changed"; original: number; modified: number }
  | { type: "removed"; original: number }
  | { type: "added"; modified: number };

const INSERT_DELETE_COST = 1;
const MIN_MATCH_SCORE = 0.46;

/**
 * Aligns images by encoded identity and semantic/layout context. It never
 * assumes that page number alone is a stable identity after document edits.
 */
export function compareImageSnapshots(
  original: readonly ImageSnapshot[],
  modified: readonly ImageSnapshot[],
): ImageChange[] {
  const changes: ImageChange[] = [];
  for (const step of alignImages(original, modified)) {
    if (step.type === "equal") continue;
    if (step.type === "changed") {
      const before = original[step.original];
      const after = modified[step.modified];
      changes.push({
        id: `image-${changes.length + 1}`,
        type: "image",
        kind: "modified",
        detail: "image-changed",
        locationLabel: imageLabel(after),
        originalText: imageSummary(before),
        modifiedText: imageSummary(after),
        originalAnchor: imageAnchor(before, "contextual"),
        modifiedAnchor: imageAnchor(after, "contextual"),
        binaryChanged: before.sourceHash !== after.sourceHash,
        renderingChanged: before.renderFingerprint !== after.renderFingerprint,
        classification: after.classification,
        captionLabel: after.captionLabel,
      });
      continue;
    }
    if (step.type === "removed") {
      const image = original[step.original];
      changes.push({
        id: `image-${changes.length + 1}`,
        type: "image",
        kind: "removed",
        detail: "image-removed",
        locationLabel: imageLabel(image),
        originalText: imageSummary(image),
        originalAnchor: imageAnchor(image, "exact"),
        modifiedContextAnchor: neighborAnchor(modified, nearestModifiedIndex(step, original, modified)),
        binaryChanged: true,
        renderingChanged: true,
        classification: image.classification,
        captionLabel: image.captionLabel,
      });
      continue;
    }
    const image = modified[step.modified];
    changes.push({
      id: `image-${changes.length + 1}`,
      type: "image",
      kind: "added",
      detail: "image-added",
      locationLabel: imageLabel(image),
      modifiedText: imageSummary(image),
      modifiedAnchor: imageAnchor(image, "exact"),
      originalContextAnchor: neighborAnchor(original, nearestOriginalIndex(step, original, modified)),
      binaryChanged: true,
      renderingChanged: true,
      classification: image.classification,
      captionLabel: image.captionLabel,
    });
  }
  return changes;
}

function alignImages(
  original: readonly ImageSnapshot[],
  modified: readonly ImageSnapshot[],
): AlignmentStep[] {
  const rows = original.length + 1;
  const columns = modified.length + 1;
  const costs = Array.from({ length: rows }, () => Array(columns).fill(0));
  const actions = Array.from({ length: rows }, () =>
    Array<AlignmentStep["type"] | undefined>(columns).fill(undefined),
  );
  for (let row = 1; row < rows; row += 1) {
    costs[row][0] = row;
    actions[row][0] = "removed";
  }
  for (let column = 1; column < columns; column += 1) {
    costs[0][column] = column;
    actions[0][column] = "added";
  }
  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const before = original[row - 1];
      const after = modified[column - 1];
      const score = imageSimilarity(before, after);
      if (before.sourceHash === after.sourceHash && before.renderFingerprint === after.renderFingerprint) {
        costs[row][column] = costs[row - 1][column - 1];
        actions[row][column] = "equal";
        continue;
      }
      const substitution = score >= MIN_MATCH_SCORE ? 2 - score : 2.01;
      const candidates = [
        { cost: costs[row - 1][column - 1] + substitution, action: "changed" as const },
        { cost: costs[row - 1][column] + INSERT_DELETE_COST, action: "removed" as const },
        { cost: costs[row][column - 1] + INSERT_DELETE_COST, action: "added" as const },
      ].sort((left, right) => left.cost - right.cost);
      costs[row][column] = candidates[0].cost;
      actions[row][column] = candidates[0].action;
    }
  }
  const result: AlignmentStep[] = [];
  let row = original.length;
  let column = modified.length;
  while (row > 0 || column > 0) {
    const action = actions[row][column];
    if (action === "equal" || action === "changed") {
      result.push({ type: action, original: row - 1, modified: column - 1 });
      row -= 1;
      column -= 1;
    } else if (action === "removed") {
      result.push({ type: "removed", original: row - 1 });
      row -= 1;
    } else {
      result.push({ type: "added", modified: column - 1 });
      column -= 1;
    }
  }
  return result.reverse();
}

function imageSimilarity(left: ImageSnapshot, right: ImageSnapshot): number {
  if (left.sourceHash === right.sourceHash) return 1;
  let score = 0;
  if (left.stableKey === right.stableKey) score += 0.55;
  if (left.classification === right.classification) score += 0.04;
  if (left.captionLabel && left.captionLabel === right.captionLabel) score += 0.12;
  if (left.sectionIndex === right.sectionIndex) score += 0.08;
  const paragraphDistance = Math.abs(left.paragraphIndex - right.paragraphIndex);
  score += Math.max(0, 0.18 - paragraphDistance * 0.03);
  const pageDistance = Math.abs(left.pageIndex - right.pageIndex);
  score += Math.max(0, 0.1 - pageDistance * 0.02);
  if (left.mime === right.mime) score += 0.05;
  if (approximatelyEqual(left.rect.width, right.rect.width) && approximatelyEqual(left.rect.height, right.rect.height)) {
    score += 0.1;
  }
  return Math.min(score, 1);
}

function approximatelyEqual(left: number, right: number): boolean {
  const scale = Math.max(Math.abs(left), Math.abs(right), 1);
  return Math.abs(left - right) / scale < 0.08;
}

function imageAnchor(image: ImageSnapshot, confidence: MappingConfidence): ImageAnchor {
  return {
    target: "image",
    imageIndex: image.imageIndex,
    paragraphIndex: image.paragraphIndex,
    stableKey: image.stableKey,
    rect: image.rect,
    sectionIndex: image.sectionIndex,
    confidence,
  };
}

function neighborAnchor(images: readonly ImageSnapshot[], index: number | undefined) {
  return index === undefined || !images[index]
    ? undefined
    : imageAnchor(images[index], "contextual");
}

function nearestModifiedIndex(
  step: Extract<AlignmentStep, { type: "removed" }>,
  original: readonly ImageSnapshot[],
  modified: readonly ImageSnapshot[],
): number | undefined {
  if (modified.length === 0) return undefined;
  const source = original[step.original];
  return closestByPage(source.pageIndex, modified);
}

function nearestOriginalIndex(
  step: Extract<AlignmentStep, { type: "added" }>,
  original: readonly ImageSnapshot[],
  modified: readonly ImageSnapshot[],
): number | undefined {
  if (original.length === 0) return undefined;
  const source = modified[step.modified];
  return closestByPage(source.pageIndex, original);
}

function closestByPage(pageIndex: number, images: readonly ImageSnapshot[]): number {
  let best = 0;
  for (let index = 1; index < images.length; index += 1) {
    if (Math.abs(images[index].pageIndex - pageIndex) < Math.abs(images[best].pageIndex - pageIndex)) {
      best = index;
    }
  }
  return best;
}

function imageLabel(image: ImageSnapshot): string {
  if (image.classification === "captioned") {
    const caption = image.captionLabel ? ` ${image.captionLabel}` : "";
    return `캡션 이미지${caption} · ${image.pageIndex + 1}쪽`;
  }
  const ordinal = image.classificationIndex ?? image.imageIndex + 1;
  return `기타 이미지 ${ordinal} · ${image.pageIndex + 1}쪽`;
}

function imageSummary(image: ImageSnapshot): string {
  const format = image.mime.replace(/^image\//, "").toUpperCase() || "IMAGE";
  return `${format} · ${Math.round(image.rect.width)}×${Math.round(image.rect.height)}`;
}
