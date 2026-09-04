const FORBIDDEN_ELEMENTS = [
  "script",
  "foreignObject",
  "iframe",
  "object",
  "embed",
  "audio",
  "video",
  "style",
  "animate",
  "animateMotion",
  "animateTransform",
  "set",
];

const REMOTE_OR_EXECUTABLE = /(?:javascript:|vbscript:|file:|https?:|^\/\/)/i;
const XML_DECLARATION_RISK = /<!\s*(?:doctype|entity)\b/i;
const SAFE_RASTER_IMAGE = /^data:image\/(?:png|jpeg|gif|webp|bmp);base64,/i;

interface SvgSafetyLimits {
  maxEmbeddedSvgBytes: number;
  maxTotalEmbeddedSvgBytes: number;
  maxEmbeddedSvgElements: number;
  maxEmbeddedSvgDepth: number;
}

const DEFAULT_LIMITS: SvgSafetyLimits = {
  // Complex documents can contain large WMF/EMF pictures that rhwp exposes as SVG.
  maxEmbeddedSvgBytes: 32 * 1024 * 1024,
  maxTotalEmbeddedSvgBytes: 96 * 1024 * 1024,
  maxEmbeddedSvgElements: 250_000,
  maxEmbeddedSvgDepth: 2,
};

interface SvgSafetyContext {
  depth: number;
  limits: SvgSafetyLimits;
  budget: {
    embeddedBytes: number;
    embeddedElements: number;
  };
  cache: Map<string, string | undefined>;
}

export interface SafeSvg {
  markup: string;
  viewBox: [number, number, number, number];
}

export function sanitizeRenderedSvg(
  markup: string,
  limits: SvgSafetyLimits = DEFAULT_LIMITS,
  idNamespace?: string,
): SafeSvg {
  const context: SvgSafetyContext = {
    depth: 0,
    limits,
    budget: { embeddedBytes: 0, embeddedElements: 0 },
    cache: new Map(),
  };
  const root = sanitizeSvgMarkup(markup, context);
  if (idNamespace !== undefined) namespaceSvgIds(root, idNamespace);
  const viewBox = parseViewBox(root);
  root.setAttribute("aria-hidden", "true");
  root.setAttribute("focusable", "false");
  root.setAttribute("preserveAspectRatio", "xMidYMid meet");

  return {
    markup: new XMLSerializer().serializeToString(root),
    viewBox,
  };
}

/**
 * SVG fragment identifiers resolve against the containing HTML document, not
 * only against their nearest SVG root. rhwp intentionally reuses ids such as
 * `body-clip-6` on every page, so side-by-side/virtualized pages must be scoped
 * before they are mounted together.
 */
function namespaceSvgIds(root: Element, namespace: string): void {
  if (!/^[a-zA-Z_][a-zA-Z0-9_.-]*$/u.test(namespace)) {
    throw new Error("SVG 식별자 namespace가 올바르지 않습니다.");
  }

  const identifiers = new Map<string, string>();
  for (const element of [root, ...Array.from(root.querySelectorAll("[id]"))]) {
    const id = element.getAttribute("id");
    if (!id) continue;
    const scoped = `${namespace}-${id}`;
    identifiers.set(id, scoped);
    element.setAttribute("id", scoped);
  }
  if (identifiers.size === 0) return;

  for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
    for (const attribute of Array.from(element.attributes)) {
      const current = attribute.value;
      let next = current.replace(
        /url\(\s*(['"]?)#([^)'"\s]+)\1\s*\)/gu,
        (reference, _quote: string, id: string) => {
          const scoped = identifiers.get(id);
          return scoped ? `url(#${scoped})` : reference;
        },
      );
      if ((attribute.localName === "href" || attribute.name.toLowerCase().endsWith(":href")) && next.startsWith("#")) {
        next = `#${identifiers.get(next.slice(1)) ?? next.slice(1)}`;
      }
      if (attribute.localName === "aria-labelledby" || attribute.localName === "aria-describedby") {
        next = next.split(/\s+/u).map((id) => identifiers.get(id) ?? id).join(" ");
      }
      if (next !== current) element.setAttribute(attribute.name, next);
    }
  }
}

function sanitizeSvgMarkup(markup: string, context: SvgSafetyContext): Element {
  if (XML_DECLARATION_RISK.test(markup)) {
    throw new Error("렌더링된 SVG에 허용되지 않는 XML 선언이 포함되어 있습니다.");
  }
  const parser = new DOMParser();
  const parsed = parser.parseFromString(markup, "image/svg+xml");
  if (parsed.querySelector("parsererror") || parsed.documentElement.localName !== "svg") {
    throw new Error("렌더링 엔진이 유효한 SVG를 반환하지 않았습니다.");
  }

  if (context.depth > 0) {
    context.budget.embeddedElements += parsed.querySelectorAll("*").length;
    if (context.budget.embeddedElements > context.limits.maxEmbeddedSvgElements) {
      throw new Error("내장 SVG의 요소 수가 안전 제한을 초과했습니다.");
    }
  }

  for (const selector of FORBIDDEN_ELEMENTS) {
    parsed.querySelectorAll(selector).forEach((element) => element.remove());
  }

  parsed.querySelectorAll("*").forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith("on")) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (name === "href" || name.endsWith(":href")) {
        const safeReference = sanitizeReference(element, value, context);
        if (safeReference === undefined) {
          element.removeAttribute(attribute.name);
          if (element.localName.toLowerCase() === "image") {
            element.setAttribute("data-hwpx-lens-image-status", "blocked");
          }
        } else if (safeReference !== value) {
          element.setAttribute(attribute.name, safeReference);
        }
        continue;
      }
      if (REMOTE_OR_EXECUTABLE.test(withoutUrlWhitespace(value))) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (hasUnsafeUrl(value)) {
        element.removeAttribute(attribute.name);
      }
    }
  });

  return parsed.documentElement;
}

