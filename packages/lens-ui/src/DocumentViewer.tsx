import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { EphemeralLruCache } from "@hwpx-lens/lens-core";
import type {
  Canvas2DRenderedPage,
  InteractionAdapter,
  NativeInteractionAdapter,
  NativeSelection,
  RenderedPage,
  RenderingAdapter,
  ReviewInkGeometry,
  SemanticTextPage,
  PageSize,
  VisualTarget,
} from "@hwpx-lens/lens-core";
import { SemanticTextLayer } from "./SemanticTextLayer";
import { ReviewInkOverlay } from "./ReviewInkOverlay";

interface DocumentViewerProps {
  label: string;
  fileName?: string;
  rendering?: RenderingAdapter;
  interaction?: InteractionAdapter;
  target?: VisualTarget;
  navigationMode?: "target" | "page";
  navigationKey?: number;
  contextual?: boolean;
  reviewInk?: readonly ReviewInkGeometry[];
  activeChangeId?: string;
  suppressLegacyHighlight?: boolean;
  status: "empty" | "loading" | "ready" | "error";
  error?: string;
  renderCachePages?: number;
}

interface NativeSelectionState {
  selection: NativeSelection;
  rects: VisualTarget["rects"];
}

interface PageCacheEntry {
  page: RenderedPage;
  textPage?: SemanticTextPage;
  loadDurationMs: number;
}

interface RenderCacheStats {
  requests: number;
  evictions: number;
  paints: number;
  lastPaintMs: number;
}

export function DocumentViewer({
  label,
  fileName,
  rendering,
  interaction,
  target,
  navigationMode = "target",
  navigationKey = 0,
  contextual = false,
  reviewInk = [],
  activeChangeId,
  suppressLegacyHighlight = false,
  status,
  error,
  renderCachePages = 5,
}: DocumentViewerProps) {
  const [fitPage, setFitPage] = useState(true);
  useEffect(() => {
    if (navigationMode === "page") setFitPage(true);
  }, [navigationKey, navigationMode, target]);
  return (
    <section className="document-viewer" aria-label={`${label} 문서`}>
      <header className="viewer-header">
        <div className="viewer-header__file">
          <span className="viewer-header__label">{label}</span>
          <strong title={fileName}>{fileName ?? "문서 없음"}</strong>
        </div>
        <div className="viewer-header__actions">
          {status === "ready" && (
            <button
              type="button"
              className="fit-page-toggle"
              aria-pressed={fitPage}
              title={fitPage ? "한 페이지를 화면 안에 맞춥니다." : "문서 폭을 넓게 표시합니다."}
              onClick={() => setFitPage((current) => !current)}
            >
              {fitPage ? "페이지 맞춤" : "폭 맞춤"}
            </button>
          )}
          <span className={`status-dot status-dot--${status}`}>
            {status === "ready" ? `${rendering?.pageCount() ?? 0}쪽` : statusLabel(status)}
          </span>
        </div>
      </header>
      {status === "ready" && rendering ? (
        <PageViewport
          rendering={rendering}
          interaction={interaction}
          target={target}
          navigationMode={navigationMode}
          navigationKey={navigationKey}
          contextual={contextual}
          reviewInk={reviewInk}
          activeChangeId={activeChangeId}
          suppressLegacyHighlight={suppressLegacyHighlight}
          maxCachedPages={renderCachePages}
          fitPage={fitPage}
        />
      ) : (
        <div className={`viewer-state viewer-state--${status}`}>
          <div className="viewer-state__icon">{status === "error" ? "!" : "◫"}</div>
          <strong>{status === "loading" ? "문서 여는 중" : status === "error" ? "열지 못했습니다" : "대기 중"}</strong>
          <span>{error ?? (status === "loading" ? "로컬 WASM에서 문서를 분석합니다." : "위에서 HWPX 파일을 선택하세요.")}</span>
        </div>
      )}
    </section>
  );
}

