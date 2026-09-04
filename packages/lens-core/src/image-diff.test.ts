import { describe, expect, it } from "vitest";
import { compareImageSnapshots } from "./image-diff";
import type { ImageSnapshot } from "./types";

function image(
  imageIndex: number,
  sourceHash: string,
  overrides: Partial<ImageSnapshot> = {},
): ImageSnapshot {
  return {
    imageIndex,
    pageIndex: imageIndex,
    sectionIndex: 0,
    paragraphIndex: imageIndex * 2,
    controlIndex: 0,
    stableKey: `0:${imageIndex * 2}:0`,
    mime: "image/png",
    byteLength: 100,
    sourceHash,
    renderFingerprint: `render-${sourceHash}`,
    rect: { pageIndex: imageIndex, x: 10, y: 20, width: 100, height: 80 },
    classification: "other",
    classificationIndex: imageIndex + 1,
    ...overrides,
  };
}

describe("compareImageSnapshots", () => {
  it("reports a source replacement at the same semantic anchor as IMAGE_CHANGED", () => {
    const changes = compareImageSnapshots(
      [image(0, "a")],
      [image(0, "b")],
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      type: "image",
      kind: "modified",
      detail: "image-changed",
      binaryChanged: true,
      originalAnchor: { target: "image", imageIndex: 0 },
      modifiedAnchor: { target: "image", imageIndex: 0 },
    });
  });

  it("keeps an inserted image between unchanged neighbors separate", () => {
    const before = [image(0, "a"), image(1, "c")];
    const after = [image(0, "a"), image(1, "b"), image(2, "c", {
      stableKey: before[1].stableKey,
    })];
    const changes = compareImageSnapshots(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      kind: "added",
      detail: "image-added",
      modifiedAnchor: { target: "image", imageIndex: 1 },
    });
  });

  it("reports a removed image with an original anchor and nearby modified context", () => {
    const before = [image(0, "a"), image(1, "b"), image(2, "c")];
    const after = [
      image(0, "a"),
      image(1, "c", { stableKey: before[2].stableKey }),
    ];
    const changes = compareImageSnapshots(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      kind: "removed",
      detail: "image-removed",
      originalAnchor: { target: "image", imageIndex: 1 },
      modifiedContextAnchor: { target: "image" },
    });
  });

  it("distinguishes visual metadata changes from encoded byte changes", () => {
    const changes = compareImageSnapshots(
      [image(0, "same")],
      [image(0, "same", { renderFingerprint: "cropped" })],
    );
    expect(changes[0]).toMatchObject({
      detail: "image-changed",
      binaryChanged: false,
      renderingChanged: true,
    });
  });

  it("uses the semantic caption number instead of the global image index", () => {
    const changes = compareImageSnapshots(
      [image(2, "before", { classification: "captioned", captionLabel: "그림 2-1" })],
      [image(2, "after", { classification: "captioned", captionLabel: "그림 2-1" })],
    );

    expect(changes[0]).toMatchObject({
      classification: "captioned",
      captionLabel: "그림 2-1",
      locationLabel: "캡션 이미지 그림 2-1 · 3쪽",
    });
  });

  it("numbers only uncaptioned images in the other-image sequence", () => {
    const changes = compareImageSnapshots(
      [],
      [image(8, "other", { classification: "other", classificationIndex: 2 })],
    );

    expect(changes[0]).toMatchObject({
      classification: "other",
      locationLabel: "기타 이미지 2 · 9쪽",
    });
  });
});
