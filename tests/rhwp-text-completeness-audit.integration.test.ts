import { beforeAll, describe, expect, it } from "vitest";
import { createFidelityFixture, type FidelityFixtureName } from "./helpers/rhwp-fidelity-fixtures";
import { auditRhwpTextCompleteness } from "./helpers/rhwp-text-completeness-audit";
import { initializeRhwpTestRuntime } from "./helpers/rhwp-test-runtime";

beforeAll(initializeRhwpTestRuntime);

describe("text completeness audit", () => {
  for (const name of [
    "simple-paragraph",
    "multi-page-text",
    "table-cross-page",
    "baseline-clip-table",
    "image-caption",
  ] satisfies FidelityFixtureName[]) {
    it(`traces every meaningful body character through ${name}`, async () => {
      const result = auditRhwpTextCompleteness(await createFidelityFixture(name));
      expect(result.mappedParagraphCount).toBe(result.semanticParagraphCount);
      expect(result.paragraphsWithMissingLayoutText).toBe(0);
      expect(result.pagesWithRawSvgTextDeficit).toBe(0);
      expect(result.pagesWithSanitizerTextDrift).toBe(0);
      expect(result.outOfPageLayoutRuns).toBe(0);
    }, 30_000);
  }
});
