import { HwpDocument } from "@rhwp/core";
import { loadBodyTextFixture } from "./hwpx-fixture";
import { initializeRhwpTestRuntime } from "./rhwp-test-runtime";

export const FIDELITY_FIXTURE_NAMES = [
  "simple-paragraph",
  "multiline-paragraph",
  "mixed-font",
  "long-paragraph",
  "multi-page-text",
  "simple-table",
  "merged-table",
  "merged-cells-horizontal",
  "merged-cells-vertical",
  "merged-cells-complex",
  "long-table",
  "table-cross-page",
  "nested-paragraphs-in-cell",
  "different-cell-padding",
  "border-variations",
  "table-with-image",
  "table-near-page-bottom",
  "baseline-clip-table",
  "image",
  "jpeg-image",
  "transparent-png",
  "image-floating",
  "image-behind-text",
  "image-front-of-text",
  "image-caption",
  "resized-image",
  "cropped-image",
  "table-caption",
  "long-document",
] as const;

export type FidelityFixtureName = (typeof FIDELITY_FIXTURE_NAMES)[number];

const ONE_PIXEL_PNG = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
));

const TRANSPARENT_PIXEL_PNG = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
  "base64",
));

const ONE_PIXEL_JPEG = Uint8Array.from(Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q==",
  "base64",
));

