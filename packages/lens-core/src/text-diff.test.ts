import { describe, expect, it } from "vitest";
import type { DocumentSnapshot } from "./types";
import { createParagraphSnapshot } from "./text";
import { compareTextSnapshots } from "./text-diff";

function snapshot(...texts: string[]): DocumentSnapshot {
  return {
    paragraphs: texts.flatMap((text, paragraphIndex) => {
      const paragraph = createParagraphSnapshot(0, paragraphIndex, text);
      return paragraph ? [paragraph] : [];
    }),
    tables: [],
  };
}

describe("compareTextSnapshots", () => {
  it("ignores Unicode serialization noise but preserves whitespace changes", () => {
    expect(
      compareTextSnapshots(
        snapshot("cafe\u0301"),
        snapshot("café"),
      ),
    ).toEqual([]);
    const whitespace = compareTextSnapshots(
      snapshot("글자글자"),
      snapshot("글자 글자"),
    );
    expect(whitespace).toHaveLength(1);
    expect(whitespace[0]).toMatchObject({
      type: "text",
      kind: "modified",
      segments: expect.arrayContaining([
        expect.objectContaining({ kind: "added", whitespace: "inserted" }),
      ]),
    });
  });

  it("reports one body text modification and precise ranges", () => {
    const changes = compareTextSnapshots(
      snapshot("전원을 끈다."),
      snapshot("전원을 차단한다."),
    );

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      type: "text",
      kind: "modified",
      originalText: "전원을 끈다.",
      modifiedText: "전원을 차단한다.",
      originalAnchor: { sectionIndex: 0, paragraphIndex: 0 },
      modifiedAnchor: { sectionIndex: 0, paragraphIndex: 0 },
    });
    expect(changes[0].originalAnchor).toMatchObject({
      target: "body-text",
      textRange: { start: 4, end: 5 },
    });
    expect(changes[0].modifiedAnchor).toMatchObject({
      target: "body-text",
      textRange: { start: 4, end: 7 },
    });
  });

  it("keeps insertions and removals separate when paragraphs are unrelated", () => {
    const changes = compareTextSnapshots(
      snapshot("앞 문단", "삭제될 완전히 다른 내용", "뒤 문단"),
      snapshot("앞 문단", "새로 추가된 별개의 문장", "뒤 문단"),
    );

    expect(changes.map((change) => change.kind).sort()).toEqual(["added", "removed"]);
    expect(changes.every((change) => change.type === "text")).toBe(true);
  });

  it("uses a neighboring paragraph as the absent-side context anchor", () => {
    const [change] = compareTextSnapshots(
      snapshot("앞 문단", "뒤 문단"),
      snapshot("앞 문단", "추가 문단", "뒤 문단"),
    );

    expect(change.kind).toBe("added");
    expect(change.originalContextAnchor).toMatchObject({
      sectionIndex: 0,
      paragraphIndex: 0,
      confidence: "contextual",
    });
  });

  it("never uses another unpaired insertion as absent-side context", () => {
    const changes = compareTextSnapshots(
      snapshot("공통 앞", "삭제 문단", "공통 뒤"),
      snapshot("공통 앞", "완전히 별개인 추가 문단", "공통 뒤"),
    );
    const added = changes.find((change) => change.kind === "added");
    const removed = changes.find((change) => change.kind === "removed");
    expect(added?.originalContextAnchor).toMatchObject({ paragraphIndex: 0 });
    expect([0, 2]).toContain(
      removed?.modifiedContextAnchor?.target === "body-text"
        ? removed.modifiedContextAnchor.paragraphIndex
        : -1,
    );
  });
});
