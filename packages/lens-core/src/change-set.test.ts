import { describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import schema from "../../../schemas/change-set.schema.json";
import {
  CHANGE_SET_SCHEMA_VERSION,
  assertChangeSetIntegrity,
  assertJsonSafe,
  buildChangeSet,
  canonicalSemVer,
  compareDocumentSnapshots,
  createComparisonId,
  createTableSnapshot,
  sentinelizeVolatileExportFields,
  serializeChangeSet,
  sha256Hex,
  validateChangeSetIntegrity,
} from "./index";
import type {
  BuildChangeSetInput,
  ChangeSet,
  DocumentSnapshot,
  ParagraphSnapshot,
} from "./index";
import { createParagraphSnapshot } from "./text";

const ORIGINAL_BYTES = new TextEncoder().encode("PK\u0003\u0004-original-contract-fixture");
const MODIFIED_BYTES = new TextEncoder().encode("PK\u0003\u0004-modified-contract-fixture");
const ORIGINAL_IMAGE_HASH = "1".repeat(64);
const MODIFIED_IMAGE_HASH = "2".repeat(64);

describe("Change Set JSON export", () => {
  it("matches the language-independent comparisonId known vector", async () => {
    await expect(createComparisonId(
      "4da56da16f0194211177726f5abd8a7fcdfb808b2d4562c614536ad1633a4743",
      "bdf41436799c8ff4212a076cb1371987d21e9aea7d5ef407398b63319b7ac48c",
      "1.0.0",
    )).resolves.toBe("cmp-15580855e4d1bbdd548eee06d533bc03149b11951d4098f8aa83f1422949867d");
  });

  it("normalizes SHA boundaries, preserves side order, and rejects invalid input", async () => {
    const left = "A".repeat(64);
    const right = "b".repeat(64);
    const normalized = await createComparisonId(` \t${left}\r\n`, right, " 1.0.0 ");
    await expect(createComparisonId(left.toLowerCase(), right, "1.0.0")).resolves.toBe(normalized);
    await expect(createComparisonId(right, left, "1.0.0")).resolves.not.toBe(normalized);
    await expect(createComparisonId("bad", right, "1.0.0")).rejects.toThrow(/SHA-256/u);
    await expect(createComparisonId(left, right, "v1.0.0")).rejects.toThrow(/SemVer/u);
    expect(() => canonicalSemVer("01.0.0")).toThrow(/SemVer/u);
  });

  it("exports every canonical change type and complete outline coverage", async () => {
    const input = fixtureInput();
    const payload = await buildChangeSet(input);
    await assertChangeSetIntegrity(payload, integrityContext(input));

    expect(payload.schemaVersion).toBe(CHANGE_SET_SCHEMA_VERSION);
    expect(payload.documents.original.role).toBe("previous");
    expect(payload.documents.modified.role).toBe("latest");
    expect(payload.documents.original.fileName).toBe("previous.hwpx");
    expect(new Set(payload.changes.map((change) => change.type))).toEqual(
      new Set(["text", "outline", "table", "image"]),
    );
    expect(payload.outlineMappings.flatMap((mapping) => mapping.original ? [mapping.original] : []))
      .toHaveLength(payload.documents.original.outlineCount);
    expect(payload.outlineMappings.flatMap((mapping) => mapping.modified ? [mapping.modified] : []))
      .toHaveLength(payload.documents.modified.outlineCount);
    expect(payload.outlineMappings.some((mapping) =>
      mapping.relations.includes("moved") && mapping.relations.includes("modified"),
    )).toBe(true);
    expect(payload.outlineMappings.some((mapping) => mapping.relations[0] === "added")).toBe(true);
    expect(payload.outlineMappings.some((mapping) => mapping.relations[0] === "removed")).toBe(true);
    expect(payload.summary.totalChanges).toBe(payload.changes.length);
    expect(payload.comparisonId).toBe(await createComparisonId(
      await sha256Hex(ORIGINAL_BYTES),
      await sha256Hex(MODIFIED_BYTES),
      CHANGE_SET_SCHEMA_VERSION,
    ));
  });

  it("is byte-for-byte deterministic after sentinelizing only /exportId and /exportedAt", async () => {
    const firstInput = fixtureInput();
    const secondInput = {
      ...fixtureInput(),
      exportId: "exp-20260904-bbb222",
      exportedAt: "2026-09-04T20:31:00+09:00",
    };
    const first = await buildChangeSet(firstInput);
    const second = await buildChangeSet(secondInput);
    expect(first.comparisonId).toBe(second.comparisonId);
    expect(serializeChangeSet(sentinelizeVolatileExportFields(first)))
      .toBe(serializeChangeSet(sentinelizeVolatileExportFields(second)));
    expect(serializeChangeSet(first).endsWith("\n")).toBe(true);
    expect(new TextEncoder().encode(serializeChangeSet(first)).slice(0, 3))
      .not.toEqual(Uint8Array.from([0xef, 0xbb, 0xbf]));
    expect(Object.keys(first)).toEqual([
      "schemaVersion", "comparisonId", "exportId", "exportedAt", "generator",
      "analysis", "coordinateSystem", "fingerprintSpec", "documents", "summary",
      "changes", "outlineMappings",
    ]);
  });

  it("detects cross-reference, summary, range, path and raw-byte corruption", async () => {
    const input = fixtureInput();
    const payload = await buildChangeSet(input);
    const corrupted = structuredClone(payload);
    corrupted.summary.totalChanges += 1;
    corrupted.outlineMappings[0].relatedChangeIds.push("chg-999999");
    const text = corrupted.changes.find((change) => change.type === "text" && change.original);
    if (text?.original?.anchor.target === "body-text") text.original.anchor.textRange = { start: 0, end: 99_999 };
    corrupted.documents.original.sha256 = "0".repeat(64);
    const issues = await validateChangeSetIntegrity(corrupted, integrityContext(input));
    expect(issues.some((issue) => issue.includes("summary.totalChanges"))).toBe(true);
    expect(issues.some((issue) => issue.includes("relatedChangeId"))).toBe(true);
    expect(issues.some((issue) => issue.includes("textRange"))).toBe(true);
    expect(issues.some((issue) => issue.includes("raw SHA-256"))).toBe(true);
  });

  it("never promotes duplicate outline titles to exact mapping confidence", async () => {
    const duplicateSnapshot: DocumentSnapshot = {
      paragraphs: [
        paragraph(0, "Repeated title", 1, "1", 0),
        paragraph(1, "Repeated title", 1, "2", 0),
      ],
      tables: [],
      images: [],
    };
    const input = fixtureInput();
    input.original.snapshot = duplicateSnapshot;
    input.modified.snapshot = structuredClone(duplicateSnapshot);
    input.changes = compareDocumentSnapshots(input.original.snapshot, input.modified.snapshot);
    const payload = await buildChangeSet(input);
    expect(payload.outlineMappings).toHaveLength(2);
    expect(payload.outlineMappings.every((mapping) => mapping.mappingConfidence === "approximate"))
      .toBe(true);
  });

  it("rejects binary, non-JSON values, data URLs, local paths, and credentials", () => {
    expect(() => assertJsonSafe({ bytes: new Uint8Array([1]) })).toThrow(/binary/u);
    expect(() => assertJsonSafe({ value: Number.NaN })).toThrow(/유한/u);
    expect(() => assertJsonSafe({ value: undefined })).toThrow(/직렬화/u);
    const absolutePath = ["C:", "Users", "someone", "document.hwpx"].join("\\");
    expect(() => assertJsonSafe({ path: absolutePath })).toThrow(/절대경로/u);
    expect(() => assertJsonSafe({ image: "data:image/png;base64,AAAA" })).toThrow(/data URL/u);
    expect(() => assertJsonSafe({ note: "api_key=secret-value" })).toThrow(/credential/u);
  });

  it("validates the schema itself and accepts a full generated export", async () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    expect(ajv.validateSchema(schema), JSON.stringify(ajv.errors)).toBe(true);
    const validate = ajv.compile(schema);
    const payload = await buildChangeSet(fixtureInput());
    expect(validate(payload), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects schema role, hash, ID, enum, side, relation and numeric violations", async () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const valid = await buildChangeSet(fixtureInput());
    const mutations: Array<(payload: ChangeSet) => void> = [
      (payload) => { (payload.documents.original as { role: string }).role = "latest"; },
      (payload) => { payload.documents.original.sha256 = payload.documents.original.sha256.toUpperCase(); },
      (payload) => { payload.comparisonId = "cmp-invalid"; },
      (payload) => { (payload.changes[0] as { type: string }).type = "unsupported"; },
      (payload) => {
        const change = payload.changes.find((item) => item.kind === "modified")!;
        change.kind = "added";
      },
      (payload) => {
        const change = payload.changes.find((item) => item.kind === "modified")!;
        change.kind = "removed";
      },
      (payload) => {
        const change = payload.changes.find((item) => item.kind === "modified")!;
        change.modified = null;
      },
      (payload) => { payload.outlineMappings[0].relations = ["unchanged", "unchanged"]; },
      (payload) => { payload.outlineMappings[0].relations = ["added", "modified"]; },
      (payload) => { payload.documents.original.paragraphCount = -1; },
      (payload) => {
        const table = payload.changes.find((item) => item.type === "table" && item.original?.anchor.target === "table-cell")!;
        if (table.original?.anchor.target === "table-cell") table.original.anchor.rowSpan = 0;
      },
      (payload) => { payload.outlineMappings[0].similarity = 2; },
      (payload) => { delete (payload as unknown as Record<string, unknown>).documents; },
    ];
    for (const mutate of mutations) {
      const candidate = structuredClone(valid);
      mutate(candidate);
      expect(validate(candidate), JSON.stringify(validate.errors)).toBe(false);
    }
  });
});

function fixtureInput(): BuildChangeSetInput {
  const original = originalSnapshot();
  const modified = modifiedSnapshot();
  return {
    original: {
      fileName: "C:\\private\\previous.hwpx",
      bytes: ORIGINAL_BYTES,
      snapshot: original,
    },
    modified: {
      fileName: "/private/latest.hwpx",
      bytes: MODIFIED_BYTES,
      snapshot: modified,
    },
    changes: compareDocumentSnapshots(original, modified),
    generator: {
      version: "0.1.1",
      lensCoreVersion: "0.0.1",
      adapterName: "rhwp",
      adapterVersion: "0.0.1",
      analysisIdentity: "fixture-analysis-v1",
      productProfile: "general",
    },
    analysis: {
      status: "complete",
      supportedTypes: ["text", "outline", "table", "image"],
      completedTypes: ["text", "outline", "table", "image"],
      warnings: [],
    },
    exportId: "exp-20260904-aaa111",
    exportedAt: "2026-09-04T20:30:00+09:00",
  };
}

function integrityContext(input: BuildChangeSetInput) {
  return {
    originalBytes: input.original.bytes,
    modifiedBytes: input.modified.bytes,
    originalSnapshot: input.original.snapshot,
    modifiedSnapshot: input.modified.snapshot,
    expectedSupportedTypes: ["text", "outline", "table", "image"],
    expectedCompletedTypes: ["text", "outline", "table", "image"],
  };
}

function originalSnapshot(): DocumentSnapshot {
  return {
    paragraphs: [
      paragraph(0, "Root", 1, "1", 0),
      paragraph(1, "Stable", 2, "1.1", 0),
      plain(2, "Original paragraph"),
      paragraph(3, "Old parent", 1, "2", 1),
      paragraph(4, "Moved item", 2, "2.1", 1),
      plain(5, "Moved original content"),
      paragraph(6, "Obsolete alpha", 1, "3", 2),
    ],
    tables: [createTableSnapshot({
      tableIndex: 0,
      sectionIndex: 0,
      paragraphIndex: 2,
      controlIndex: 0,
      rowCount: 1,
      columnCount: 1,
      cells: [{ cellIndex: 0, row: 0, column: 0, rowSpan: 1, columnSpan: 1, paragraphs: ["Old cell"] }],
    })],
    images: [{
      imageIndex: 0,
      pageIndex: 0,
      sectionIndex: 0,
      paragraphIndex: 2,
      controlIndex: 1,
      stableKey: "fixture-image",
      mime: "image/png",
      byteLength: 10,
      sourceHash: ORIGINAL_IMAGE_HASH,
      renderFingerprint: "1234abcd",
      rect: { pageIndex: 0, x: 10, y: 20, width: 30, height: 40 },
      classification: "captioned",
      captionLabel: "Figure 1",
    }],
  };
}

function modifiedSnapshot(): DocumentSnapshot {
  return {
    paragraphs: [
      paragraph(0, "Root", 1, "1", 0),
      paragraph(1, "Stable", 2, "1.1", 0),
      plain(2, "Modified paragraph"),
      paragraph(3, "New parent", 1, "2", 1),
      paragraph(4, "Moved item", 2, "2.1", 1),
      plain(5, "Moved modified content"),
      paragraph(6, "New zulu", 1, "4", 2),
    ],
    tables: [createTableSnapshot({
      tableIndex: 0,
      sectionIndex: 0,
      paragraphIndex: 2,
      controlIndex: 0,
      rowCount: 1,
      columnCount: 1,
      cells: [{ cellIndex: 0, row: 0, column: 0, rowSpan: 1, columnSpan: 1, paragraphs: ["New cell"] }],
    })],
    images: [{
      imageIndex: 0,
      pageIndex: 0,
      sectionIndex: 0,
      paragraphIndex: 2,
      controlIndex: 1,
      stableKey: "fixture-image",
      mime: "image/png",
      byteLength: 12,
      sourceHash: MODIFIED_IMAGE_HASH,
      renderFingerprint: "5678efab",
      rect: { pageIndex: 0, x: 10, y: 20, width: 30, height: 40 },
      classification: "captioned",
      captionLabel: "Figure 1",
    }],
  };
}

function paragraph(
  paragraphIndex: number,
  text: string,
  level: number,
  number: string,
  pageIndex: number,
): ParagraphSnapshot {
  const value = createParagraphSnapshot(0, paragraphIndex, text)!;
  return { ...value, outline: { level, number, pageIndex } };
}

function plain(paragraphIndex: number, text: string): ParagraphSnapshot {
  return createParagraphSnapshot(0, paragraphIndex, text)!;
}
