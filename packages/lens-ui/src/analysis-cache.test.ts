import { describe, expect, it } from "vitest";
import { SessionAnalysisCache } from "./analysis-cache";

describe("SessionAnalysisCache", () => {
  it("keeps sensitive analysis ephemeral and clearable", () => {
    const cache = new SessionAnalysisCache();
    cache.setDocument("doc", {
      snapshot: { paragraphs: [], tables: [] },
      complexity: {
        compressedBytes: 1,
        pageCount: 1,
        paragraphCount: 0,
        snapshotParagraphCount: 0,
        tableCount: 0,
        tableCellCount: 0,
        graphicControlCount: 0,
        imageCount: null,
        totalEmbeddedImageBytes: null,
        largestEmbeddedResourceBytes: null,
        level: "low",
      },
    });
    cache.setPair("pair", {
      changes: [],
      targets: new Map(),
      reviewInk: { original: [], modified: [] },
      diffMs: 1,
      mappingMs: 1,
    });
    expect(cache.stats()).toEqual({ documents: 1, pairs: 1, persistent: false });
    cache.clear();
    expect(cache.stats()).toEqual({ documents: 0, pairs: 0, persistent: false });
  });
});
