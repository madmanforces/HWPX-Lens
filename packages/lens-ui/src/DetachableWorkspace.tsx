import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Mirrors review controls into a child window through a React portal. The
 * document sessions stay in the main React tree, so detaching never reparses
 * either HWPX file.
 */
export function DetachableWorkspace({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose(): void;
  children: ReactNode;
}) {
  const [container, setContainer] = useState<HTMLElement>();

  useEffect(() => {
    if (!open) {
      setContainer(undefined);
      return;
    }
    if ("__TAURI_INTERNALS__" in window) {
      window.dispatchEvent(new CustomEvent("hwpx-lens:workspace-open"));
      return () => {
        window.dispatchEvent(new CustomEvent("hwpx-lens:workspace-close"));
        setContainer(undefined);
      };
    }
    const child = window.open(
      "",
      "hwpx-lens-review-workspace",
      "popup=yes,width=430,height=820,left=80,top=80,resizable=yes,scrollbars=no",
    );
    if (!child) {
      onClose();
      return;
    }
    child.document.title = "HWPX Lens · Review Workspace";
    child.document.documentElement.lang = "ko";
    child.document.head.replaceChildren();
    for (const style of document.querySelectorAll('style, link[rel="stylesheet"]')) {
      child.document.head.append(style.cloneNode(true));
    }
    const root = child.document.createElement("div");
    root.id = "detached-review-root";
    child.document.body.replaceChildren(root);
    child.document.body.className = "detached-review-body";
    setContainer(root);
    const close = () => onClose();
    child.addEventListener("beforeunload", close, { once: true });
    return () => {
      child.removeEventListener("beforeunload", close);
      if (!child.closed) child.close();
      setContainer(undefined);
    };
  }, [onClose, open]);

  return container ? createPortal(children, container) : null;
}
