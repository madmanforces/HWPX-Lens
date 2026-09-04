import { emitTo, listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type {
  DetachedReviewWorkspaceState,
  ReviewWorkspaceAction,
} from "@hwpx-lens/lens-ui";

const REVIEW_LABEL = "review-workspace";
const STATE_EVENT = "hwpx-lens-review-state";
const ACTION_EVENT = "hwpx-lens-review-action";
const READY_EVENT = "hwpx-lens-review-ready";

export async function initializeReviewWindowBridge(): Promise<() => void> {
  let reviewWindow: WebviewWindow | null = null;
  let latestState: DetachedReviewWorkspaceState | undefined;
  const dispatchAction = (action: ReviewWorkspaceAction) => {
    window.dispatchEvent(new CustomEvent("hwpx-lens:workspace-action", { detail: action }));
  };

  const unlistenAction = await listen<ReviewWorkspaceAction>(ACTION_EVENT, (event) => {
    dispatchAction(event.payload);
    if (event.payload.type === "close") void closeReviewWindow();
  });
  const unlistenReady = await listen(READY_EVENT, () => {
    if (latestState) void emitTo(REVIEW_LABEL, STATE_EVENT, latestState);
  });

  const openReviewWindow = async () => {
    reviewWindow = await WebviewWindow.getByLabel(REVIEW_LABEL);
    if (reviewWindow) {
      await reviewWindow.show();
      await reviewWindow.setFocus();
      if (latestState) await emitTo(REVIEW_LABEL, STATE_EVENT, latestState);
      return;
    }
    reviewWindow = new WebviewWindow(REVIEW_LABEL, {
      url: "/?review-workspace=detached",
      title: "HWPX Lens · Review Workspace",
      width: 430,
      height: 820,
      minWidth: 340,
      minHeight: 520,
      resizable: true,
    });
    void reviewWindow.once("tauri://created", () => {
      if (latestState) void emitTo(REVIEW_LABEL, STATE_EVENT, latestState);
    });
    void reviewWindow.once("tauri://destroyed", () => {
      reviewWindow = null;
      dispatchAction({ type: "close" });
    });
  };

  const closeReviewWindow = async () => {
    reviewWindow ??= await WebviewWindow.getByLabel(REVIEW_LABEL);
    if (reviewWindow) {
      const closing = reviewWindow;
      reviewWindow = null;
      await closing.close();
    }
  };

  const stateListener = (event: Event) => {
    latestState = (event as CustomEvent<DetachedReviewWorkspaceState>).detail;
    if (reviewWindow && latestState) void emitTo(REVIEW_LABEL, STATE_EVENT, latestState);
  };
  const openListener = () => void openReviewWindow();
  const closeListener = () => void closeReviewWindow();
  window.addEventListener("hwpx-lens:workspace-state", stateListener);
  window.addEventListener("hwpx-lens:workspace-open", openListener);
  window.addEventListener("hwpx-lens:workspace-close", closeListener);

  return () => {
    unlistenAction();
    unlistenReady();
    window.removeEventListener("hwpx-lens:workspace-state", stateListener);
    window.removeEventListener("hwpx-lens:workspace-open", openListener);
    window.removeEventListener("hwpx-lens:workspace-close", closeListener);
    void closeReviewWindow();
  };
}