export async function createFidelityFixture(name: FidelityFixtureName): Promise<Uint8Array> {
  await initializeRhwpTestRuntime();
  const document = new HwpDocument(await loadBodyTextFixture());
  try {
    switch (name) {
      case "simple-paragraph":
        replaceParagraph(document, 0, "장비의 전원을 차단한다.");
        break;
      case "multiline-paragraph":
        replaceParagraph(document, 0, repeatedSentence(12));
        break;
      case "mixed-font": {
        const text = "혼합 글꼴 문단과 Mixed Font 123";
        replaceParagraph(document, 0, text);
        document.setCharShapeId(0, 0, 0, 8, 1);
        document.setCharShapeId(0, 0, 8, text.length, 0);
        break;
      }
      case "long-paragraph":
        replaceParagraph(document, 0, repeatedSentence(80));
        break;
      case "multi-page-text":
        replaceParagraph(document, 0, repeatedSentence(260));
        break;
      case "simple-table":
        createTable(document);
        break;
      case "merged-table":
      case "merged-cells-horizontal": {
        const table = createTable(document);
        document.mergeTableCells(0, table.paraIdx, table.controlIdx, 0, 0, 0, 1);
        break;
      }
      case "merged-cells-vertical": {
        const table = createTable(document);
        document.mergeTableCells(0, table.paraIdx, table.controlIdx, 0, 0, 1, 0);
        break;
      }
      case "merged-cells-complex": {
        const table = createTable(document, 4, 4);
        document.mergeTableCells(0, table.paraIdx, table.controlIdx, 0, 0, 0, 2);
        document.mergeTableCells(0, table.paraIdx, table.controlIdx, 1, 0, 2, 0);
        break;
      }
      case "long-table":
        createTable(document, 28, 3, true);
        break;
      case "table-cross-page": {
        const table = createTable(document, 55, 2, true);
        parseOk(document.setTableProperties(0, table.paraIdx, table.controlIdx, JSON.stringify({
          pageBreak: true,
          repeatHeader: true,
        })));
        break;
      }
      case "nested-paragraphs-in-cell": {
        const table = createTable(document, 2, 2);
        parseOk(document.splitParagraphInCell(0, table.paraIdx, table.controlIdx, 0, 0, 2));
        document.insertTextInCell(0, table.paraIdx, table.controlIdx, 0, 1, 0, "셀 내부 둘째 문단");
        break;
      }
      case "different-cell-padding": {
        const table = createTable(document, 2, 2);
        for (let cellIndex = 0; cellIndex < 4; cellIndex += 1) {
          parseOk(document.setCellProperties(0, table.paraIdx, table.controlIdx, cellIndex, JSON.stringify({
            paddingLeft: 100 + cellIndex * 100,
            paddingRight: 200 + cellIndex * 100,
            paddingTop: 100 + cellIndex * 50,
            paddingBottom: 200 + cellIndex * 50,
            applyInnerMargin: true,
          })));
        }
        break;
      }
      case "border-variations": {
        const table = createTable(document, 2, 2);
        for (let cellIndex = 0; cellIndex < 4; cellIndex += 1) {
          parseOk(document.setCellProperties(0, table.paraIdx, table.controlIdx, cellIndex, JSON.stringify({
            borderLeft: { type: cellIndex % 2 === 0 ? 1 : 3, width: cellIndex + 1, color: "#202020" },
            borderRight: { type: 1, width: 1, color: "#505050" },
            borderTop: { type: 1, width: 1, color: "#808080" },
            borderBottom: { type: cellIndex % 2 === 0 ? 4 : 1, width: 2, color: "#202020" },
          })));
        }
        break;
      }
      case "table-with-image": {
        const table = createTable(document, 2, 2);
        parseMutation(document.insertPicture(
          0,
          table.paraIdx,
          0,
          JSON.stringify([{ controlIndex: table.controlIdx, cellIndex: 0, cellParaIndex: 0 }]),
          ONE_PIXEL_PNG,
          2_400,
          1_600,
          1,
          1,
          "png",
          "합성 셀 그림",
        ));
        break;
      }
      case "table-near-page-bottom":
        replaceParagraph(document, 0, repeatedSentence(42));
        createTable(document, 8, 2, true);
        break;
      case "baseline-clip-table": {
        const table = createTable(document, 6, 5);
        parseOk(document.setTableProperties(0, table.paraIdx, table.controlIdx, JSON.stringify({
          paddingLeft: 566,
          paddingRight: 566,
          paddingTop: 566,
          paddingBottom: 566,
          pageBreak: 2,
          repeatHeader: true,
        })));
        for (let cellIndex = 5; cellIndex < 30; cellIndex += 1) {
          parseOk(document.setCellProperties(0, table.paraIdx, table.controlIdx, cellIndex, JSON.stringify({
            height: 1_382,
            paddingLeft: 510,
            paddingRight: 510,
            paddingTop: 141,
            paddingBottom: 141,
            applyInnerMargin: false,
            verticalAlign: 1,
          })));
        }
        break;
      }
      case "image":
        replaceParagraph(document, 0, "합성 그림 배치 검증");
        parseMutation(document.insertPicture(
          0,
          1,
          0,
          "[]",
          ONE_PIXEL_PNG,
          4_800,
          3_200,
          1,
          1,
          "png",
          "합성 시험 그림",
        ));
        break;
      case "jpeg-image":
        insertPicture(document, ONE_PIXEL_JPEG, "jpg", "합성 JPEG", 4_800, 3_200);
        break;
      case "transparent-png":
        insertPicture(document, TRANSPARENT_PIXEL_PNG, "png", "합성 투명 PNG", 4_800, 3_200);
        break;
      case "image-floating": {
        const picture = insertPicture(document, ONE_PIXEL_PNG, "png", "합성 떠 있는 그림", 4_800, 3_200);
        parseOk(document.setPictureProperties(0, picture.paraIdx, picture.controlIdx, JSON.stringify({
          treatAsChar: false,
          horizontalOffset: 2_000,
          verticalOffset: 3_000,
        })));
        break;
      }
      case "image-behind-text": {
        const picture = insertPicture(document, ONE_PIXEL_PNG, "png", "합성 글 뒤 그림", 4_800, 3_200);
        parseOk(document.setPictureProperties(0, picture.paraIdx, picture.controlIdx, JSON.stringify({ treatAsChar: false })));
        parseOk(document.setControlZOrderAt(picture.paraIdx, picture.controlIdx, "behindText"));
        break;
      }
      case "image-front-of-text": {
        const picture = insertPicture(document, ONE_PIXEL_PNG, "png", "합성 글 앞 그림", 4_800, 3_200);
        parseOk(document.setPictureProperties(0, picture.paraIdx, picture.controlIdx, JSON.stringify({ treatAsChar: false })));
        parseOk(document.setControlZOrderAt(picture.paraIdx, picture.controlIdx, "inFrontOfText"));
        break;
      }
      case "image-caption": {
        replaceParagraph(document, 0, "그림 캡션 상호작용 검증");
        const inserted = parseMutation(document.insertPicture(
          0,
          1,
          0,
          "[]",
          ONE_PIXEL_PNG,
          4_800,
          3_200,
          1,
          1,
          "png",
          "합성 시험 그림",
        ));
        document.attachCaptionAt(inserted.paraIdx, inserted.controlIdx);
        break;
      }
      case "resized-image":
        insertPicture(document, ONE_PIXEL_PNG, "png", "합성 크기 조정 그림", 9_600, 1_600);
        break;
      case "cropped-image": {
        const picture = insertPicture(document, ONE_PIXEL_PNG, "png", "합성 자른 그림", 4_800, 3_200);
        parseOk(document.setPictureProperties(0, picture.paraIdx, picture.controlIdx, JSON.stringify({
          cropLeft: 10,
          cropTop: 10,
          cropRight: 90,
          cropBottom: 90,
        })));
        break;
      }
      case "table-caption":
        // Native table captions cannot be created through the current rhwp public
        // attachCaptionAt API. Keep a visual caption fixture here and cover a
        // native table caption only through ignored local fixtures.
        replaceParagraph(document, 0, "표 1. 합성 점검표");
        createTable(document);
        break;
      case "long-document":
        replaceParagraph(document, 0, repeatedSentence(800));
        break;
    }
    return document.exportHwpx();
  } finally {
    document.free();
  }
}

