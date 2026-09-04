import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createRhwpDocument } from "@hwpx-lens/hwpx-adapter";
import { initializeRhwpTestRuntime } from "./helpers/rhwp-test-runtime";

const fixturePath = path.resolve("local-fixtures/local-document-a.hwpx");

describe.skipIf(!existsSync(fixturePath))("local image caption classification", () => {
  it("maps source captions and numbers only uncaptioned images", async () => {
    await initializeRhwpTestRuntime();
    const lensDocument = await createRhwpDocument(await readFile(fixturePath));
    try {
      const snapshot = await lensDocument.createSnapshot();
      const images = snapshot.images ?? [];
      const captioned = images.filter((image) => image.classification === "captioned");
      const other = images.filter((image) => image.classification === "other");

      expect(captioned.length).toBeGreaterThan(0);
      expect(other.length).toBeGreaterThan(0);
      expect(captioned.every((image) => /^그림 \d+(?:-\d+)*$/u.test(image.captionLabel ?? "")))
        .toBe(true);
      expect(other.map((image) => image.classificationIndex))
        .toEqual(other.map((_, index) => index + 1));
    } finally {
      lensDocument.dispose();
    }
  }, 120_000);
});
