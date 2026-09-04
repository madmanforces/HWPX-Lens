# rhwp Native Interaction API Assessment

Date: 2026-09-02

Package assessed: `@rhwp/core@0.8.4`

Upstream source snapshot: `496333b27d21ddb9114ba9ae340bcb895870c9a7`

## Executive Summary

rhwp 0.8.4 exposes enough public methods to prove a useful Canvas/native-interaction path for ordinary body
text and text inside one table cell. Canvas2D rendering, body hit-testing, selection rectangles, semantic copy,
plain text retrieval, and HTML export all worked without importing Studio modules.

The surface is not yet a stable complete downstream contract:

- the TypeScript declaration documents only the body fields of `hitTest()` even though the runtime JSON also
  carries cell context used by Studio;
- selecting across body/cell or across multiple table cells has no single downstream-friendly range API;
- the PoC does not implement cross-page pointer dragging, headers/footers, notes, or drawing-text contexts;
- range rectangles can include a large trailing line area in a paragraph-boundary selection and need an
  upstream conformance test;
- Canvas2D and SVG share rhwp pagination/layout data, so changing only the backend cannot repair shared
  clipping, table, caption, or vector-resource failures.

Conclusion: native interaction primitives are valuable and should remain behind `InteractionAdapter`, but the
current public surface and visual fidelity do not pass the shipping renderer gate.

## Public Rendering Surface

| Capability | Public 0.8.4 method | Assessment |
| --- | --- | --- |
| Canvas2D page | `renderPageToCanvas(page, canvas, scale)` | Usable; Canvas size is managed by rhwp |
| Filtered Canvas2D | `renderPageToCanvasFiltered*` | Public; useful for editor layers, not required by this PoC |
| Legacy Canvas2D | `renderPageToCanvasLegacy` | Public fallback/diagnostic path |
| SVG | `renderPageSvg` | Existing M0 path retained |
| Page geometry | `getPageInfo`, `getPageLayerTree*` | Public; diagnostic/metadata source |
| CanvasKit | preflight/replay-plan methods | Public planning data, but no simple HwpDocument CanvasKit paint call |

The Lens experiment exposes only an engine-neutral `Canvas2DRenderedPage.paint()` callback. The UI never imports
`HwpDocument`, and Lens Core does not inspect PageLayerTree or SVG DOM.

## Initialization, Fonts, Offline, and Tauri

- Initialization is the existing packaged WASM initialization; no remote module or service is required.
- Canvas2D uses browser/WebView font resolution. Existing locally bundled/font-alias behavior still applies;
  switching backends does not make unavailable company fonts appear.
- image/font/WASM assets stay local and the Tauri CSP disallows external network origins.
- the Canvas route is explicit opt-in (`?canvas-poc=1`); default M0 remains SVG.
- Windows NSIS packaging is exercised by the normal project build gate.

## Public Selection Surface

The following methods are declared on `HwpDocument`:

- `getSelectionRects` for body ranges;
- `getSelectionRectsInCell` and `getSelectionRectsInCellByPath` for direct/nested cells;
- `*Ex` variants with optional page hints;
- `getSelectionRectsInFootnote` for a separate note context.

The return value is JSON rectangles in page coordinates (`pageIndex`, `x`, `y`, `width`, `height`). Tests cover
forward and reverse body selection, multi-line and cross-paragraph ranges, a direct table cell, and clearing the
selection. The Adapter rejects incompatible body-to-cell and multi-cell ranges instead of inventing geometry.

## Clipboard Surface

The PoC uses only public methods:

1. `copySelection` or the cell/path equivalent;
2. `getClipboardText()` for logical plain text;
3. `exportSelectionHtml` or the cell/path equivalent;
4. a normal browser `copy` event to write `text/plain` and `text/html`.

Verified results:

- a one-line selection copied `1122334` in logical order;
- a reverse, cross-paragraph selection copied two normal lines in reading order;
- a wrapped paragraph copied 224 characters in reading order across five rectangles;
- a table-cell selection copied `항목`;
- the 301-page ignored local fixture copied a sampled semantic range exactly.

This removes the one-character-per-line SVG browser-copy failure because Canvas pixels are never treated as the
clipboard source.

## Hit-Test Contract

`hitTest(page, x, y)` is public and body text returns section, paragraph, and character offset. Studio's current
runtime also returns table context such as parent paragraph, control index, cell index, cell paragraph, and
`cellPath`.

However, those table fields are not described in the installed `rhwp.d.ts` method comment or a public exported
result type. The PoC normalizes the runtime JSON inside `RhwpNativeInteractionAdapter`, but this must be treated
as a public-contract gap rather than a stable shipping dependency. A downstream-friendly typed result or an
explicit `hitTestInCell` contract is an upstream candidate.

Headers/footers, footnotes, and drawing text have separate hit-test methods. Folding all of Studio's editing
state machine into Lens would violate the project boundary, so those contexts were not copied or reimplemented.

## Semantic-to-Visual Mapping

For a body `Change`, Lens passes section/paragraph/offset to the native Adapter. The Adapter asks
`getSelectionRects()` for page-space geometry; the UI scrolls to that page and draws a separate Lens overlay.
No SVG node lookup is involved.

The ten-fixture corpus showed equal page counts between SVG and Canvas and page dimensions within 0.1 page
unit. Public fixture change navigation selected 1/2, then 2/2, then 1/2 correctly. Body and table-cell highlights
visually covered the selected text.

A cross-paragraph sample returned a first-line rectangle extending far beyond the visible short text. This may
be intentional line-tail selection behavior, but it is too broad for precise Lens diff highlighting until the
contract and expected geometry are tested upstream. Single-line and wrapped in-paragraph samples were accurate.

## Selection Scope Result

| User action | Result |
| --- | --- |
| Partial line | Pass |
| Full line | Pass |
| Multiple lines | Pass |
| Cross paragraph | Pass for text/copy; line-tail rect needs clarification |
| Long paragraph | Pass on synthetic fixture |
| One table cell | Pass |
| Multiple pages | API can return page-indexed rects; pointer-drag PoC not implemented |
| Reverse drag | Pass |
| Ctrl+C | Pass in browser clipboard |
| Clear | Pass with Escape/pointer restart |

## PageLayerTree and CanvasKit

PageLayerTree is useful for diagnostics, object metadata, and backend classification. Lens Core must not replay it
as a custom renderer.

CanvasKit remains N/A in this PoC. Upstream Studio uses a TypeScript replay layer plus preflight/replay plans;
adopting it would add resource, unsupported-operation, font, and offline packaging complexity. Canvas2D did not
show a visual-fidelity win over the shared layout source, so there was no evidence-based reason to add CanvasKit.

## Fidelity Classification

- **Backend-specific:** browser-native SVG selection/copy fragmentation. Canvas + semantic copy fixes this.
- **Shared layout/render-tree risk:** pagination, clipping, table geometry, caption placement/numbering. Canvas and
  SVG consume the same rhwp document layout family; backend exchange alone is not a fix.
- **Resource risk:** local fonts and WMF/EMF conversion/loading. Backend behavior may vary, but a missing or bad
  shared resource remains bad in both.

## Public API Verdict

Body selection/copy is viable. One-cell selection/copy is technically demonstrated but not sufficiently typed
as a public downstream contract. Full document interaction is incomplete without importing substantial Studio
state-machine behavior. Therefore the native APIs are appropriate as experimental Adapter primitives, not yet
enough to declare Canvas2D the primary shipping architecture.
