import { beforeAll, expect, it } from "vitest";
import { createRhwpInteractionPocDocument } from "@hwpx-lens/hwpx-adapter";
import { createFidelityFixture } from "./helpers/rhwp-fidelity-fixtures";
import { initializeRhwpTestRuntime } from "./helpers/rhwp-test-runtime";

beforeAll(initializeRhwpTestRuntime);

it("keeps fragment ids unique across documents and virtualized SVG pages", async () => {
  const bytes = await createFidelityFixture("multi-page-text");
  const original = await createRhwpInteractionPocDocument(bytes);
  const modified = await createRhwpInteractionPocDocument(bytes);
  try {
    expect(original.rendering.pageCount()).toBeGreaterThan(1);
    const pages = await Promise.all([
      original.rendering.renderPage(0),
      original.rendering.renderPage(1),
      modified.rendering.renderPage(0),
      modified.rendering.renderPage(1),
    ]);
    const allIds: string[] = [];
    for (const page of pages) {
      expect(page.kind).toBe("svg");
      if (page.kind !== "svg") continue;
      const parsed = new DOMParser().parseFromString(page.svg, "image/svg+xml");
      const localIds = new Set(Array.from(parsed.querySelectorAll("[id]"), (element) => element.id));
      expect(localIds.size).toBeGreaterThan(0);
      for (const element of parsed.querySelectorAll("*")) {
        for (const attribute of Array.from(element.attributes)) {
          for (const match of attribute.value.matchAll(/url\(#([^)]+)\)/gu)) {
            expect(localIds.has(match[1])).toBe(true);
          }
          if (
            (attribute.localName === "href" || attribute.name.toLowerCase().endsWith(":href")) &&
            attribute.value.startsWith("#")
          ) {
            expect(localIds.has(attribute.value.slice(1))).toBe(true);
          }
        }
      }
      allIds.push(...localIds);
    }
    expect(new Set(allIds).size).toBe(allIds.length);
  } finally {
    original.dispose();
    modified.dispose();
  }
}, 30_000);
