import type { ReviewInkGeometry } from "@hwpx-lens/lens-core";

export function ReviewInkOverlay({
  pageIndex,
  items,
  activeChangeId,
  viewBox,
}: {
  pageIndex: number;
  items: readonly ReviewInkGeometry[];
  activeChangeId?: string;
  viewBox: [number, number, number, number];
}) {
  const visible = items.filter((item) => item.pageIndex === pageIndex);
  if (visible.length === 0) return null;
  return (
    <svg
      className="review-ink-overlay"
      viewBox={viewBox.join(" ")}
      preserveAspectRatio="xMidYMid meet"
      aria-label="검토 표시"
    >
      {visible.map((item) => {
        const active = item.changeId === activeChangeId;
        const className = `review-ink review-ink--${item.kind}${active ? " is-active" : ""}`;
        if (item.kind === "whitespace-missing" && item.whitespaceBoundary) {
          const marker = item.whitespaceBoundary.marker;
          const boundaryX = item.whitespaceBoundary.boundaryX;
          const path = item.whitespaceBoundary.mark === "join"
            ? [
              `M ${marker.x} ${marker.y}`,
              `V ${marker.y + marker.height}`,
              `H ${marker.x + marker.width}`,
              `V ${marker.y}`,
            ].join(" ")
            : [
              `M ${marker.x + marker.width * 0.18} ${marker.y + marker.height * 0.45}`,
              `L ${boundaryX} ${marker.y + marker.height}`,
              `L ${marker.x + marker.width} ${marker.y}`,
            ].join(" ");
          return (
            <path
              key={item.id}
              className={className}
              data-change-id={item.changeId}
              data-review-ink={item.kind}
              data-whitespace-mark={item.whitespaceBoundary.mark}
              d={path}
            />
          );
        }
        if (item.kind === "text-boundary" && item.textBoundary) {
          const boundary = item.textBoundary;
          const tick = Math.max(boundary.height * 0.18, 2.5);
          const path = [
            `M ${boundary.x} ${boundary.y}`,
            `V ${boundary.y + boundary.height}`,
            `M ${boundary.x - tick} ${boundary.y + boundary.height / 2}`,
            `H ${boundary.x + tick}`,
          ].join(" ");
          return (
            <path
              key={item.id}
              className={className}
              data-change-id={item.changeId}
              data-review-ink={item.kind}
              d={path}
            />
          );
        }
        if (item.kind === "image-region") {
          return (
            <g
              key={item.id}
              className={className}
              data-change-id={item.changeId}
              data-review-ink={item.kind}
            >
              {item.rects.map((rect, index) => (
                <rect
                  key={`${rect.x}-${rect.y}-${index}`}
                  x={rect.x}
                  y={rect.y}
                  width={Math.max(rect.width, 1)}
                  height={rect.height}
                  rx="3"
                />
              ))}
            </g>
          );
        }
        return (
          <g
            key={item.id}
            className={className}
            data-change-id={item.changeId}
            data-review-ink={item.kind}
          >
            {item.rects.map((rect, index) => (
              <rect
                key={`${rect.x}-${rect.y}-${index}`}
                x={rect.x}
                y={rect.y}
                width={Math.max(rect.width, 1)}
                height={rect.height}
                rx={Math.min(rect.height * 0.14, 2.5)}
              />
            ))}
          </g>
        );
      })}
    </svg>
  );
}
