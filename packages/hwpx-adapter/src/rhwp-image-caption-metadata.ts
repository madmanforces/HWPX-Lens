import { strFromU8, unzipSync } from "fflate";

export interface ImageCaptionMetadata {
  /** Evaluated caption identifier such as `그림 2-1`. */
  label?: string;
}

/**
 * Reads only the semantic image/caption relationship from HWPX section XML.
 * Parsing, layout and rendering remain owned by rhwp; this small index fills a
 * public API gap because `getPictureProperties()` exposes `hasCaption` but not
 * the evaluated caption number.
 */
export function extractImageCaptionMetadata(
  hwpxBytes: Uint8Array,
): Map<string, ImageCaptionMetadata> {
  const result = new Map<string, ImageCaptionMetadata>();
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(hwpxBytes, {
      filter: (file) => /^Contents\/section\d+\.xml$/i.test(file.name),
    });
  } catch {
    return result;
  }

  const sections = Object.entries(entries)
    .map(([name, bytes]) => ({
      name,
      bytes,
      sectionIndex: sectionIndexFromName(name),
    }))
    .filter((entry): entry is { name: string; bytes: Uint8Array; sectionIndex: number } =>
      entry.sectionIndex !== undefined,
    )
    .sort((left, right) => left.sectionIndex - right.sectionIndex);

  for (const section of sections) {
    let xml: Document;
    try {
      xml = new DOMParser().parseFromString(strFromU8(section.bytes), "application/xml");
    } catch {
      continue;
    }
    if (xml.getElementsByTagName("parsererror").length > 0) continue;
    const root = xml.documentElement;
    if (!root || root.localName !== "sec") continue;
    const paragraphs = elementChildren(root, "p");
    paragraphs.forEach((paragraph, paragraphIndex) => {
      collectParagraphPictures(
        paragraph,
        [section.sectionIndex, paragraphIndex],
        result,
      );
    });
  }
  return result;
}

export function imageStableIndexKey(stableIndex: readonly number[]): string {
  return stableIndex.join(":");
}

function collectParagraphPictures(
  paragraph: Element,
  pathPrefix: number[],
  result: Map<string, ImageCaptionMetadata>,
): void {
  const controls = paragraphControlElements(paragraph);
  controls.forEach((control, controlIndex) => {
    const stablePath = [...pathPrefix, controlIndex];
    if (control.localName === "pic") {
      const caption = elementChildren(control, "caption")[0];
      if (caption) {
        result.set(imageStableIndexKey(stablePath), {
          label: extractCaptionLabel(caption),
        });
      }
      return;
    }

    if (control.localName === "tbl") {
      const cells = elementChildren(control, "tr")
        .flatMap((row) => elementChildren(row, "tc"));
      cells.forEach((cell, cellIndex) => {
        const subList = elementChildren(cell, "subList")[0];
        if (!subList) return;
        elementChildren(subList, "p").forEach((cellParagraph, cellParagraphIndex) => {
          collectParagraphPictures(
            cellParagraph,
            [...stablePath, cellIndex, cellParagraphIndex],
            result,
          );
        });
      });
    }
  });
}

function paragraphControlElements(paragraph: Element): Element[] {
  const result: Element[] = [];
  for (const run of elementChildren(paragraph, "run")) {
    for (const child of elementChildren(run)) {
      if (child.localName !== "t") result.push(child);
    }
  }
  return result;
}

function extractCaptionLabel(caption: Element): string | undefined {
  const parts: string[] = [];
  appendCaptionText(caption, parts);
  const captionText = parts.join("").replace(/\s+/gu, " ").trim();
  const match = /그림\s*\d+(?:\s*-\s*\d+)*/u.exec(captionText);
  if (!match) return undefined;
  return match[0]
    .replace(/\s*-\s*/gu, "-")
    .replace(/그림\s*/u, "그림 ")
    .trim();
}

function appendCaptionText(element: Element, parts: string[]): void {
  if (element.localName === "autoNum") {
    const value = element.getAttribute("num")?.trim();
    if (value) parts.push(value);
    return;
  }
  if (element.localName === "t") {
    parts.push(element.textContent ?? "");
    return;
  }
  for (const child of elementChildren(element)) appendCaptionText(child, parts);
}

function elementChildren(parent: ParentNode, localName?: string): Element[] {
  return Array.from(parent.childNodes)
    .filter((node): node is Element => node.nodeType === 1)
    .filter((element) => localName === undefined || element.localName === localName);
}

function sectionIndexFromName(name: string): number | undefined {
  const match = /^Contents\/section(\d+)\.xml$/i.exec(name);
  if (!match) return undefined;
  const value = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
