import { describe, expect, it } from "vitest";
import { resolveRhwpTableAddress } from "./rhwp-document-session";

describe("rhwp table address mapping", () => {
  it("maps a root-list paragraph across section boundaries", () => {
    const address = resolveRhwpTableAddress(
      { ctrlId: "tbl", list: 0, para: 5, controlIndex: 2 },
      0,
      [3, 4],
      new Map(),
    );

    expect(address).toMatchObject({
      sectionIndex: 1,
      paragraphIndex: 2,
      controlIndex: 2,
      direct: true,
      path: [{ controlIndex: 2, cellIndex: 0, cellParaIndex: 0 }],
    });
  });

  it("reconstructs a deeply nested table path from public cursor-list facts", () => {
    const address = resolveRhwpTableAddress(
      { ctrlId: "tbl", list: 7, para: 2, controlIndex: 5 },
      4,
      [2, 6],
      new Map([
        [
          2,
          {
            listId: 2,
            hostListId: 0,
            sectionIndex: 1,
            hostPara: 2,
            controlIndex: 4,
            cellIndex: 3,
          },
        ],
        [
          7,
          {
            listId: 7,
            hostListId: 2,
            sectionIndex: 1,
            hostPara: 1,
            controlIndex: 1,
            cellIndex: 0,
          },
        ],
      ]),
    );

    expect(address).toMatchObject({
      tableIndex: 4,
      sectionIndex: 1,
      paragraphIndex: 2,
      controlIndex: 5,
      direct: false,
      path: [
        { controlIndex: 4, cellIndex: 3, cellParaIndex: 1 },
        { controlIndex: 1, cellIndex: 0, cellParaIndex: 2 },
        { controlIndex: 5, cellIndex: 0, cellParaIndex: 0 },
      ],
    });
  });

  it("rejects cyclic cursor-list relationships", () => {
    expect(() =>
      resolveRhwpTableAddress(
        { ctrlId: "tbl", list: 2, para: 0, controlIndex: 0 },
        0,
        [1],
        new Map([
          [
            2,
            {
              listId: 2,
              hostListId: 2,
              sectionIndex: 0,
              hostPara: 0,
              controlIndex: 0,
              cellIndex: 0,
            },
          ],
        ]),
      ),
    ).toThrow(/순환 참조/);
  });
});