function PageViewport({
  rendering,
  interaction,
  target,
  navigationMode,
  navigationKey,
  contextual,
  reviewInk,
  activeChangeId,
  suppressLegacyHighlight,
  maxCachedPages,
  fitPage,
}: {
  rendering: RenderingAdapter;
  interaction?: InteractionAdapter;
  target?: VisualTarget;
  navigationMode: "target" | "page";
  navigationKey: number;
  contextual: boolean;
  reviewInk: readonly ReviewInkGeometry[];
  activeChangeId?: string;
  suppressLegacyHighlight: boolean;
  maxCachedPages: number;
  fitPage: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef(new Map<number, HTMLElement>());
  const pageCache = useRef(new EphemeralLruCache<PageCacheEntry>(maxCachedPages));
  const generation = useRef(0);
  const [cacheRevision, setCacheRevision] = useState(0);
  const [pageSizes, setPageSizes] = useState<PageSize[]>([]);
  const [cacheStats, setCacheStats] = useState<RenderCacheStats>({
    requests: 0,
    evictions: 0,
    paints: 0,
    lastPaintMs: 0,
  });
  const [errors, setErrors] = useState<Map<number, string>>(() => new Map());
  const [nativeSelection, setNativeSelection] = useState<NativeSelectionState>();
  const [viewportHeight, setViewportHeight] = useState(0);
  const pending = useRef(new Set<number>());
  const pageCount = rendering.pageCount();

  useLayoutEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const update = () => setViewportHeight(root.clientHeight);
    update();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update);
    observer?.observe(root);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  const loadPage = useCallback(
    async (pageIndex: number) => {
      if (pageIndex < 0 || pageIndex >= pageCount) return;
      const key = String(pageIndex);
      if (pageCache.current.get(key) || pending.current.has(pageIndex)) return;
      const loadGeneration = generation.current;
      pending.current.add(pageIndex);
      const startedAt = performance.now();
      setCacheStats((current) => ({ ...current, requests: current.requests + 1 }));
      try {
        const semanticInteraction = interaction?.kind === "semantic-text" ? interaction : undefined;
        const [page, textPage] = await Promise.all([
          rendering.renderPage(pageIndex),
          semanticInteraction?.getTextPage(pageIndex).catch(() => undefined),
        ]);
        if (loadGeneration !== generation.current) return;
        const evicted = pageCache.current.set(key, {
          page,
          textPage,
          loadDurationMs: Number((performance.now() - startedAt).toFixed(3)),
        });
        setCacheRevision((current) => current + 1);
        if (evicted !== undefined) {
          setCacheStats((current) => ({ ...current, evictions: current.evictions + 1 }));
        }
      } catch (caught) {
        if (loadGeneration !== generation.current) return;
        const message = caught instanceof Error ? caught.message : "페이지를 렌더링하지 못했습니다.";
        setErrors((current) => new Map(current).set(pageIndex, message));
      } finally {
        pending.current.delete(pageIndex);
      }
    },
    [interaction, pageCount, rendering],
  );

  const loadWindow = useCallback(
    async (centerPageIndex: number) => {
      await Promise.all([
        loadPage(centerPageIndex),
        loadPage(centerPageIndex - 1),
        loadPage(centerPageIndex + 1),
      ]);
    },
    [loadPage],
  );

  useEffect(() => {
    generation.current += 1;
    pageCache.current = new EphemeralLruCache<PageCacheEntry>(maxCachedPages);
    setCacheRevision((current) => current + 1);
    setCacheStats({ requests: 0, evictions: 0, paints: 0, lastPaintMs: 0 });
    setPageSizes([]);
    setErrors(new Map());
    setNativeSelection(undefined);
    pending.current.clear();
    void rendering.pageSizes().then((sizes) => {
      if (sizes.length === pageCount) setPageSizes(sizes);
    }).catch(() => undefined);
    void loadWindow(0);
  }, [loadWindow, maxCachedPages, pageCount, rendering]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const element = entry.target as HTMLElement;
            const index = Number(element.dataset.pageIndex);
            if (Number.isInteger(index)) void loadWindow(index);
          }
        }
      },
      { root, rootMargin: "600px 0px" },
    );
    pageRefs.current.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [loadWindow, pageCount]);

  useEffect(() => {
    if (!target) return;
    let active = true;
    let firstFrame = 0;
    let secondFrame = 0;
    void loadWindow(target.pageIndex).then(() => {
      if (!active) return;
      firstFrame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(() => {
          if (!active) return;
          const root = containerRef.current;
          const card = pageRefs.current.get(target.pageIndex);
          if (!root || !card) return;
          const rendered = pageCache.current.peek(String(target.pageIndex))?.page;
          const size = pageSizes[target.pageIndex];
          const viewBox: [number, number, number, number] = rendered?.viewBox ?? [
            0,
            0,
            size?.width ?? 793.7,
            size?.height ?? 1122.5,
          ];
          if (navigationMode === "page") scrollPageIntoView(root, card);
          else scrollVisualTargetIntoView(root, card, target, viewBox);
        });
      });
    });
    return () => {
      active = false;
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [fitPage, loadWindow, navigationKey, navigationMode, pageSizes, target]);

  const recordPaint = useCallback((durationMs: number) => {
    setCacheStats((current) => ({
      ...current,
      paints: current.paints + 1,
      lastPaintMs: Number(durationMs.toFixed(3)),
    }));
  }, []);

  return (
    <div
      className="page-viewport"
      ref={containerRef}
      data-renderer={rendering.rendererKind}
      data-page-count={pageCount}
      data-render-cache-limit={maxCachedPages}
      data-render-cache-size={pageCache.current.size}
      data-render-cache-revision={cacheRevision}
      data-render-requests={cacheStats.requests}
      data-render-evictions={cacheStats.evictions}
      data-render-paints={cacheStats.paints}
      data-last-paint-ms={cacheStats.lastPaintMs}
      data-fit-mode={fitPage ? "page" : "width"}
    >
      {Array.from({ length: pageCount }, (_, pageIndex) => {
        const cached = pageCache.current.peek(String(pageIndex));
        return (
          <PageCard
            key={pageIndex}
            pageIndex={pageIndex}
            page={cached?.page}
            textPage={cached?.textPage}
            pageSize={pageSizes[pageIndex]}
            loadDurationMs={cached?.loadDurationMs}
            error={errors.get(pageIndex)}
            target={target?.pageIndex === pageIndex ? target : undefined}
            contextual={contextual}
            reviewInk={reviewInk}
            activeChangeId={activeChangeId}
            suppressLegacyHighlight={suppressLegacyHighlight}
            nativeInteraction={interaction?.kind === "native" ? interaction : undefined}
            nativeSelection={nativeSelection}
            onNativeSelectionChange={setNativeSelection}
            onCanvasPaint={recordPaint}
            pageRefs={pageRefs}
            fitPage={fitPage}
            viewportHeight={viewportHeight}
          />
        );
      })}
    </div>
  );
}

