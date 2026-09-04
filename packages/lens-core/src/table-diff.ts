import type {
  DocumentAnchor,
  TableAnchor,
  TableCellAnchor,
  TableChange,
  TableSnapshot,
} from "./types";
import { cellStructureKey } from "./table";

type AlignmentStep =
  | { type: "equal"; original: number; modified: number }
  | { type: "modified"; original: number; modified: number }
  | { type: "removed"; original: number }
  | { type: "added"; modified: number };

interface TableFeatures {
  table: TableSnapshot;
  cellsByStructure: Map<string, TableSnapshot["cells"][number]>;
}

const INSERT_DELETE_COST = 1;
const MIN_TABLE_SIMILARITY = 0.4;

export function compareTableSnapshots(
  original: TableSnapshot[],
  modified: TableSnapshot[],
): TableChange[] {
  const steps = alignTables(original, modified);
  const changes: TableChange[] = [];

  for (const step of steps) {
    if (step.type === "equal") continue;

    if (step.type === "modified") {
      const before = original[step.original];
      const after = modified[step.modified];
      if (before.structureFingerprint !== after.structureFingerprint) {
        changes.push({
          id: nextId(changes),
          type: "table",
          kind: "modified",
          detail: "structure",
          locationLabel: tableLabel(after),
          classificationLabels: mergeClassificationLabels(before, after),
          originalText: dimensionSummary(before),
          modifiedText: dimensionSummary(after),
          originalAnchor: tableAnchor(before, "contextual"),
          modifiedAnchor: tableAnchor(after, "contextual"),
        });
        continue;
      }

      const afterByStructure = new Map(
        after.cells.map((cell) => [cellStructureKey(cell), cell]),
      );
      for (const beforeCell of before.cells) {
        const afterCell = afterByStructure.get(cellStructureKey(beforeCell));
        if (!afterCell || beforeCell.normalizedText === afterCell.normalizedText) continue;
        changes.push({
          id: nextId(changes),
          type: "table",
          kind: "modified",
          detail: "cell-text",
          locationLabel: cellLabel(after, afterCell.row, afterCell.column),
          classificationLabels: mergeClassificationLabels(before, after),
          originalText: beforeCell.text,
          modifiedText: afterCell.text,
          originalAnchor: cellAnchor(before, beforeCell, "exact"),
          modifiedAnchor: cellAnchor(after, afterCell, "exact"),
        });
      }
      continue;
    }

    if (step.type === "removed") {
      const table = original[step.original];
      changes.push({
        id: nextId(changes),
        type: "table",
        kind: "removed",
        detail: "table-removed",
        locationLabel: tableLabel(table),
        classificationLabels: [...table.classificationLabels],
        originalText: tableSummary(table),
        originalAnchor: tableAnchor(table, "exact"),
        modifiedContextAnchor: nearestContextAnchor(
          modified,
          findNeighborModifiedIndex(steps, step),
        ),
      });
      continue;
    }

    const table = modified[step.modified];
    changes.push({
      id: nextId(changes),
      type: "table",
      kind: "added",
      detail: "table-added",
      locationLabel: tableLabel(table),
      classificationLabels: [...table.classificationLabels],
      modifiedText: tableSummary(table),
      modifiedAnchor: tableAnchor(table, "exact"),
      originalContextAnchor: nearestContextAnchor(
        original,
        findNeighborOriginalIndex(steps, step),
      ),
    });
  }

  return changes;
}

function mergeClassificationLabels(
  before: TableSnapshot,
  after: TableSnapshot,
): string[] {
  return [...new Set([...before.classificationLabels, ...after.classificationLabels])];
}

