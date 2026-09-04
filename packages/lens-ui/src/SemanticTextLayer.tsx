import { useLayoutEffect, useRef, type ClipboardEvent } from "react";
import type { SemanticTextPage } from "@hwpx-lens/lens-core";

interface SemanticTextLayerProps {
  page: SemanticTextPage;
  viewBox: [number, number, number, number];
}

/** Selectable, transparent HTML text aligned to the visual SVG page. */
export function SemanticTextLayer({ page, viewBox }: SemanticTextLayerProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const layer = layerRef.current;
    const surface = surfaceRef.current;
    if (!layer || !surface) return;

    const align = () => {
      const scaleX = layer.clientWidth / viewBox[2];
      const scaleY = layer.clientHeight / viewBox[3];
      if (!(scaleX > 0 && scaleY > 0)) return;
      surface.style.transform = `scale(${scaleX}, ${scaleY}) translate(${-viewBox[0]}px, ${-viewBox[1]}px)`;

      for (const node of surface.querySelectorAll<HTMLElement>(".semantic-text-run")) {
        node.style.setProperty("--semantic-scale-x", "1");
        const naturalWidth = node.getBoundingClientRect().width / scaleX;
        const targetWidth = Number(node.dataset.runWidth);
        const runScale = naturalWidth > 0 && targetWidth >= 0 ? targetWidth / naturalWidth : 1;
        node.style.setProperty("--semantic-scale-x", String(runScale));
      }
    };
    align();
    const observer = new ResizeObserver(align);
    observer.observe(layer);
    return () => observer.disconnect();
  }, [page, viewBox]);

  return (
    <div
      ref={layerRef}
      className="semantic-text-layer"
      role="document"
      aria-label="의미 텍스트 상호작용 계층"
      data-page-index={page.pageIndex}
      data-semantic-run-count={page.runs.length}
    >
      <div
        ref={surfaceRef}
        className="semantic-text-surface"
        style={{ width: viewBox[2], height: viewBox[3] }}
        onCopy={copySemanticSelection}
      >
        {page.runs.map((run) => (
          <span
            key={run.id}
            className="semantic-text-run"
            data-run-id={run.id}
            data-block-id={run.blockId}
            data-reading-order={run.readingOrder}
            data-run-width={run.rect.width}
            data-section-index={run.anchor?.sectionIndex}
            data-paragraph-index={run.anchor?.paragraphIndex}
            data-range-start={run.anchor?.textRange?.start}
            data-range-end={run.anchor?.textRange?.end}
            style={{
              left: run.rect.x,
              top: run.rect.y,
              height: run.rect.height,
              fontFamily: `"${escapeCssFont(run.style.fontFamily)}", sans-serif`,
              fontSize: run.style.fontSize,
              fontWeight: run.style.bold ? 700 : 400,
              fontStyle: run.style.italic ? "italic" : "normal",
              letterSpacing: run.style.letterSpacing,
              lineHeight: `${run.rect.height}px`,
            }}
          >
            {run.text}
          </span>
        ))}
      </div>
    </div>
  );
}

function copySemanticSelection(event: ClipboardEvent<HTMLDivElement>): void {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  const surface = event.currentTarget;
  if (!surface.contains(range.commonAncestorContainer)) return;

  const plainText = semanticPlainTextForRange(surface, range);
  if (!plainText) return;
  event.preventDefault();
  event.clipboardData.setData("text/plain", plainText);
}

export function semanticPlainTextForRange(surface: HTMLElement, range: Range): string {
  const selected: Array<{ blockId: string; text: string }> = [];
  for (const run of surface.querySelectorAll<HTMLElement>(".semantic-text-run")) {
    if (!rangeIntersectsNode(range, run)) continue;
    const textNode = run.firstChild;
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) continue;
    const source = textNode.textContent ?? "";
    let start = 0;
    let end = source.length;
    if (range.startContainer === textNode) start = clamp(range.startOffset, 0, source.length);
    if (range.endContainer === textNode) end = clamp(range.endOffset, start, source.length);
    const text = source.slice(start, end);
    if (text) selected.push({ blockId: run.dataset.blockId ?? run.dataset.runId ?? "", text });
  }

  if (selected.length === 0) return "";
  let plainText = "";
  let previousBlock: string | undefined;
  for (const item of selected) {
    if (previousBlock !== undefined && item.blockId !== previousBlock) plainText += "\r\n";
    plainText += item.text;
    previousBlock = item.blockId;
  }
  return plainText;
}

function rangeIntersectsNode(range: Range, node: Node): boolean {
  try {
    return range.intersectsNode(node);
  } catch {
    return false;
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function escapeCssFont(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}
