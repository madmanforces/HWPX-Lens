import { describe, expect, it } from "vitest";
import { compareTableSnapshots } from "./table-diff";
import { createTableSnapshot } from "./table";
import type { TableSnapshot } from "./types";

function table(tableIndex: number, rows: string[][]): TableSnapshot {
  return createTableSnapshot({
    tableIndex,
    sectionIndex: 0,
    paragraphIndex: tableIndex * 2,
    controlIndex: 0,
    rowCount: rows.length,
    columnCount: Math.max(0, ...rows.map((row) => row.length)),
    cells: rows.flatMap((row, rowIndex) =>
      row.map((text, columnIndex) => ({
        cellIndex: rowIndex * row.length + columnIndex,
        row: rowIndex,
        column: columnIndex,
        rowSpan: 1,
        columnSpan: 1,
        paragraphs: [text],
      })),
    ),
  });
}

describe("compareTableSnapshots", () => {
  it("ignores whitespace and Unicode serialization noise in cells", () => {
    expect(
      compareTableSnapshots(
        [table(0, [["  같은   값 ", "cafe\u0301"]])],
        [table(0, [["같은 값", "café"]])],
      ),
    ).toEqual([]);
  });

  it("reports a changed cell with engine-neutral cell anchors", () => {
    const changes = compareTableSnapshots(
      [table(0, [["항목", "100시간"]])],
      [table(0, [["항목", "120시간"]])],
    );

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      type: "table",
      kind: "modified",
      detail: "cell-text",
      locationLabel: "표 1 · 1행 2열",
      originalText: "100시간",
      modifiedText: "120시간",
      originalAnchor: {
        target: "table-cell",
        sectionIndex: 0,
        paragraphIndex: 0,
        cellIndex: 1,
        row: 0,
        column: 1,
      },
    });
  });

  it("keeps an inserted table separate between unchanged neighbors", () => {
    const before = [table(0, [["앞"]]), table(1, [["뒤"]])];
    const after = [table(0, [["앞"]]), table(1, [["추가"]]), table(2, [["뒤"]])];
    const changes = compareTableSnapshots(before, after);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      kind: "added",
      detail: "table-added",
      modifiedText: "추가",
      modifiedAnchor: { target: "table", tableIndex: 1 },
      originalContextAnchor: { target: "table" },
    });
  });

  it("reports one table structure change instead of noisy cell changes", () => {
    const changes = compareTableSnapshots(
      [table(0, [["A", "B"]])],
      [table(0, [["A"], ["B"]])],
    );

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      kind: "modified",
      detail: "structure",
      originalText: "1행 × 2열 · 2셀",
      modifiedText: "2행 × 1열 · 2셀",
      originalAnchor: { target: "table" },
      modifiedAnchor: { target: "table" },
    });
  });
});

describe("table classification labels", () => {
  it("preserves normalized labels for optional local taxonomy rules", () => {
    const table = createTableSnapshot({
      tableIndex: 0,
      sectionIndex: 0,
      paragraphIndex: 0,
      controlIndex: 0,
      rowCount: 1,
      columnCount: 1,
      cells: [{
        cellIndex: 0,
        row: 0,
        column: 0,
        rowSpan: 1,
        columnSpan: 1,
        paragraphs: [" Priority "],
      }],
    });
    expect(table.classificationLabels).toContain("Priority");
  });
});
