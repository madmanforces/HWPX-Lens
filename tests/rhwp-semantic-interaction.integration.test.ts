import { beforeAll, describe, expect, it } from "vitest";
import {
  createRhwpDocument,
  createRhwpInteractionPocDocument,
} from "@hwpx-lens/hwpx-adapter";
import { loadBodyTextFixture } from "./helpers/hwpx-fixture";
import { initializeRhwpTestRuntime } from "./helpers/rhwp-test-runtime";

beforeAll(initializeRhwpTestRuntime);

describe("rhwp semantic interaction adapter", () => {
  it("keeps the HTML semantic overlay opt-in while defaulting to native interaction", async () => {
    const document = await createRhwpDocument(await loadBodyTextFixture());
    try {
      expect(document.interaction?.kind).toBe("native");
    } finally {
      document.dispose();
    }
  });

  it("normalizes public page text layout without leaking rhwp objects", async () => {
    const document = await createRhwpInteractionPocDocument(await loadBodyTextFixture());
    try {
      const page = await document.interaction!.getTextPage(0);
      expect(page.pageIndex).toBe(0);
      expect(page.runs.map((run) => run.text)).toEqual(["11223344", "222212212"]);
      expect(page.runs.every((run) => run.characterX.length === run.text.length + 1)).toBe(true);
      expect(page.runs.every((run) => run.anchor?.target === "body-text")).toBe(true);
      expect(JSON.stringify(page)).not.toContain("HwpDocument");
    } finally {
      document.dispose();
    }
  });

  it("maps an exact character range from semantic char boundaries", async () => {
    const document = await createRhwpInteractionPocDocument(await loadBodyTextFixture());
    try {
      const page = await document.interaction!.getTextPage(0);
      const run = page.runs[0];
      const target = await document.interaction!.resolveTextTarget({
        target: "body-text",
        sectionIndex: 0,
        paragraphIndex: 0,
        textRange: { start: 2, end: 6 },
        confidence: "exact",
      });
      expect(target.pageIndex).toBe(0);
      expect(target.rects).toHaveLength(1);
      expect(target.rects[0]).toMatchObject({
        x: run.rect.x + run.characterX[2],
        y: run.rect.y,
        width: run.characterX[6] - run.characterX[2],
        height: run.rect.height,
      });
    } finally {
      document.dispose();
    }
  });
});
