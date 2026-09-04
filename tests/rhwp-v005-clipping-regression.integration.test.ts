import { beforeAll, expect, it } from "vitest";
import { createFidelityFixture } from "./helpers/rhwp-fidelity-fixtures";
import { auditRhwpTextCompleteness } from "./helpers/rhwp-text-completeness-audit";
import { initializeRhwpTestRuntime } from "./helpers/rhwp-test-runtime";

beforeAll(initializeRhwpTestRuntime);

it("keeps tightly sized table-cell text inside its SVG clip after the rhwp 0.8.6 update", async () => {
  const result = auditRhwpTextCompleteness(await createFidelityFixture("baseline-clip-table"));

  expect(result.mappedParagraphCount).toBe(result.semanticParagraphCount);
  expect(result.paragraphsWithMissingLayoutText).toBe(0);
  expect(result.pagesWithRawSvgTextDeficit).toBe(0);
  expect(result.pagesWithSanitizerTextDrift).toBe(0);
  expect(result.pagesWithClipSuspects).toBe(0);
  expect(result.clipSuspectTextElements).toBe(0);
}, 30_000);