function PageCard({
  pageIndex,
  page,
  textPage,
  pageSize,
  loadDurationMs,
  error,
  target,
  contextual,
  reviewInk,
  activeChangeId,
  suppressLegacyHighlight,
  nativeInteraction,
  nativeSelection,
  onNativeSelectionChange,
  onCanvasPaint,
  pageRefs,
  fitPage,
  viewportHeight,
}: {
  pageIndex: number;
  page?: RenderedPage;
  textPage?: SemanticTextPage;
  pageSize?: PageSize;
  loadDurationMs?: number;
  error?: string;
  target?: VisualTarget;
  contextual: boolean;
  reviewInk: readonly ReviewInkGeometry[];
  activeChangeId?: string;
  suppressLegacyHighlight: boolean;
  nativeInteraction?: NativeInteractionAdapter;
  nativeSelection?: NativeSelectionState;
  onNativeSelectionChange: (selection: NativeSelectionState | undefined) => void;
  onCanvasPaint: (durationMs: number) => void;
  pageRefs: RefObject<Map<number, HTMLElement>>;
  fitPage: boolean;
  viewportHeight: number;
}) {
  const viewBox: [number, number, number, number] = page?.viewBox ?? [
    0,
    0,
    pageSize?.width ?? 793.7,
    pageSize?.height ?? 1122.5,
  ];
  const hasActiveReviewInk = activeChangeId !== undefined && reviewInk.some(
    (item) => item.changeId === activeChangeId && item.pageIndex === pageIndex,
  );
  const fitPageMaxWidth = fitPage && viewportHeight > 0
    ? Math.max(220, (viewportHeight - 86) * (viewBox[2] / viewBox[3]))
    : undefined;
  return (
    <article
      className="page-card"
      data-page-index={pageIndex}
      data-page-state={page ? "rendered" : "placeholder"}
      data-page-load-ms={loadDurationMs}
      ref={(element) => {
        if (element) pageRefs.current?.set(pageIndex, element);
        else pageRefs.current?.delete(pageIndex);
      }}
      style={{
        aspectRatio: `${viewBox[2]} / ${viewBox[3]}`,
        maxWidth: fitPageMaxWidth === undefined ? undefined : `${fitPageMaxWidth}px`,
      }}
    >
      <span className="page-number">{pageIndex + 1}</span>
      {error ? (
        <div className="page-error">{error}</div>
      ) : page ? (
        <>
          {page.kind === "svg" ? (
            <div
              className={`rendered-svg${textPage ? " rendered-svg--interaction-poc" : ""}`}
              dangerouslySetInnerHTML={{ __html: page.svg }}
            />
          ) : (
            <CanvasPageSurface page={page} onPaint={onCanvasPaint} />
          )}
          {textPage && <SemanticTextLayer page={textPage} viewBox={viewBox} />}
          <ReviewInkOverlay
            pageIndex={pageIndex}
            items={reviewInk}
            activeChangeId={activeChangeId}
            viewBox={viewBox}
          />
          {nativeSelection && (
            <SelectionOverlay
              pageIndex={pageIndex}
              rects={nativeSelection.rects}
              viewBox={viewBox}
            />
          )}
          {target && !hasActiveReviewInk && !(suppressLegacyHighlight && !contextual) && (
            <svg
              className={`highlight-overlay${contextual ? " is-contextual" : ""}`}
              viewBox={viewBox.join(" ")}
              preserveAspectRatio="xMidYMid meet"
              aria-label={contextual ? "인접 문맥 위치" : "선택한 변경 위치"}
            >
              {target.rects.map((rect, index) => (
                <rect
                  key={`${rect.x}-${rect.y}-${index}`}
                  x={rect.x}
                  y={rect.y}
                  width={Math.max(rect.width, 2)}
                  height={rect.height}
                  rx="2"
                />
              ))}
            </svg>
          )}
          {nativeInteraction && (
            <NativeInteractionSurface
              adapter={nativeInteraction}
              pageIndex={pageIndex}
              viewBox={viewBox}
              selection={nativeSelection}
              onSelectionChange={onNativeSelectionChange}
            />
          )}
        </>
      ) : (
        <div className="page-skeleton"><span /></div>
      )}
    </article>
  );
}

