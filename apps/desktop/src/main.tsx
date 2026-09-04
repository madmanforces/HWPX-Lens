import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  createRhwpCanvasPocDocument,
  createRhwpDocument,
  createRhwpInteractionPocDocument,
  RhwpDiffAdapter,
} from "@hwpx-lens/hwpx-adapter";
import { LensApp } from "@hwpx-lens/lens-ui";
import { DetachedReviewApp } from "./DetachedReviewApp";
import { initializeReviewWindowBridge } from "./review-window-bridge";
import { PRODUCT_PROFILE } from "./product-profile";
import "@hwpx-lens/lens-ui/styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("HWPX Lens root element was not found.");
}

const semanticInteractionPoc = new URLSearchParams(window.location.search).get("semantic-poc") === "1";
const detachedReviewWorkspace = new URLSearchParams(window.location.search).get("review-workspace") === "detached";
const canvasInteractionPoc = new URLSearchParams(window.location.search).get("canvas-poc") === "1";
const requestedRenderCachePages = Number(
  new URLSearchParams(window.location.search).get("render-cache-pages") ?? "5",
);
const renderCachePages = Number.isInteger(requestedRenderCachePages)
  ? Math.min(20, Math.max(3, requestedRenderCachePages))
  : 5;
const openDocument = canvasInteractionPoc
  ? createRhwpCanvasPocDocument
  : semanticInteractionPoc
    ? createRhwpInteractionPocDocument
    : createRhwpDocument;

if (detachedReviewWorkspace) {
  createRoot(root).render(<StrictMode><DetachedReviewApp /></StrictMode>);
} else {
  if ("__TAURI_INTERNALS__" in window) void initializeReviewWindowBridge();
  createRoot(root).render(
    <StrictMode>
      <LensApp
        openDocument={openDocument}
        diffAdapter={new RhwpDiffAdapter()}
        renderCachePages={renderCachePages}
        productProfile={PRODUCT_PROFILE}
      />
    </StrictMode>,
  );
}
