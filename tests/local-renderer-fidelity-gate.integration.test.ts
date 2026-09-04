import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, expect, it } from "vitest";
import { createRhwpInteractionPocDocument } from "@hwpx-lens/hwpx-adapter";
import { auditRhwpTextCompleteness } from "./helpers/rhwp-text-completeness-audit";
import { initializeRhwpTestRuntime } from "./helpers/rhwp-test-runtime";

beforeAll(initializeRhwpTestRuntime);

const localFixture = process.env.HWPX_LENS_LOCAL_FIXTURE;

it.runIf(Boolean(localFixture))(
  "traces local fixture text from semantics through raw and sanitized SVG",
  async () => {
    const fixturePath = path.resolve(localFixture!);
    const fixtureRoot = `${path.resolve("local-fixtures")}${path.sep}`;
    expect(fixturePath.startsWith(fixtureRoot)).toBe(true);

    const bytes = await readFile(fixturePath);
    const result = auditRhwpTextCompleteness(bytes);
    const cellTextCoverage = await auditCellTextCoverage(bytes);
    const outputDirectory = path.resolve("test-results/fidelity");
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(
      path.join(outputDirectory, "local-fixture-01-text-completeness.json"),
      `${JSON.stringify({ fixtureLabel: "local-fixture-01", ...result, cellTextCoverage }, null, 2)}\n`,
      "utf8",
    );

    console.log(JSON.stringify({
      fixtureLabel: "local-fixture-01",
      pageCount: result.pageCount,
      semanticParagraphCount: result.semanticParagraphCount,
      mappedParagraphCount: result.mappedParagraphCount,
      paragraphsWithSelectionGeometry: result.paragraphsWithSelectionGeometry,
      paragraphsWithMissingLayoutText: result.paragraphsWithMissingLayoutText,
      missingLayoutMeaningfulCharacters: result.missingLayoutMeaningfulCharacters,
      bodyLayoutRunMismatches: result.bodyLayoutRunMismatches,
      pagesWithRawSvgTextDeficit: result.pagesWithRawSvgTextDeficit,
      rawSvgTextDeficit: result.rawSvgTextDeficit,
      pagesWithSanitizerTextDrift: result.pagesWithSanitizerTextDrift,
      sanitizerTextDrift: result.sanitizerTextDrift,
      pagesWithOutOfBoundsText: result.pagesWithOutOfBoundsText,
      outOfPageLayoutRuns: result.outOfPageLayoutRuns,
      emptyOutOfPageLayoutRuns: result.emptyOutOfPageLayoutRuns,
      pagesWithClipSuspects: result.pagesWithClipSuspects,
      clipSuspectTextElements: result.clipSuspectTextElements,
      captionNumberTokens: result.captionNumberTokens,
      sourceImageKeyCount: result.sourceImageKeyCount,
      sourceImageFormatCounts: result.sourceImageFormatCounts,
      cellTextCoverage: {
        meaningfulCellParagraphs: cellTextCoverage.meaningfulCellParagraphs,
        mappedCellParagraphs: cellTextCoverage.mappedCellParagraphs,
        mismatchedCellParagraphs: cellTextCoverage.mismatchedCellParagraphs,
        missingCellBlocks: cellTextCoverage.missingCellBlocks,
        contentCoveredCellParagraphs: cellTextCoverage.contentCoveredCellParagraphs,
        contentMissingCellParagraphs: cellTextCoverage.contentMissingCellParagraphs,
      },
      suspects: result.suspects.length,
      durationMs: result.durationMs,
    }, null, 2));

    expect(result.mappedParagraphCount).toBe(result.semanticParagraphCount);
    expect(result.pagesWithRawSvgTextDeficit).toBe(0);
    expect(result.pagesWithSanitizerTextDrift).toBe(0);
    expect(cellTextCoverage.missingCellBlocks).toBe(0);
    expect(cellTextCoverage.contentMissingCellParagraphs).toBe(0);
  },
  300_000,
);

async function auditCellTextCoverage(bytes: Uint8Array): Promise<{
  meaningfulCellParagraphs: number;
  mappedCellParagraphs: number;
  mismatchedCellParagraphs: number;
  missingCellBlocks: number;
  contentCoveredCellParagraphs: number;
  contentMissingCellParagraphs: number;
  suspectAddresses: Array<{ tableIndex: number; cellIndex: number; cellParagraphIndex: number; reason: string }>;
}> {
  const document = await createRhwpInteractionPocDocument(bytes);
  try {
    const snapshot = await document.createSnapshot();
    const visualText = new Map<string, string>();
    for (let pageIndex = 0; pageIndex < document.rendering.pageCount(); pageIndex += 1) {
      const page = await document.interaction!.getTextPage(pageIndex);
      for (const run of page.runs) {
        if (!run.blockId.startsWith("cell-")) continue;
        visualText.set(run.blockId, `${visualText.get(run.blockId) ?? ""}${run.text}`);
      }
    }

    let meaningfulCellParagraphs = 0;
    let mappedCellParagraphs = 0;
    let missingCellBlocks = 0;
    let contentCoveredCellParagraphs = 0;
    const suspectAddresses: Array<{ tableIndex: number; cellIndex: number; cellParagraphIndex: number; reason: string }> = [];
    for (const table of snapshot.tables) {
      for (const cell of table.cells) {
        for (const [cellParagraphIndex, text] of cell.paragraphs.entries()) {
          if (!/[\p{L}\p{N}]/u.test(text)) continue;
          meaningfulCellParagraphs += 1;
          const blockId = `cell-${table.sectionIndex}-${table.paragraphIndex}-${table.controlIndex}:${cell.cellIndex}:${cellParagraphIndex}-${cellParagraphIndex}`;
          const visual = visualText.get(blockId);
          if (visual === text) {
            mappedCellParagraphs += 1;
            contentCoveredCellParagraphs += 1;
          } else {
            const reason = visual === undefined
              ? "missing-cell-block"
              : normalizedVisibleText(visual).includes(normalizedVisibleText(text))
                ? "generated-or-formatting-difference"
                : "content-mismatch";
            if (visual === undefined) missingCellBlocks += 1;
            if (reason === "generated-or-formatting-difference") contentCoveredCellParagraphs += 1;
            if (suspectAddresses.length < 100) {
              suspectAddresses.push({ tableIndex: table.tableIndex, cellIndex: cell.cellIndex, cellParagraphIndex, reason });
            }
          }
        }
      }
    }
    return {
      meaningfulCellParagraphs,
      mappedCellParagraphs,
      mismatchedCellParagraphs: meaningfulCellParagraphs - mappedCellParagraphs,
      missingCellBlocks,
      contentCoveredCellParagraphs,
      contentMissingCellParagraphs: meaningfulCellParagraphs - contentCoveredCellParagraphs,
      suspectAddresses,
    };
  } finally {
    document.dispose();
  }
}

function normalizedVisibleText(value: string): string {
  return value.replace(/[\s\u0000-\u001f\u007f\u200b\ufeff\ufffc]/gu, "");
}