export function scrollVisualTargetIntoView(
  root: HTMLElement,
  card: HTMLElement,
  target: VisualTarget,
  viewBox: [number, number, number, number],
) {
  const pageRects = target.rects.filter((rect) => rect.pageIndex === target.pageIndex);
  if (pageRects.length === 0 || !(card.clientHeight > 0)) {
    card.scrollIntoView({ behavior: "auto", block: "center" });
    return;
  }
  const top = Math.min(...pageRects.map((rect) => rect.y));
  const bottom = Math.max(...pageRects.map((rect) => rect.y + rect.height));
  const targetCenterY = (top + bottom) / 2;
  const rootBounds = root.getBoundingClientRect();
  const cardBounds = card.getBoundingClientRect();
  const cardTop = root.scrollTop + cardBounds.top - rootBounds.top;
  const pageRatio = (targetCenterY - viewBox[1]) / viewBox[3];
  const desiredTop = cardTop + pageRatio * card.clientHeight - root.clientHeight / 2;
  root.scrollTo({ top: Math.max(0, desiredTop), behavior: "auto" });
}

/** Aligns one fitted page cleanly at the top for table-of-contents navigation. */
export function scrollPageIntoView(root: HTMLElement, card: HTMLElement) {
  const rootBounds = root.getBoundingClientRect();
  const cardBounds = card.getBoundingClientRect();
  const cardTop = root.scrollTop + cardBounds.top - rootBounds.top;
  root.scrollTo({ top: Math.max(0, cardTop - 10), behavior: "auto" });
}