function alignTables(original: TableSnapshot[], modified: TableSnapshot[]): AlignmentStep[] {
  const originalFeatures = original.map(createTableFeatures);
  const modifiedFeatures = modified.map(createTableFeatures);
  const rows = original.length + 1;
  const columns = modified.length + 1;
  const costs = Array.from({ length: rows }, () => Array(columns).fill(0));
  const actions = Array.from({ length: rows }, () =>
    Array<AlignmentStep["type"] | undefined>(columns).fill(undefined),
  );

  for (let row = 1; row < rows; row += 1) {
    costs[row][0] = row * INSERT_DELETE_COST;
    actions[row][0] = "removed";
  }
  for (let column = 1; column < columns; column += 1) {
    costs[0][column] = column * INSERT_DELETE_COST;
    actions[0][column] = "added";
  }

  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const before = originalFeatures[row - 1];
      const after = modifiedFeatures[column - 1];
      if (before.table.fingerprint === after.table.fingerprint) {
        costs[row][column] = costs[row - 1][column - 1];
        actions[row][column] = "equal";
        continue;
      }

      const similarity = tableSimilarity(before, after);
      const substitutionCost =
        similarity >= MIN_TABLE_SIMILARITY
          ? INSERT_DELETE_COST * 2 - similarity
          : INSERT_DELETE_COST * 2 + 0.01;
      const candidates = [
        { cost: costs[row - 1][column - 1] + substitutionCost, action: "modified" as const },
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
    if (action === "equal" || action === "modified") {
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

function createTableFeatures(table: TableSnapshot): TableFeatures {
  return {
    table,
    cellsByStructure: new Map(table.cells.map((cell) => [cellStructureKey(cell), cell])),
  };
}

function tableSimilarity(left: TableFeatures, right: TableFeatures): number {
  const leftCells = left.cellsByStructure;
  const rightCells = right.cellsByStructure;
  const denominator = Math.max(leftCells.size, rightCells.size, 1);
  let structuralMatches = 0;
  let contentMatches = 0;
  for (const [key, leftCell] of leftCells) {
    const rightCell = rightCells.get(key);
    if (!rightCell) continue;
    structuralMatches += 1;
    if (leftCell.normalizedText === rightCell.normalizedText) contentMatches += 1;
  }
  const dimensionMatch =
    left.table.rowCount === right.table.rowCount &&
    left.table.columnCount === right.table.columnCount
      ? 1
      : 0;
  return (
    dimensionMatch * 0.2 +
    (structuralMatches / denominator) * 0.45 +
    (contentMatches / denominator) * 0.35
  );
}

function tableAnchor(
  table: TableSnapshot,
  confidence: DocumentAnchor["confidence"],
): TableAnchor {
  return {
    target: "table",
    tableIndex: table.tableIndex,
    sectionIndex: table.sectionIndex,
    paragraphIndex: table.paragraphIndex,
    controlIndex: table.controlIndex,
    confidence,
  };
}

function cellAnchor(
  table: TableSnapshot,
  cell: TableSnapshot["cells"][number],
  confidence: DocumentAnchor["confidence"],
): TableCellAnchor {
  return {
    target: "table-cell",
    tableIndex: table.tableIndex,
    sectionIndex: table.sectionIndex,
    paragraphIndex: table.paragraphIndex,
    controlIndex: table.controlIndex,
    cellIndex: cell.cellIndex,
    row: cell.row,
    column: cell.column,
    rowSpan: cell.rowSpan,
    columnSpan: cell.columnSpan,
    textFingerprint: cell.fingerprint,
    confidence,
  };
}

function nearestContextAnchor(
  tables: TableSnapshot[],
  index: number | undefined,
): TableAnchor | undefined {
  return index === undefined || !tables[index]
    ? undefined
    : tableAnchor(tables[index], "contextual");
}

function findNeighborOriginalIndex(
  steps: AlignmentStep[],
  target: AlignmentStep,
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
  steps: AlignmentStep[],
  target: AlignmentStep,
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
  step: AlignmentStep,
): step is Extract<AlignmentStep, { type: "equal" | "modified" }> {
  return step.type === "equal" || step.type === "modified";
}

function tableSummary(table: TableSnapshot): string {
  const text = table.cells
    .map((cell) => cell.normalizedText)
    .filter(Boolean)
    .join(" | ");
  return text ? truncate(text, 180) : dimensionSummary(table);
}

function dimensionSummary(table: TableSnapshot): string {
  return `${table.rowCount}행 × ${table.columnCount}열 · ${table.cells.length}셀`;
}

function tableLabel(table: TableSnapshot): string {
  return `표 ${table.tableIndex + 1}`;
}

function cellLabel(table: TableSnapshot, row: number, column: number): string {
  return `${tableLabel(table)} · ${row + 1}행 ${column + 1}열`;
}

function nextId(changes: TableChange[]): string {
  return `table-${changes.length + 1}`;
}

function truncate(text: string, maximum: number): string {
  return text.length <= maximum ? text : `${text.slice(0, maximum - 1)}…`;
}