function sanitizeReference(
  element: Element,
  value: string,
  context: SvgSafetyContext,
): string | undefined {
  if (value === "" || value.startsWith("#")) {
    return value;
  }
  if (element.localName.toLowerCase() !== "image") {
    return undefined;
  }
  if (SAFE_RASTER_IMAGE.test(value)) return value;
  if (!isEmbeddedSvgReference(value)) return undefined;
  return sanitizeEmbeddedSvgReference(value, context);
}

function isEmbeddedSvgReference(value: string): boolean {
  const comma = value.indexOf(",");
  if (comma < 0 || !value.slice(0, comma).toLowerCase().startsWith("data:image/svg+xml")) {
    return false;
  }
  return true;
}

function sanitizeEmbeddedSvgReference(
  reference: string,
  context: SvgSafetyContext,
): string | undefined {
  if (context.cache.has(reference)) {
    return context.cache.get(reference);
  }

  let safeReference: string | undefined;
  try {
    const nextDepth = context.depth + 1;
    if (nextDepth > context.limits.maxEmbeddedSvgDepth) {
      throw new Error("내장 SVG 중첩 깊이가 안전 제한을 초과했습니다.");
    }
    const decoded = decodeEmbeddedSvg(reference, context.limits.maxEmbeddedSvgBytes);
    context.budget.embeddedBytes += decoded.byteLength;
    if (context.budget.embeddedBytes > context.limits.maxTotalEmbeddedSvgBytes) {
      throw new Error("페이지의 내장 SVG 총량이 안전 제한을 초과했습니다.");
    }
    const root = sanitizeSvgMarkup(decoded.markup, { ...context, depth: nextDepth });
    safeReference = encodeEmbeddedSvg(new XMLSerializer().serializeToString(root));
  } catch {
    safeReference = undefined;
  }

  context.cache.set(reference, safeReference);
  return safeReference;
}

function decodeEmbeddedSvg(
  reference: string,
  maxBytes: number,
): { markup: string; byteLength: number } {
  const comma = reference.indexOf(",");
  if (comma < 0) {
    throw new Error("내장 SVG 데이터 URL이 올바르지 않습니다.");
  }

  const metadata = reference.slice(5, comma).split(";");
  if (metadata.shift()?.toLowerCase() !== "image/svg+xml") {
    throw new Error("내장 이미지가 SVG 형식이 아닙니다.");
  }
  let base64 = false;
  for (const parameter of metadata) {
    const normalized = parameter.trim().toLowerCase();
    if (normalized === "base64") {
      base64 = true;
    } else if (
      normalized !== "charset=utf-8" &&
      normalized !== "charset=utf8" &&
      normalized !== "charset=us-ascii"
    ) {
      throw new Error("내장 SVG 데이터 URL에 지원하지 않는 매개변수가 있습니다.");
    }
  }

  const payload = reference.slice(comma + 1);
  if (base64) {
    const compact = payload.replace(/\s+/g, "");
    if (!/^[a-z\d+/]*={0,2}$/i.test(compact) || compact.length % 4 === 1) {
      throw new Error("내장 SVG의 Base64 데이터가 올바르지 않습니다.");
    }
    const estimatedBytes = Math.floor((compact.length * 3) / 4);
    if (estimatedBytes > maxBytes) {
      throw new Error("내장 SVG가 안전 크기 제한을 초과했습니다.");
    }
    const binary = atob(compact);
    if (binary.length > maxBytes) {
      throw new Error("내장 SVG가 안전 크기 제한을 초과했습니다.");
    }
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return {
      markup: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      byteLength: bytes.byteLength,
    };
  }

  const markup = decodeURIComponent(payload);
  const byteLength = new TextEncoder().encode(markup).byteLength;
  if (byteLength > maxBytes) {
    throw new Error("내장 SVG가 안전 크기 제한을 초과했습니다.");
  }
  return { markup, byteLength };
}

function encodeEmbeddedSvg(markup: string): string {
  const bytes = new TextEncoder().encode(markup);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

function hasUnsafeUrl(value: string): boolean {
  const references = value.match(/url\(([^)]+)\)/gi) ?? [];
  return references.some((reference) => {
    const target = reference.slice(4, -1).trim().replace(/^['"]|['"]$/g, "");
    return target !== "" && !target.startsWith("#");
  });
}

function withoutUrlWhitespace(value: string): string {
  return value.replace(/[\u0000-\u0020\u007f-\u009f]/g, "");
}

function parseViewBox(root: Element): [number, number, number, number] {
  const values = root
    .getAttribute("viewBox")
    ?.trim()
    .split(/[ ,]+/)
    .map(Number);
  if (values?.length === 4 && values.every(Number.isFinite) && values[2] > 0 && values[3] > 0) {
    return values as [number, number, number, number];
  }

  const width = Number.parseFloat(root.getAttribute("width") ?? "0");
  const height = Number.parseFloat(root.getAttribute("height") ?? "0");
  if (width > 0 && height > 0) {
    return [0, 0, width, height];
  }
  throw new Error("렌더링된 페이지의 크기를 확인할 수 없습니다.");
}
