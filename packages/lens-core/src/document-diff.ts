import type { Change, ChangeType, DocumentAnchor, DocumentSnapshot } from "./types";
import { compareTableSnapshots } from "./table-diff";
import { compareTextSnapshots } from "./text-diff";
import { compareOutlineSnapshots } from "./outline-diff";
import { compareImageSnapshots } from "./image-diff";

export function compareDocumentSnapshots(
  original: DocumentSnapshot,
  modified: DocumentSnapshot,
  supportedTypes: readonly ChangeType[] = ["text", "outline", "table", "image"],
): Change[] {
  const changes: Change[] = [];
  if (supportedTypes.includes("text")) {
    changes.push(...compareTextSnapshots(original, modified));
  }
  if (supportedTypes.includes("outline")) {
    changes.push(...compareOutlineSnapshots(original, modified));
  }
  if (supportedTypes.includes("table")) {
    changes.push(...compareTableSnapshots(original.tables, modified.tables));
  }
  if (supportedTypes.includes("image")) {
    changes.push(...compareImageSnapshots(original.images ?? [], modified.images ?? []));
  }
  return changes.sort(compareDocumentOrder);
}

function compareDocumentOrder(left: Change, right: Change): number {
  const leftPosition = anchorPosition(changeAnchor(left));
  const rightPosition = anchorPosition(changeAnchor(right));
  for (let index = 0; index < leftPosition.length; index += 1) {
    const difference = leftPosition[index] - rightPosition[index];
    if (difference !== 0) return difference;
  }
  return left.id.localeCompare(right.id);
}

function changeAnchor(change: Change): DocumentAnchor | undefined {
  return (
    change.originalAnchor ??
    change.modifiedAnchor ??
    change.originalContextAnchor ??
    change.modifiedContextAnchor
  );
}

function anchorPosition(anchor: DocumentAnchor | undefined): number[] {
  if (!anchor) return [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 0, 0, 0];
  if (anchor.target === "body-text") {
    return [anchor.sectionIndex, anchor.paragraphIndex, 0, 0, 0];
  }
  if (anchor.target === "table") {
    return [anchor.sectionIndex, anchor.paragraphIndex, 1, anchor.tableIndex, 0];
  }
  if (anchor.target === "image") {
    return [anchor.sectionIndex, anchor.rect.pageIndex, 2, anchor.imageIndex, 0];
  }
  return [
    anchor.sectionIndex,
    anchor.paragraphIndex,
    1,
    anchor.tableIndex,
    anchor.row * 100_000 + anchor.column,
  ];
}
