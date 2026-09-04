import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { HwpDocument } from "@rhwp/core";
import { beforeAll, expect, it } from "vitest";
import { initializeRhwpTestRuntime } from "./helpers/rhwp-test-runtime";

beforeAll(initializeRhwpTestRuntime);

const localFixture = process.env.HWPX_LENS_LOCAL_FIXTURE;

interface ClipDiagnostic {
  pageIndex: number;
  clipId: string;
  clipKind: "body" | "cell" | "textbox" | "other";
  clipBottom: number;
  baseline: number;
  baselineOverflow: number;
  fontSize: number | null;
  textFingerprint: string;
}

it.runIf(Boolean(localFixture))(
  "finds no raw SVG text baselines below their clip regions in the local regression fixture",
  async () => {
    const fixturePath = path.resolve(localFixture!);
    const fixtureRoot = `${path.resolve("local-fixtures")}${path.sep}`;
    expect(fixturePath.startsWith(fixtureRoot)).toBe(true);

    const bytes = await readFile(fixturePath);
    const document = new HwpDocument(bytes);
    const diagnostics: ClipDiagnostic[] = [];
    try {
      for (let pageIndex = 0; pageIndex < document.pageCount(); pageIndex += 1) {
        diagnostics.push(...collectPageDiagnostics(pageIndex, document.renderPageSvg(pageIndex)));
      }
    } finally {
      document.free();
    }

    const outputDirectory = path.resolve("test-results/fidelity");
    await mkdir(outputDirectory, { recursive: true });
    const payload = {
      fixtureLabel: "local-fixture-01",
      total: diagnostics.length,
      byKind: countBy(diagnostics, (item) => item.clipKind),
      byPage: countBy(diagnostics, (item) => String(item.pageIndex + 1)),
      maximumBaselineOverflow: Math.max(0, ...diagnostics.map((item) => item.baselineOverflow)),
      samples: diagnostics.slice(0, 100),
    };
    await writeFile(
      path.join(outputDirectory, "local-fixture-01-svg-clipping.json"),
      `${JSON.stringify(payload, null, 2)}\n`,
      "utf8",
    );
    console.log(JSON.stringify({
      total: payload.total,
      byKind: payload.byKind,
      maximumBaselineOverflow: payload.maximumBaselineOverflow,
    }));
    expect(diagnostics).toHaveLength(0);
  },
  300_000,
);

function collectPageDiagnostics(pageIndex: number, markup: string): ClipDiagnostic[] {
  const parsed = new DOMParser().parseFromString(markup, "image/svg+xml");
  if (parsed.querySelector("parsererror")) throw new Error("rhwp returned invalid SVG.");
  const result: ClipDiagnostic[] = [];
  for (const text of parsed.querySelectorAll("text")) {
    const content = text.textContent ?? "";
    if (!/[\p{L}\p{N}]/u.test(content)) continue;
    const baseline = numberAttribute(text, "y");
    if (baseline === null) continue;
    let current: Element | null = text;
    while (current) {
      const reference = current.getAttribute("clip-path")?.match(/^url\(#(.+)\)$/u)?.[1];
      if (reference) {
        const clipPath = parsed.getElementById(reference);
        const rect = clipPath?.querySelector("rect");
        if (!rect || current.hasAttribute("transform") || clipPath?.hasAttribute("transform") || rect.hasAttribute("transform")) break;
        const clipY = numberAttribute(rect, "y") ?? 0;
        const clipHeight = numberAttribute(rect, "height");
        if (clipHeight === null) break;
        const clipBottom = clipY + clipHeight;
        if (baseline > clipBottom + 0.5) {
          result.push({
            pageIndex,
            clipId: reference,
            clipKind: reference.startsWith("cell-clip-")
              ? "cell"
              : reference.startsWith("body-clip-")
                ? "body"
                : reference.startsWith("textbox-clip-")
                  ? "textbox"
                  : "other",
            clipBottom,
            baseline,
            baselineOverflow: Number((baseline - clipBottom).toFixed(4)),
            fontSize: inheritedNumberAttribute(text, "font-size"),
            textFingerprint: createHash("sha256").update(content).digest("hex").slice(0, 16),
          });
        }
        break;
      }
      current = current.parentElement;
    }
  }
  return result;
}

function inheritedNumberAttribute(element: Element, name: string): number | null {
  let current: Element | null = element;
  while (current) {
    const value = numberAttribute(current, name);
    if (value !== null) return value;
    current = current.parentElement;
  }
  return null;
}

function numberAttribute(element: Element, name: string): number | null {
  const raw = element.getAttribute(name);
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const value = key(item);
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}