function CanvasPageSurface({
  page,
  onPaint,
}: {
  page: Canvas2DRenderedPage;
  onPaint(durationMs: number): void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [paintError, setPaintError] = useState<string>();

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let frame = 0;
    const paint = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const width = canvas.getBoundingClientRect().width;
        if (!(width > 0)) return;
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        const pageScale = width / page.viewBox[2];
        try {
          const startedAt = performance.now();
          page.paint(canvas, pageScale * pixelRatio);
          onPaint(performance.now() - startedAt);
          setPaintError(undefined);
        } catch (caught) {
          setPaintError(caught instanceof Error ? caught.message : "Canvas 페이지를 그리지 못했습니다.");
        }
      });
    };
    paint();
    const observer = typeof ResizeObserver === "undefined"
      ? undefined
      : new ResizeObserver(paint);
    observer?.observe(canvas);
    window.addEventListener("resize", paint);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", paint);
    };
  }, [onPaint, page]);

  return (
    <div className="rendered-canvas" data-renderer="canvas2d">
      <canvas ref={canvasRef} aria-label={`Canvas2D ${page.pageIndex + 1}쪽`} />
      {paintError && <div className="page-error">{paintError}</div>}
    </div>
  );
}

function SelectionOverlay({
  pageIndex,
  rects,
  viewBox,
}: {
  pageIndex: number;
  rects: VisualTarget["rects"];
  viewBox: [number, number, number, number];
}) {
  const pageRects = rects.filter((rect) => rect.pageIndex === pageIndex);
  if (pageRects.length === 0) return null;
  return (
    <svg
      className="native-selection-overlay"
      viewBox={viewBox.join(" ")}
      preserveAspectRatio="xMidYMid meet"
      aria-label="문서 텍스트 선택 영역"
    >
      {pageRects.map((rect, index) => (
        <rect
          key={`${rect.x}-${rect.y}-${index}`}
          x={rect.x}
          y={rect.y}
          width={Math.max(rect.width, 1)}
          height={rect.height}
        />
      ))}
    </svg>
  );
}

