import { describe, expect, it, vi } from "vitest";
import type { VisualTarget } from "@hwpx-lens/lens-core";
import { scrollPageIntoView, scrollVisualTargetIntoView } from "./DocumentViewer";

describe("change target navigation", () => {
  it("centres the actual changed range instead of only centring its page", () => {
    const scrollTo = vi.fn();
    const root = {
      clientHeight: 400,
      scrollTop: 100,
      getBoundingClientRect: () => ({ top: 50 }),
      scrollTo,
    } as unknown as HTMLElement;
    const card = {
      clientHeight: 1_000,
      getBoundingClientRect: () => ({ top: 250 }),
      scrollIntoView: vi.fn(),
    } as unknown as HTMLElement;
    const target: VisualTarget = {
      pageIndex: 7,
      rects: [{ pageIndex: 7, x: 30, y: 800, width: 80, height: 20 }],
    };

    scrollVisualTargetIntoView(root, card, target, [0, 0, 800, 1_120]);

    expect(scrollTo).toHaveBeenCalledOnce();
    const options = scrollTo.mock.calls[0][0] as ScrollToOptions;
    expect(options.top).toBeCloseTo(823.214, 2);
    expect(options.behavior).toBe("auto");
  });
});

describe("table-of-contents navigation", () => {
  it("aligns the fitted page at the viewport top instead of centring a paragraph", () => {
    const scrollTo = vi.fn();
    const root = {
      scrollTop: 600,
      getBoundingClientRect: () => ({ top: 80 }),
      scrollTo,
    } as unknown as HTMLElement;
    const card = {
      getBoundingClientRect: () => ({ top: 230 }),
    } as unknown as HTMLElement;

    scrollPageIntoView(root, card);

    expect(scrollTo).toHaveBeenCalledWith({ top: 740, behavior: "auto" });
  });
});
