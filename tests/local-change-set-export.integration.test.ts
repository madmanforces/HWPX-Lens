import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { createRhwpDocument, RhwpDiffAdapter } from "@hwpx-lens/hwpx-adapter";
import {
  assertChangeSetIntegrity,
  buildChangeSet,
  serializeChangeSet,
} from "@hwpx-lens/lens-core";
import { initializeRhwpTestRuntime } from "./helpers/rhwp-test-runtime";
import desktopPackage from "../apps/desktop/package.json";

beforeAll(initializeRhwpTestRuntime);

const localFixture = process.env.HWPX_LENS_LOCAL_FIXTURE;

describe("ignored local Change Set export", () => {
  it.skipIf(!localFixture)("profiles compare/export/validation without exposing local content", async () => {
    const fixturePath = path.resolve(localFixture!);
    const fixtureRoot = `${path.resolve("local-fixtures")}${path.sep}`;
    if (!fixturePath.startsWith(fixtureRoot)) {
      throw new Error("Local fixture must stay inside the ignored local-fixtures directory.");
    }
    const bytes = new Uint8Array(await readFile(fixturePath));
    const baselineHeap = process.memoryUsage().heapUsed;
    const started = performance.now();
    const [originalDocument, modifiedDocument] = await Promise.all([
      createRhwpDocument(bytes),
      createRhwpDocument(bytes),
    ]);
    try {
      const openedMs = performance.now() - started;
      const snapshotStarted = performance.now();
      const [originalSnapshot, modifiedSnapshot] = await Promise.all([
        originalDocument.createSnapshot(),
        modifiedDocument.createSnapshot(),
      ]);
      const snapshotMs = performance.now() - snapshotStarted;
      const diff = new RhwpDiffAdapter();
      const diffStarted = performance.now();
      const changes = await diff.compare(originalSnapshot, modifiedSnapshot);
      const diffMs = performance.now() - diffStarted;
      const exportStarted = performance.now();
      const payload = await buildChangeSet({
        original: { fileName: "local-fixture-previous.hwpx", bytes, snapshot: originalSnapshot },
        modified: { fileName: "local-fixture-latest.hwpx", bytes, snapshot: modifiedSnapshot },
        changes,
        generator: {
          version: desktopPackage.version,
          lensCoreVersion: "0.0.1",
          adapterName: "rhwp",
          adapterVersion: "0.0.1",
          analysisIdentity: diff.analysisIdentity,
          productProfile: "general",
        },
        analysis: {
          status: "complete",
          supportedTypes: [...diff.supportedTypes],
          completedTypes: [...diff.supportedTypes],
          warnings: [],
        },
        exportId: "exp-20260904-local01",
        exportedAt: "2026-09-04T20:00:00+09:00",
      });
      await assertChangeSetIntegrity(payload, {
        originalBytes: bytes,
        modifiedBytes: bytes,
        originalSnapshot,
        modifiedSnapshot,
        expectedSupportedTypes: diff.supportedTypes,
        expectedCompletedTypes: diff.supportedTypes,
      });
      const json = serializeChangeSet(payload);
      const exportMs = performance.now() - exportStarted;
      const heapDeltaMiB = (process.memoryUsage().heapUsed - baselineHeap) / 1024 / 1024;
      expect(payload.documents.original.paragraphCount).toBeGreaterThan(0);
      expect(payload.documents.original.outlineCount).toBe(payload.documents.modified.outlineCount);
      expect(changes).toHaveLength(0);
      expect(JSON.parse(json).comparisonId).toBe(payload.comparisonId);
      console.info("local-change-set-export-profile", {
        bytes: bytes.byteLength,
        pageCount: await originalDocument.rendering.pageCount(),
        paragraphCount: originalSnapshot.paragraphs.length,
        outlineCount: payload.documents.original.outlineCount,
        openedMs: Number(openedMs.toFixed(1)),
        snapshotMs: Number(snapshotMs.toFixed(1)),
        diffMs: Number(diffMs.toFixed(1)),
        exportMs: Number(exportMs.toFixed(1)),
        jsonBytes: new TextEncoder().encode(json).byteLength,
        heapDeltaMiB: Number(heapDeltaMiB.toFixed(1)),
      });
    } finally {
      originalDocument.dispose();
      modifiedDocument.dispose();
    }
  }, 120_000);
});