function createTable(
  document: HwpDocument,
  rowCount = 3,
  columnCount = 3,
  longCellText = false,
): { paraIdx: number; controlIdx: number } {
  const created = parseMutation(document.createTable(0, 1, 0, rowCount, columnCount));
  for (let cellIndex = 0; cellIndex < rowCount * columnCount; cellIndex += 1) {
    const value = longCellText
      ? `셀 ${cellIndex + 1}: 장비 상태와 연결 상태를 점검한다.`
      : ["항목", "점검 기준", "결과", "전원", "정상", "양호", "통신", "연결", "양호"][cellIndex] ?? `셀 ${cellIndex + 1}`;
    document.insertTextInCell(0, created.paraIdx, created.controlIdx, cellIndex, 0, 0, value);
  }
  return created;
}

function insertPicture(
  document: HwpDocument,
  bytes: Uint8Array,
  extension: string,
  description: string,
  width: number,
  height: number,
): { paraIdx: number; controlIdx: number } {
  replaceParagraph(document, 0, `${description} 배치 검증`);
  return parseMutation(document.insertPicture(
    0,
    1,
    0,
    "[]",
    bytes,
    width,
    height,
    1,
    1,
    extension,
    description,
  ));
}

function replaceParagraph(document: HwpDocument, paragraphIndex: number, text: string): void {
  const length = document.getParagraphLength(0, paragraphIndex);
  if (length > 0) document.deleteText(0, paragraphIndex, 0, length);
  document.insertText(0, paragraphIndex, 0, text);
}

function repeatedSentence(count: number): string {
  return Array.from({ length: count }, (_, index) =>
    `${index + 1}. 장비의 전원을 차단하고 연결 상태를 확인한다. `,
  ).join("");
}

function parseMutation(value: string): { ok: boolean; paraIdx: number; controlIdx: number } {
  const parsed = JSON.parse(value) as { ok?: unknown; paraIdx?: unknown; controlIdx?: unknown };
  if (
    parsed.ok !== true ||
    !Number.isInteger(parsed.paraIdx) ||
    !Number.isInteger(parsed.controlIdx)
  ) {
    throw new Error(`합성 HWPX 개체를 만들지 못했습니다. (${value})`);
  }
  return parsed as { ok: boolean; paraIdx: number; controlIdx: number };
}

function parseOk(value: string): void {
  const parsed = JSON.parse(value) as { ok?: unknown };
  if (parsed.ok !== true) throw new Error(`합성 HWPX 속성을 적용하지 못했습니다. (${value})`);
}
