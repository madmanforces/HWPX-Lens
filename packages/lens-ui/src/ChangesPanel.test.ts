import { describe, expect, it } from "vitest";
import type { Change } from "@hwpx-lens/lens-core";
import { changeCategory, changesInScope, countChanges } from "./ChangesPanel";
import { GENERAL_DOCUMENT_PROFILE, type ProductProfile } from "./profiles";

const SPECIALIZED_PROFILE: ProductProfile = {
  ...GENERAL_DOCUMENT_PROFILE,
  id: "specialized-test",
  displayName: "Specialized test",
  specialTableCategory: {
    filterLabel: "Priority group",
    summaryLabel: "Priority",
    rules: [{ labels: ["Priority"], itemLabel: "Priority table" }],
  },
};

describe("changeCategory", () => {
  it("keeps whitespace, outline and configured table groups out of generic buckets", () => {
    const changes = [
      { id: "text", type: "text", kind: "modified", detail: "content" },
      { id: "space", type: "text", kind: "modified", detail: "whitespace" },
      {
        id: "outline", type: "outline", kind: "removed", detail: "outline-removed",
        locationLabel: "(나) 시동", level: 6,
      },
      {
        id: "priority", type: "table", kind: "modified", detail: "cell-text",
        locationLabel: "표 1", classificationLabels: ["Priority"],
      },
      {
        id: "table", type: "table", kind: "modified", detail: "cell-text",
        locationLabel: "표 2",
      },
      {
        id: "image", type: "image", kind: "modified", detail: "image-changed",
        locationLabel: "캡션 이미지 그림 2-1", binaryChanged: true, renderingChanged: true,
        classification: "captioned", captionLabel: "그림 2-1",
      },
      {
        id: "other-image", type: "image", kind: "added", detail: "image-added",
        locationLabel: "기타 이미지 1", binaryChanged: true, renderingChanged: true,
        classification: "other",
      },
    ] satisfies Change[];

    expect(changes.map((change) => changeCategory(change, SPECIALIZED_PROFILE))).toEqual([
      "text",
      "whitespace",
      "outline",
      "special-table",
      "table",
      "captioned-image",
      "other-image",
    ]);
  });

  it("counts only the changes supplied by the active structure scope", () => {
    const all = [
      { id: "text", type: "text", kind: "modified", detail: "content" },
      { id: "space", type: "text", kind: "modified", detail: "whitespace" },
      { id: "image", type: "image", kind: "modified", detail: "image-changed",
        locationLabel: "기타 이미지 1", binaryChanged: true, renderingChanged: true,
        classification: "other" },
    ] satisfies Change[];
    const scoped = changesInScope(all, ["text"]);

    expect(countChanges(scoped, SPECIALIZED_PROFILE)).toEqual({
      all: 1,
      text: 1,
      whitespace: 0,
      outline: 0,
      "special-table": 0,
      table: 0,
      "captioned-image": 0,
      "other-image": 0,
    });
  });

  it("treats locally grouped tables as ordinary tables in the general profile", () => {
    const priorityTable = {
      id: "priority", type: "table", kind: "modified", detail: "cell-text",
      locationLabel: "표 1", classificationLabels: ["Priority"],
    } satisfies Change;

    expect(changeCategory(priorityTable, SPECIALIZED_PROFILE)).toBe("special-table");
    expect(changeCategory(priorityTable, GENERAL_DOCUMENT_PROFILE)).toBe("table");
    expect(countChanges([priorityTable], GENERAL_DOCUMENT_PROFILE)).toMatchObject({
      all: 1,
      "special-table": 0,
      table: 1,
    });
  });
});
