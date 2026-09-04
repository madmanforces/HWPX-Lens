import type { TableCellSnapshot, TableSnapshot } from "./types";
import { fingerprintText, normalizeParagraphText } from "./text";

export interface TableCellSnapshotInput {
  cellIndex: number;
  row: number;
  column: number;
  rowSpan: number;
  columnSpan: number;
  paragraphs: string[];
}

export interface TableSnapshotInput {
  tableIndex: number;
  sectionIndex: number;
  paragraphIndex: number;
  controlIndex: number;
  rowCount: number;
  columnCount: number;
  cells: TableCellSnapshotInput[];
}

export function createTableSnapshot(input: TableSnapshotInput): TableSnapshot {
  const cells = input.cells
    .map(createTableCellSnapshot)
    .sort((left, right) =>
      left.row - right.row || left.column - right.column || left.cellIndex - right.cellIndex,
    );
  const structure = cells.map(cellStructureKey).join("|");
  const content = cells
    .map((cell) => `${cellStructureKey(cell)}:${cell.normalizedText}`)
    .join("\u001e");
  const structureFingerprint = fingerprintText(
    `${input.rowCount}x${input.columnCount}|${structure}`,
  );
  const contentFingerprint = fingerprintText(content);

  return {
    tableIndex: input.tableIndex,
    sectionIndex: input.sectionIndex,
    paragraphIndex: input.paragraphIndex,
    controlIndex: input.controlIndex,
    rowCount: input.rowCount,
    columnCount: input.columnCount,
    cells,
    structureFingerprint,
    contentFingerprint,
    fingerprint: fingerprintText(`${structureFingerprint}:${contentFingerprint}`),
    classificationLabels: collectClassificationLabels(cells),
  };
}

function collectClassificationLabels(cells: TableCellSnapshot[]): string[] {
  return [...new Set(cells.flatMap((cell) => cell.paragraphs)
    .map((paragraph) => normalizeParagraphText(paragraph).replace(/\s+/gu, ""))
    .filter(Boolean))];
}

export function cellStructureKey(
  cell: Pick<TableCellSnapshot, "row" | "column" | "rowSpan" | "columnSpan">,
): string {
  return `${cell.row},${cell.column},${cell.rowSpan},${cell.columnSpan}`;
}

function createTableCellSnapshot(input: TableCellSnapshotInput): TableCellSnapshot {
  const text = input.paragraphs.join("\n");
  const normalizedText = input.paragraphs
    .map(normalizeParagraphText)
    .filter(Boolean)
    .join("\n");
  return {
    ...input,
    paragraphs: [...input.paragraphs],
    text,
    normalizedText,
    fingerprint: fingerprintText(normalizedText),
  };
}
