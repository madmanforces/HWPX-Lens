import { describe, expect, it } from "vitest";
import { createParagraphSnapshot } from "./text";
import { alignOutlineSnapshots, compareOutlineSnapshots } from "./outline-diff";
import type { DocumentSnapshot, ParagraphSnapshot } from "./types";

function outline(text: string, number: string, paragraphIndex: number): ParagraphSnapshot {
  const paragraph = createParagraphSnapshot(0, paragraphIndex, text)!;
  return {
    ...paragraph,
    alignmentText: `6:${number}:${paragraph.normalizedText}`,
    outline: { level: 6, number, pageIndex: 0 },
  };
}

function snapshot(...paragraphs: ParagraphSnapshot[]): DocumentSnapshot {
  return { paragraphs, tables: [] };
}

describe("compareOutlineSnapshots", () => {
  it("treats removed parenthesized English as one renamed outline item", () => {
    const [change] = compareOutlineSnapshots(
      snapshot(outline("시동 (START)", "(나)", 10)),
      snapshot(outline("시동", "(나)", 12)),
    );

    expect(change).toMatchObject({
      type: "outline",
      kind: "modified",
      detail: "renamed",
      originalText: "시동 (START)",
      modifiedText: "시동",
      locationLabel: "(나) 시동",
      originalAnchor: {
        paragraphIndex: 10,
        textRange: { start: 0, end: 10 },
        generatedPrefix: { text: "(나)", pageIndex: 0 },
      },
      modifiedAnchor: {
        paragraphIndex: 12,
        textRange: { start: 0, end: 2 },
        generatedPrefix: { text: "(나)", pageIndex: 0 },
      },
    });
  });

  it("classifies an actually missing outline entry separately", () => {
    const changes = compareOutlineSnapshots(
      snapshot(outline("정상모드", "(가)", 10), outline("시동", "(나)", 11)),
      snapshot(outline("정상모드", "(가)", 10)),
    );
    expect(changes).toEqual([expect.objectContaining({
      type: "outline",
      kind: "removed",
      detail: "outline-removed",
      originalText: "시동",
    })]);
  });

  it("keeps a large renumbered outline aligned instead of cascading into add/remove pairs", () => {
    const originalParagraphs = Array.from({ length: 600 }, (_, index) =>
      outline(index === 400 ? "설정 항목" : `항목 ${index}`, `${index + 1}.`, index),
    );
    const modifiedTexts = originalParagraphs.map((paragraph) => paragraph.text);
    modifiedTexts.splice(120, 0, "새 목차");
    modifiedTexts[401] = "설정항목";
    const modifiedParagraphs = modifiedTexts.map((text, index) =>
      outline(text, `${index + 1}.`, index + 20),
    );

    const changes = compareOutlineSnapshots(
      snapshot(...originalParagraphs),
      snapshot(...modifiedParagraphs),
    );

    expect(changes).toHaveLength(2);
    expect(changes.map((change) => change.kind).sort()).toEqual(["added", "modified"]);
    expect(changes.find((change) => change.kind === "modified")).toMatchObject({
      originalText: "설정 항목",
      modifiedText: "설정항목",
      detail: "renamed",
    });
    expect(changes.some((change) => change.kind === "removed")).toBe(false);
  });

  it("returns one ordered alignment step for each logical heading", () => {
    const original = snapshot(
      outline("공통 앞", "1.", 0),
      outline("삭제 목차", "2.", 10),
      outline("공통 뒤", "3.", 20),
    );
    const modified = snapshot(
      outline("공통 앞", "1.", 4),
      outline("공통 뒤", "2.", 14),
    );

    const alignment = alignOutlineSnapshots(original, modified);
    expect(alignment.map((step) => [step.type, step.original?.text, step.modified?.text])).toEqual([
      ["equal", "공통 앞", "공통 앞"],
      ["removed", "삭제 목차", undefined],
      ["equal", "공통 뒤", "공통 뒤"],
    ]);
  });

  it("pairs a fully rewritten title at the same structural slot as modified", () => {
    const changes = compareOutlineSnapshots(
      snapshot(outline("기존 명칭", "(나)", 10)),
      snapshot(outline("완전히 새로운 명칭", "(나)", 12)),
    );

    expect(changes).toEqual([expect.objectContaining({
      kind: "modified",
      detail: "renamed",
      originalText: "기존 명칭",
      modifiedText: "완전히 새로운 명칭",
    })]);
  });
});
