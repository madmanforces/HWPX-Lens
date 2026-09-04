import { beforeAll, expect, it } from "vitest";
import { HwpDocument } from "@rhwp/core";
import { createRhwpDocument, RhwpDiffAdapter } from "@hwpx-lens/hwpx-adapter";
import { initializeRhwpTestRuntime } from "./helpers/rhwp-test-runtime";
import { loadBodyTextFixture } from "./helpers/hwpx-fixture";

beforeAll(initializeRhwpTestRuntime);

const RED_PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n5cAAAAASUVORK5CYII=",
  "base64",
);
const BLUE_PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

it("builds public image snapshots and detects a replaced source resource", async () => {
  const editable = new HwpDocument(await loadBodyTextFixture());
  let before: Uint8Array;
  let after: Uint8Array;
  try {
    const inserted = JSON.parse(editable.insertPicture(
      0, 0, 0, "[]", RED_PIXEL, 12_000, 8_000, 1, 1, "png", "synthetic image",
    )) as { ok: boolean; paraIdx: number; controlIdx: number };
    expect(inserted.ok).toBe(true);
    before = editable.exportHwpx();
    const assigned = JSON.parse(editable.assignPictureImage(
      0, inserted.paraIdx, "[]", inserted.controlIdx, BLUE_PIXEL, 1, 1, "png",
    )) as { ok: boolean };
    expect(assigned.ok).toBe(true);
    after = editable.exportHwpx();
  } finally {
    editable.free();
  }

  const original = await createRhwpDocument(before);
  const modified = await createRhwpDocument(after);
  try {
    const originalSnapshot = await original.createSnapshot();
    const modifiedSnapshot = await modified.createSnapshot();
    expect(originalSnapshot.images).toHaveLength(1);
    expect(modifiedSnapshot.images).toHaveLength(1);
    expect(originalSnapshot.images![0]).toMatchObject({
      classification: "other",
      classificationIndex: 1,
    });
    expect(originalSnapshot.images![0].sourceHash).not.toBe(modifiedSnapshot.images![0].sourceHash);
    const changes = await new RhwpDiffAdapter().compare(originalSnapshot, modifiedSnapshot);
    expect(changes).toEqual(expect.arrayContaining([expect.objectContaining({
      type: "image",
      kind: "modified",
      detail: "image-changed",
      binaryChanged: true,
    })]));
  } finally {
    original.dispose();
    modified.dispose();
  }
});
