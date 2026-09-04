import { describe, expect, it } from "vitest";
import { sanitizeRenderedSvg } from "./svg-safety";

function embeddedSvg(markup: string): string {
  return `data:image/svg+xml;base64,${encodeBase64(markup)}`;
}

function readEmbeddedSvg(reference: string): string {
  const binary = atob(reference.slice(reference.indexOf(",") + 1));
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  return btoa(String.fromCharCode(...bytes));
}

describe("sanitizeRenderedSvg", () => {
  it("removes executable and remote SVG content", () => {
    const result = sanitizeRenderedSvg(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="200">
        <script>alert(1)</script>
        <foreignObject><iframe src="https://example.com" /></foreignObject>
        <image href="https://example.com/tracker.png" onload="alert(1)" />
        <a href="javascript:alert(1)"><text>unsafe</text></a>
        <style>@import url(https://example.com/evil.css)</style>
        <image href="data:image/svg+xml;base64,PHN2Zy8+" />
        <image href="data:image/png;base64,AA==" />
      </svg>
    `);

    expect(result.viewBox).toEqual([0, 0, 100, 200]);
    expect(result.markup).not.toMatch(/script|foreignObject|iframe|onload|https:|javascript:/i);
    expect(result.markup).toContain('data-hwpx-lens-image-status="blocked"');
    expect(result.markup).toContain("data:image/png;base64,AA==");
  });

  it("recursively sanitizes an embedded SVG image and keeps safe vector content", () => {
    const nested = embeddedSvg(`
      <svg xmlns="http://www.w3.org/2000/svg" width="40" height="30">
        <script>alert(1)</script>
        <foreignObject><iframe src="https://example.com" /></foreignObject>
        <rect width="40" height="30" fill="#123456" onclick="alert(1)" />
        <image href="data:image/png;base64,AA==" />
        <image href="https://example.com/tracker.png" />
        <a href="data:image/png;base64,AA=="><text>not a navigation target</text></a>
        <rect clip-path="url(data:image/svg+xml;base64,PHN2Zy8+)" />
      </svg>
    `);
    const result = sanitizeRenderedSvg(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="200">
        <image id="document-picture" href="${nested}" />
      </svg>
    `);

    const parsed = new DOMParser().parseFromString(result.markup, "image/svg+xml");
    const reference = parsed.querySelector("#document-picture")?.getAttribute("href");
    expect(reference).toMatch(/^data:image\/svg\+xml;base64,/);
    const safeNested = readEmbeddedSvg(reference!);
    expect(safeNested).toContain("#123456");
    expect(safeNested).toContain("data:image/png;base64,AA==");
    expect(safeNested).not.toMatch(/script|foreignObject|iframe|onclick|https:/i);
    const parsedNested = new DOMParser().parseFromString(safeNested, "image/svg+xml");
    expect(parsedNested.querySelector("a")?.hasAttribute("href")).toBe(false);
    expect(parsedNested.querySelector("rect[clip-path]")).toBeNull();
  });

  it("supports percent-encoded SVG data while removing nested executable content", () => {
    const nested = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">
        <a href="javascript:alert(1)"><text>safe text</text></a>
      </svg>
    `)}`;
    const result = sanitizeRenderedSvg(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <image id="percent-svg" href="${nested}" />
      </svg>
    `);

    const parsed = new DOMParser().parseFromString(result.markup, "image/svg+xml");
    const reference = parsed.querySelector("#percent-svg")?.getAttribute("href");
    const safeNested = readEmbeddedSvg(reference!);
    expect(safeNested).toContain("safe text");
    expect(safeNested).not.toMatch(/javascript:/i);
  });

  it("fails closed when embedded SVG limits are exceeded", () => {
    const nested = embeddedSvg(`
      <svg xmlns="http://www.w3.org/2000/svg" width="40" height="30">
        <rect width="40" height="30" />
      </svg>
    `);
    const result = sanitizeRenderedSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><image href="${nested}" /></svg>`,
      {
        maxEmbeddedSvgBytes: 8,
        maxTotalEmbeddedSvgBytes: 8,
        maxEmbeddedSvgElements: 1,
        maxEmbeddedSvgDepth: 1,
      },
    );

    expect(result.markup).not.toContain("data:image/svg+xml");
    expect(result.markup).toContain('data-hwpx-lens-image-status="blocked"');
  });

  it("blocks DTD declarations inside an embedded SVG", () => {
    const nested = embeddedSvg(`
      <!DOCTYPE svg [<!ENTITY payload SYSTEM "https://example.com/payload">]>
      <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">
        <text>&payload;</text>
      </svg>
    `);
    const result = sanitizeRenderedSvg(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <image href="${nested}" />
      </svg>
    `);

    expect(result.markup).not.toContain("data:image/svg+xml");
    expect(result.markup).toContain('data-hwpx-lens-image-status="blocked"');
  });

  it("sanitizes one nested level and blocks recursion beyond the depth budget", () => {
    const deepest = embeddedSvg(`
      <svg xmlns="http://www.w3.org/2000/svg" width="5" height="5"><rect width="5" height="5" /></svg>
    `);
    const middle = embeddedSvg(`
      <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><image href="${deepest}" /></svg>
    `);
    const result = sanitizeRenderedSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><image id="outer" href="${middle}" /></svg>`,
      {
        maxEmbeddedSvgBytes: 1024 * 1024,
        maxTotalEmbeddedSvgBytes: 2 * 1024 * 1024,
        maxEmbeddedSvgElements: 100,
        maxEmbeddedSvgDepth: 1,
      },
    );

    const parsed = new DOMParser().parseFromString(result.markup, "image/svg+xml");
    const outerReference = parsed.querySelector("#outer")?.getAttribute("href");
    expect(outerReference).toMatch(/^data:image\/svg\+xml;base64,/);
    const safeMiddle = readEmbeddedSvg(outerReference!);
    expect(safeMiddle).not.toContain(deepest);
    expect(safeMiddle).toContain('data-hwpx-lens-image-status="blocked"');
  });

  it("rejects malformed non-SVG output", () => {
    expect(() => sanitizeRenderedSvg("<html></html>")).toThrow(/유효한 SVG/);
  });

  it("scopes page-local ids and fragment references for multi-page HTML mounting", () => {
    const source = `
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" aria-labelledby="page-title">
        <title id="page-title">page</title>
        <defs>
          <clipPath id="cell-clip-1"><rect width="20" height="20" /></clipPath>
          <linearGradient id="fill-1"><stop offset="1" stop-color="#fff" /></linearGradient>
          <path id="shape-1" d="M0 0h10v10z" />
        </defs>
        <g clip-path="url(#cell-clip-1)">
          <rect width="20" height="20" fill="url('#fill-1')" />
          <use href="#shape-1" />
        </g>
      </svg>
    `;
    const first = sanitizeRenderedSvg(source, undefined, "document-1-page-0");
    const second = sanitizeRenderedSvg(source, undefined, "document-2-page-0");
    const firstDocument = new DOMParser().parseFromString(first.markup, "image/svg+xml");
    const secondDocument = new DOMParser().parseFromString(second.markup, "image/svg+xml");

    const firstIds = Array.from(firstDocument.querySelectorAll("[id]"), (element) => element.id);
    const secondIds = Array.from(secondDocument.querySelectorAll("[id]"), (element) => element.id);
    expect(firstIds).toEqual([
      "document-1-page-0-page-title",
      "document-1-page-0-cell-clip-1",
      "document-1-page-0-fill-1",
      "document-1-page-0-shape-1",
    ]);
    expect(new Set([...firstIds, ...secondIds]).size).toBe(firstIds.length + secondIds.length);
    expect(firstDocument.documentElement.getAttribute("aria-labelledby")).toBe("document-1-page-0-page-title");
    expect(firstDocument.querySelector("g")?.getAttribute("clip-path")).toBe(
      "url(#document-1-page-0-cell-clip-1)",
    );
    expect(firstDocument.querySelector("rect[fill]")?.getAttribute("fill")).toBe(
      "url(#document-1-page-0-fill-1)",
    );
    expect(firstDocument.querySelector("use")?.getAttribute("href")).toBe("#document-1-page-0-shape-1");
  });
});