function NativeInteractionSurface({
  adapter,
  pageIndex,
  viewBox,
  selection,
  onSelectionChange,
}: {
  adapter: NativeInteractionAdapter;
  pageIndex: number;
  viewBox: [number, number, number, number];
  selection?: NativeSelectionState;
  onSelectionChange: (selection: NativeSelectionState | undefined) => void;
}) {
  const dragAnchor = useRef<NativeSelection["anchor"] | undefined>(undefined);
  const pendingPoint = useRef<{ x: number; y: number } | undefined>(undefined);
  const animationFrame = useRef<number | undefined>(undefined);

  useEffect(() => () => {
    if (animationFrame.current !== undefined) cancelAnimationFrame(animationFrame.current);
  }, []);

  function documentPoint(event: ReactPointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: viewBox[0] + ((event.clientX - bounds.left) / bounds.width) * viewBox[2],
      y: viewBox[1] + ((event.clientY - bounds.top) / bounds.height) * viewBox[3],
    };
  }

  function positionAt(point: { x: number; y: number }) {
    return adapter.hitTest(pageIndex, point.x, point.y);
  }

  function updateSelection(anchor: NativeSelection["anchor"], focus: NativeSelection["focus"]) {
    const next = { anchor, focus };
    try {
      onSelectionChange({ selection: next, rects: adapter.getSelectionRects(next) });
    } catch {
      onSelectionChange({ selection: next, rects: [] });
    }
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    try {
      const anchor = positionAt(documentPoint(event));
      dragAnchor.current = anchor;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      onSelectionChange({ selection: { anchor, focus: anchor }, rects: [] });
    } catch {
      dragAnchor.current = undefined;
      onSelectionChange(undefined);
    }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const anchor = dragAnchor.current;
    if (!anchor) return;
    pendingPoint.current = documentPoint(event);
    if (animationFrame.current !== undefined) return;
    animationFrame.current = requestAnimationFrame(() => {
      animationFrame.current = undefined;
      const point = pendingPoint.current;
      pendingPoint.current = undefined;
      if (!point || !dragAnchor.current) return;
      try {
        updateSelection(dragAnchor.current, positionAt(point));
      } catch {
        // Keep the last valid selection when the pointer leaves document content.
      }
    });
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const anchor = dragAnchor.current;
    if (!anchor) return;
    event.currentTarget.focus();
    if (animationFrame.current !== undefined) {
      cancelAnimationFrame(animationFrame.current);
      animationFrame.current = undefined;
    }
    pendingPoint.current = undefined;
    try {
      updateSelection(anchor, positionAt(documentPoint(event)));
    } catch {
      // Preserve the last valid range.
    }
    dragAnchor.current = undefined;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function onCopy(event: ReactClipboardEvent<HTMLDivElement>) {
    if (!selection || selection.rects.length === 0) return;
    try {
      const payload = adapter.copySelection(selection.selection);
      event.preventDefault();
      event.clipboardData.setData("text/plain", payload.plainText);
      if (payload.html) event.clipboardData.setData("text/html", payload.html);
    } catch {
      // Leave the browser clipboard untouched when the engine rejects a range.
    }
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      onSelectionChange(undefined);
      return;
    }
    if (
      event.key.toLowerCase() === "c" &&
      (event.ctrlKey || event.metaKey) &&
      selection &&
      selection.rects.length > 0
    ) {
      event.preventDefault();
      try {
        const payload = adapter.copySelection(selection.selection);
        void writePlainTextToSystemClipboard(payload.plainText, event.currentTarget);
      } catch {
        // Preserve the existing clipboard when the engine rejects a range.
      }
    }
  }

  return (
    <div
      className="native-interaction-surface"
      data-page-index={pageIndex}
      aria-label={`${pageIndex + 1}쪽 텍스트 선택`}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        dragAnchor.current = undefined;
        pendingPoint.current = undefined;
        if (animationFrame.current !== undefined) cancelAnimationFrame(animationFrame.current);
        animationFrame.current = undefined;
      }}
      onCopy={onCopy}
      onKeyDown={onKeyDown}
    />
  );
}

async function writePlainTextToSystemClipboard(text: string, focusTarget: HTMLElement) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // WebView clipboard permission can differ from the browser test runtime.
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.readOnly = true;
  textarea.setAttribute("aria-hidden", "true");
  Object.assign(textarea.style, {
    position: "fixed",
    inset: "-9999px auto auto -9999px",
    opacity: "0",
    pointerEvents: "none",
  });
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    document.execCommand("copy");
  } finally {
    textarea.remove();
    focusTarget.focus();
  }
}

function statusLabel(status: DocumentViewerProps["status"]): string {
  return { empty: "대기", loading: "여는 중", ready: "준비", error: "오류" }[status];
}
