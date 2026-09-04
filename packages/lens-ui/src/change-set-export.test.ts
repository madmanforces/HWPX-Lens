import { describe, expect, it } from "vitest";
import {
  CHANGE_SET_PRIVACY_WARNING,
  createParagraphSnapshot,
} from "@hwpx-lens/lens-core";
import { prepareChangeSetExport } from "./change-set-export";

describe("Change Set export preparation", () => {
  it("re-reads immutable files, validates the payload, and returns a JSON filename", async () => {
    const originalFile = new File(
      [Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 1])],
      "previous.hwpx",
    );
    const modifiedFile = new File(
      [Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 2])],
      "latest.hwpx",
    );
    const originalParagraph = createParagraphSnapshot(0, 0, "Before")!;
    const modifiedParagraph = createParagraphSnapshot(0, 0, "After")!;
    const prepared = await prepareChangeSetExport({
      originalFile,
      modifiedFile,
      originalSnapshot: { paragraphs: [originalParagraph], tables: [], images: [] },
      modifiedSnapshot: { paragraphs: [modifiedParagraph], tables: [], images: [] },
      changes: [{
        id: "text-1",
        type: "text",
        kind: "modified",
        detail: "content",
        originalText: "Before",
        modifiedText: "After",
        originalAnchor: {
          target: "body-text",
          sectionIndex: 0,
          paragraphIndex: 0,
          textRange: { start: 0, end: 6 },
          textFingerprint: originalParagraph.fingerprint,
          confidence: "contextual",
        },
        modifiedAnchor: {
          target: "body-text",
          sectionIndex: 0,
          paragraphIndex: 0,
          textRange: { start: 0, end: 5 },
          textFingerprint: modifiedParagraph.fingerprint,
          confidence: "contextual",
        },
        segments: [{
          kind: "modified",
          originalRange: { start: 0, end: 6 },
          modifiedRange: { start: 0, end: 5 },
        }],
      }],
      supportedTypes: ["text", "outline", "table", "image"],
      analysisIdentity: "ui-export-test-v1",
      productProfile: "general",
      generator: {
        version: "0.1.1",
        lensCoreVersion: "0.0.1",
        adapterName: "rhwp",
        adapterVersion: "0.0.1",
      },
      exportId: "exp-20260904-ui0001",
      exportedAt: "2026-09-04T19:30:00+09:00",
    });

    expect(prepared.defaultFileName).toMatch(/^hwpx-lens-[0-9a-f]{12}-change-set\.json$/u);
    expect(prepared.payload.documents.original.role).toBe("previous");
    expect(prepared.payload.documents.modified.role).toBe("latest");
    expect(JSON.parse(prepared.json)).toEqual(prepared.payload);
    expect(prepared.json).not.toContain("data:image");
  });

  it("exposes the complete privacy warning used before save", () => {
    expect(CHANGE_SET_PRIVACY_WARNING).toContain("파일명");
    expect(CHANGE_SET_PRIVACY_WARNING).toContain("변경 전후 텍스트");
    expect(CHANGE_SET_PRIVACY_WARNING).toContain("목차 경로");
    expect(CHANGE_SET_PRIVACY_WARNING).toContain("원본 이미지 바이너리는 포함되지 않지만");
    expect(CHANGE_SET_PRIVACY_WARNING).toContain("민감하거나 개인정보");
  });
});
