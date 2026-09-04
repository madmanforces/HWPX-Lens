import { useEffect, useState } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import {
  ReviewWorkspace,
  type DetachedReviewWorkspaceState,
  type ReviewWorkspaceAction,
} from "@hwpx-lens/lens-ui";
import { PRODUCT_PROFILE } from "./product-profile";

const STATE_EVENT = "hwpx-lens-review-state";
const ACTION_EVENT = "hwpx-lens-review-action";
const READY_EVENT = "hwpx-lens-review-ready";

export function DetachedReviewApp() {
  const [state, setState] = useState<DetachedReviewWorkspaceState>();

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void listen<DetachedReviewWorkspaceState>(STATE_EVENT, (event) => {
      if (active) setState(event.payload);
    }).then((cleanup) => {
      if (active) {
        unlisten = cleanup;
        return emitTo("main", READY_EVENT);
      }
      cleanup();
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  if (!state) {
    return <main className="detached-review-loading">Review Workspace 연결 중…</main>;
  }
  const send = (action: ReviewWorkspaceAction) => {
    void emitTo("main", ACTION_EVENT, action);
  };
  return (
    <ReviewWorkspace
      detached
      {...state}
      productProfile={PRODUCT_PROFILE}
      onTabChange={(tab) => send({ type: "tab", tab })}
      onStructureSelect={(node) => send({ type: "structure", nodeId: node.id })}
      onStructureClear={() => send({ type: "clear-structure" })}
      onChangeSelect={(index) => send({ type: "change", index })}
      onFilterChange={(filter) => send({ type: "filter", filter })}
      onPrevious={() => send({ type: "previous" })}
      onNext={() => send({ type: "next" })}
      onDetachToggle={() => send({ type: "close" })}
    />
  );
}
