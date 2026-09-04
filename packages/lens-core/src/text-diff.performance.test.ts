import { describe, expect, it } from "vitest";
import { compareTextSnapshots } from "./text-diff";
import { createParagraphSnapshot } from "./text";
import type { DocumentSnapshot } from "./types";

describe("text diff scalability", () => {
  it("aligns a mostly unchanged long document without a quadratic full matrix", () => {
    const paragraphCount = 4_000;
    const original = snapshot(paragraphCount);
    const modified = snapshot(paragraphCount);
    modified.paragraphs[321] = createParagraphSnapshot(0, 321, "수정된 점검 문단 321")!;

    const startedAt = performance.now();
    const changes = compareTextSnapshots(original, modified);
    const durationMs = performance.now() - startedAt;

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ type: "text", kind: "modified" });
    expect(durationMs).toBeLessThan(2_000);
    console.log(JSON.stringify({ profile: "text-diff-baseline", paragraphCount, durationMs }));
  }, 60_000);

  it("keeps unrelated paragraphs separate in a large unanchored region", () => {
    const original = repeatedSnapshot(500, "가".repeat(40));
    const modified = repeatedSnapshot(500, "힣".repeat(40));

    const changes = compareTextSnapshots(original, modified);

    expect(changes).toHaveLength(1_000);
    expect(changes.filter((change) => change.kind === "removed")).toHaveLength(500);
    expect(changes.filter((change) => change.kind === "added")).toHaveLength(500);
  });
});

function snapshot(paragraphCount: number): DocumentSnapshot {
  return {
    paragraphs: Array.from({ length: paragraphCount }, (_, paragraphIndex) =>
      createParagraphSnapshot(0, paragraphIndex, `고유 점검 문단 ${paragraphIndex}`)!,
    ),
    tables: [],
  };
}

function repeatedSnapshot(paragraphCount: number, prefix: string): DocumentSnapshot {
  return {
    paragraphs: Array.from({ length: paragraphCount }, (_, paragraphIndex) =>
      createParagraphSnapshot(0, paragraphIndex, `${prefix} ${paragraphIndex}`)!,
    ),
    tables: [],
  };
}
