import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { StructurePanel, type StructureNode } from "./StructurePanel";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("StructurePanel disclosure controls", () => {
  it("toggles child branches without navigating and reveals a selected descendant", async () => {
    const grandchild = node("grandchild", 3);
    const child = node("child", 2, [grandchild]);
    const rootNode = node("root", 1, [child]);
    const onSelect = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <StructurePanel
          nodes={[rootNode]}
          scoped={false}
          onSelect={onSelect}
          onClearScope={vi.fn()}
        />,
      );
    });

    expect(container.querySelector('[aria-label="1. root 하위 목차 접기"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="2. child 하위 목차 펼치기"]')).not.toBeNull();
    expect(container.textContent).not.toContain("grandchild");

    await act(async () => {
      click(container.querySelector('[aria-label="2. child 하위 목차 펼치기"]'));
    });
    expect(onSelect).not.toHaveBeenCalled();
    expect(container.textContent).toContain("grandchild");

    await act(async () => {
      click(container.querySelector('[aria-label="1. root 하위 목차 접기"]'));
    });
    expect(container.textContent).not.toContain("child");

    await act(async () => {
      root.render(
        <StructurePanel
          nodes={[rootNode]}
          selectedId="grandchild"
          revealKey={1}
          scoped
          onSelect={onSelect}
          onClearScope={vi.fn()}
        />,
      );
    });
    expect(container.textContent).toContain("grandchild");

    await act(async () => {
      click(container.querySelector('button[title="3. grandchild"]'));
    });
    expect(onSelect).toHaveBeenCalledWith(grandchild);

    await act(async () => root.unmount());
  });
});

function click(element: Element | null): void {
  if (!element) throw new Error("Expected element to exist.");
  element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function node(id: string, level: number, children: StructureNode[] = []): StructureNode {
  return {
    id,
    level,
    number: `${level}.`,
    label: id,
    status: "unchanged",
    changeIds: [],
    children,
  };
}
