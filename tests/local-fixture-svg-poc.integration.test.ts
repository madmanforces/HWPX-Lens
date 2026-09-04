import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, expect, it } from "vitest";
import { createRhwpInteractionPocDocument } from "@hwpx-lens/hwpx-adapter";
import type { ParagraphSnapshot } from "@hwpx-lens/lens-core";
import { initializeRhwpTestRuntime } from "./helpers/rhwp-test-runtime";

beforeAll(initializeRhwpTestRuntime);

const localFixture = process.env.HWPX_LENS_LOCAL_FIXTURE;

it.runIf(Boolean(localFixture))(
  "audits semantic coverage and mapping on a local-only fixture",
  async () => {
    const startedAt = performance.now();
    const fixturePath = path.resolve(localFixture!);
    const fixtureRoot = `${path.resolve("local-fixtures")}${path.sep}`;
    expect(fixturePath.startsWith(fixtureRoot)).toBe(true);
    const document = await createRhwpInteractionPocDocument(await readFile(fixturePath));
    try {
      const snapshot = await document.createSnapshot();
      const paragraphs = new Map(snapshot.paragraphs.map((paragraph) => [paragraphKey(paragraph), paragraph]));
      const covered = new Map<string, boolean[]>();
      let semanticRunCount = 0;
      let bodyRunCount = 0;
      let mismatchedRuns = 0;
      const mismatchSamples: Array<Record<string, unknown>> = [];
      let mappedTargets = 0;
      const pageTimes: number[] = [];

      for (let pageIndex = 0; pageIndex < document.rendering.pageCount(); pageIndex += 1) {
        const pageStartedAt = performance.now();
        const page = await document.interaction!.getTextPage(pageIndex);
        pageTimes.push(performance.now() - pageStartedAt);
        semanticRunCount += page.runs.length;
        for (const run of page.runs) {
          if (!run.anchor?.textRange) continue;
          bodyRunCount += 1;
          const key = `${run.anchor.sectionIndex}:${run.anchor.paragraphIndex}`;
          const paragraph = paragraphs.get(key);
          if (!paragraph) {
            if (![...run.text].some(isMeaningful)) continue;
            mismatchedRuns += 1;
            mismatchSamples.push({ pageIndex, key, reason: "paragraph-not-in-snapshot" });
            continue;
          }
          const { start, end } = run.anchor.textRange;
          if (paragraph.text.slice(start, end) !== run.text) {
            mismatchedRuns += 1;
            mismatchSamples.push({
              pageIndex,
              key,
              reason: "range-text-mismatch",
              start,
              end,
              runLength: run.text.length,
              paragraphLength: paragraph.text.length,
              actualOffset: paragraph.text.indexOf(run.text),
            });
            continue;
          }
          const mask = covered.get(key) ?? Array(paragraph.text.length).fill(false);
          for (let offset = start; offset < end; offset += 1) mask[offset] = true;
          covered.set(key, mask);
          if (mappedTargets < 100) {
            const target = await document.interaction!.resolveTextTarget(run.anchor);
            if (target.rects.length > 0) mappedTargets += 1;
          }
        }
      }

      let meaningfulCharacters = 0;
      let missingCharacters = 0;
      let paragraphsWithMissingText = 0;
      for (const [key, paragraph] of paragraphs) {
        const mask = covered.get(key) ?? [];
        let paragraphMissing = false;
        for (let index = 0; index < paragraph.text.length; index += 1) {
          if (!isMeaningful(paragraph.text[index])) continue;
          meaningfulCharacters += 1;
          if (!mask[index]) {
            missingCharacters += 1;
            paragraphMissing = true;
          }
        }
        if (paragraphMissing) paragraphsWithMissingText += 1;
      }

      const samplePages = [...new Set([0, 3, 15, document.rendering.pageCount() - 1])]
        .filter((pageIndex) => pageIndex >= 0 && pageIndex < document.rendering.pageCount());
      for (const pageIndex of samplePages) {
        expect((await document.rendering.renderPage(pageIndex)).svg).toMatch(/^<svg/);
      }

      const sortedTimes = pageTimes.toSorted((left, right) => left - right);
      console.log(JSON.stringify({
        fileLabel: "local-only-fixture",
        pageCount: document.rendering.pageCount(),
        paragraphCount: paragraphs.size,
        semanticRunCount,
        bodyRunCount,
        mismatchedRuns,
        mismatchSamples: mismatchSamples.slice(0, 10),
        mappedTargets,
        meaningfulCharacters,
        missingCharacters,
        paragraphsWithMissingText,
        textCoveragePercent: meaningfulCharacters === 0
          ? 100
          : Number(((meaningfulCharacters - missingCharacters) / meaningfulCharacters * 100).toFixed(4)),
        textLayoutPageMs: {
          median: percentile(sortedTimes, 0.5),
          p95: percentile(sortedTimes, 0.95),
          max: sortedTimes.at(-1) ?? 0,
        },
        totalMs: performance.now() - startedAt,
      }, null, 2));

      expect(mismatchedRuns).toBe(0);
      expect(mappedTargets).toBeGreaterThan(0);
    } finally {
      document.dispose();
    }
  },
  120_000,
);

function paragraphKey(paragraph: ParagraphSnapshot): string {
  return `${paragraph.sectionIndex}:${paragraph.paragraphIndex}`;
}

function isMeaningful(character: string): boolean {
  return !/[\s\u0000-\u001f\u007f\u200b\ufeff\ufffc]/u.test(character);
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  return Number(values[Math.min(values.length - 1, Math.floor(values.length * ratio))].toFixed(3));
}
