import { readFile } from "node:fs/promises";
import path from "node:path";
import { HwpDocument } from "@rhwp/core";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createFidelityFixture,
  FIDELITY_FIXTURE_NAMES,
} from "./helpers/rhwp-fidelity-fixtures";
import { initializeRhwpTestRuntime } from "./helpers/rhwp-test-runtime";

interface CanvasKitPreflight {
  schemaVersion: number;
  status: "eligible" | "ineligible" | "incomplete";
  eligible: boolean;
  complete: boolean;
  pageCount: number;
  scannedPages: number;
  summary: {
    totalItems: number;
    directItems: number;
    directRequiredItems: number;
    unsupportedItems: number;
    hiddenOverlayViolations: number;
  };
  blockers: Array<{ pageIndex: number; code: string; opType?: string }>;
  requiredFontFamilies: string[];
}

interface CanvasKitReplayPlan {
  schemaVersion?: number;
  pageIndex?: number;
  supported?: boolean;
  eligible?: boolean;
  directReplayRequired?: boolean;
  hiddenCanvas2dOverlayAllowed?: boolean;
  requiredFontFamilies?: string[];
  requiredFontFamiliesComplete?: boolean;
  items?: Array<{ kind?: string; type?: string; opType?: string }>;
  summary?: CanvasKitPreflight["summary"];
  [key: string]: unknown;
}

interface ReplayPlanSample {
  pageIndex: number;
  schemaVersion?: number;
  supported?: boolean;
  eligible?: boolean;
  directReplayRequired?: boolean;
  hiddenCanvas2dOverlayAllowed?: boolean;
  requiredFontFamilyCount: number;
  requiredFontFamiliesComplete?: boolean;
  itemCount: number;
  itemKinds: string[];
  summary?: CanvasKitPreflight["summary"];
  keys: string[];
}

const documents: HwpDocument[] = [];

beforeAll(initializeRhwpTestRuntime);
afterEach(() => {
  while (documents.length > 0) documents.pop()?.free();
});

describe("CanvasKit public readiness contract", () => {
  it("classifies every required synthetic fixture without replaying Studio code", async () => {
    const results = [];
    for (const name of FIDELITY_FIXTURE_NAMES) {
      const document = new HwpDocument(await createFidelityFixture(name));
      documents.push(document);
      const preflight = parseJson<CanvasKitPreflight>(
        document.getCanvasKitDocumentPreflight("default", "screen"),
      );
      const firstPagePlan = parseJson<CanvasKitReplayPlan>(
        document.getCanvasKitReplayPlanWithProfile(0, "default", "screen"),
      );

      expect(preflight.schemaVersion).toBe(1);
      expect(preflight.pageCount).toBe(document.pageCount());
      expect(preflight.scannedPages).toBeLessThanOrEqual(preflight.pageCount);
      expect(["eligible", "ineligible", "incomplete"]).toContain(preflight.status);
      expect(firstPagePlan.items?.length).toBeGreaterThan(0);
      expect(firstPagePlan.summary?.totalItems).toBe(firstPagePlan.items?.length);

      results.push({
        name,
        pages: preflight.pageCount,
        status: preflight.status,
        complete: preflight.complete,
        totalItems: preflight.summary.totalItems,
        directItems: preflight.summary.directItems,
        directRequiredItems: preflight.summary.directRequiredItems,
        unsupportedItems: preflight.summary.unsupportedItems,
        hiddenOverlayViolations: preflight.summary.hiddenOverlayViolations,
        blockerCodes: [...new Set(preflight.blockers.map((blocker) => blocker.code))],
        requiredFontFamilyCount: preflight.requiredFontFamilies.length,
        replayPlanKeys: Object.keys(firstPagePlan).sort(),
      });
    }
    console.log(JSON.stringify(results, null, 2));
  }, 60_000);

  const localFixture = process.env.HWPX_LENS_LOCAL_FIXTURE;
  it.runIf(Boolean(localFixture))(
    "classifies one ignored local fixture without exposing its content",
    async () => {
      const fixturePath = path.resolve(localFixture!);
      const fixtureRoot = `${path.resolve("local-fixtures")}${path.sep}`;
      expect(fixturePath.startsWith(fixtureRoot)).toBe(true);
      const document = new HwpDocument(await readFile(fixturePath));
      documents.push(document);
      const preflight = parseJson<CanvasKitPreflight>(
        document.getCanvasKitDocumentPreflight("default", "screen"),
      );

      const samplePageIndexes = [...new Set([
        0,
        Math.min(3, preflight.pageCount - 1),
        Math.min(15, preflight.pageCount - 1),
        preflight.pageCount - 1,
      ])].filter((pageIndex) => pageIndex >= 0);
      const replayPlanSamples: ReplayPlanSample[] = samplePageIndexes.map((pageIndex) => {
        const plan = parseJson<CanvasKitReplayPlan>(
          document.getCanvasKitReplayPlanWithProfile(pageIndex, "default", "screen"),
        );
        return {
          pageIndex,
          schemaVersion: plan.schemaVersion,
          supported: plan.supported,
          eligible: plan.eligible,
          directReplayRequired: plan.directReplayRequired,
          hiddenCanvas2dOverlayAllowed: plan.hiddenCanvas2dOverlayAllowed,
          requiredFontFamilyCount: Array.isArray(plan.requiredFontFamilies)
            ? plan.requiredFontFamilies.length
            : 0,
          requiredFontFamiliesComplete: plan.requiredFontFamiliesComplete,
          itemCount: Array.isArray(plan.items) ? plan.items.length : 0,
          itemKinds: [...new Set((plan.items ?? []).map(
            (item) => item.kind ?? item.type ?? item.opType ?? "unknown",
          ))],
          summary: plan.summary,
          keys: Object.keys(plan).sort(),
        };
      });

      console.log(JSON.stringify({
        fileLabel: "local-only-fixture",
        pageCount: preflight.pageCount,
        status: preflight.status,
        complete: preflight.complete,
        scannedPages: preflight.scannedPages,
        summary: preflight.summary,
        blockerCount: preflight.blockers.length,
        blockerCodes: [...new Set(preflight.blockers.map((blocker) => blocker.code))],
        requiredFontFamilyCount: preflight.requiredFontFamilies.length,
        replayPlanSamples,
      }, null, 2));

      expect(preflight.schemaVersion).toBe(1);
      expect(preflight.pageCount).toBe(document.pageCount());
      expect(replayPlanSamples.length).toBeGreaterThan(0);
      for (const sample of replayPlanSamples) {
        expect(sample.itemCount).toBeGreaterThan(0);
        expect(sample.summary?.totalItems).toBe(sample.itemCount);
      }
    },
    120_000,
  );
});

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}
