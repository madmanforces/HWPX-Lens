# RHWP Engine Integration Assessment

Date: 2026-09-02

Branch: `codex/rhwp-engine-integration-assessment`

Packages assessed: `@rhwp/core@0.8.4`, `@rhwp/editor@0.8.4`

Upstream source snapshot: `496333b27d21ddb9114ba9ae340bcb895870c9a7`

## Executive Summary

The architecture restart confirms that rhwp is useful to HWPX Lens as a local document engine, not merely as
an SVG generator. Its public core surface can parse and paginate HWPX, create semantic snapshots, paint Canvas2D
pages, hit-test body and cell text, return selection rectangles, and export selected plain text/HTML. Those
capabilities support Lens navigation and review interaction without SVG DOM traversal or a duplicate HTML text
document.

The restart does **not** establish a production-ready visual renderer. The target document class still has observed
clipping, complex boxed-table, caption, and vector-image failures. SVG and Canvas2D consume the same rhwp
layout/tree family, so a backend swap cannot repair shared geometry. CanvasKit is also not ready to become the
primary backend: its Studio implementation is not a one-call core renderer, the live offline build could not
resolve required fonts, every forced test render failed its runtime readiness gate with
`textRun:glyphMapping`, and automatic selection falls back to Canvas2D for a 301-page document because the
document preflight limit is 128 pages.

`@rhwp/editor` is a thin iframe/MessageChannel wrapper rather than a self-contained offline editor bundle. It
can point at a separately self-hosted Studio build, but its public SDK does not expose the semantic selection,
hit-test, scroll-to-range, Lens overlay, or compare-control surface needed by this product. Embedding two Studio
instances would add substantial state, serving, and synchronization complexity without removing the fidelity
gate.

**Recommendation: E. Hybrid rhwp architecture.** Keep `@rhwp/core` behind `DocumentAdapter`,
`RenderingAdapter`, `InteractionAdapter`, and `DiffAdapter`; use its semantic/document interaction primitives;
retain Canvas2D as the leading experimental visual backend; retain SVG only as an existing fallback/diagnostic;
and keep CanvasKit gated and optional. This is a foundation decision, **not** approval to migrate the default
renderer or resume table/image/style features. Production migration remains blocked until representative local
documents pass the visual fidelity gate. If shared layout failures cannot be fixed upstream, only the
`RenderingAdapter` should be replaced rather than coupling Lens Core to a new engine.

## Decision Snapshot

| Candidate | Result | Reason |
| --- | --- | --- |
| A. SVG + native interaction | Reject as primary | Native SVG selection/copy is poor; actual visual defects remain |
| B. Canvas2D + native interaction | Conditional component | Best tested interaction path, but shares unresolved layout fidelity |
| C. CanvasKit + native interaction | Reject as primary now | Resource/readiness failures; long-document auto fallback; Studio replay dependency |
| D. `@rhwp/editor` embed | Reject as primary | Separate Studio hosting plus insufficient review-control SDK |
| **E. Hybrid rhwp architecture** | **Selected, conditionally** | Reuse semantic engine and native interaction while preserving replaceable visual boundary |
| F. Remove rhwp entirely | Not justified yet | Parser/snapshot/mapping/copy evidence is useful and already isolated |

## rhwp Architecture

The inspected upstream structure is conceptually:

```text
HWP/HWPX bytes
  Parser and document model
  DocumentCore commands/queries
  Pagination and layout
  PageRenderTree / PageLayerTree
  Renderer backend
    SVG
    Canvas2D
    CanvasKit replay in Studio
```

This distinction matters. A missing object in all renderers is likely above the backend; malformed SVG text DOM
selection is backend-specific; and a missing font or failed image decode is a resource pipeline problem.

HWPX Lens must consume these capabilities through its own adapters. Lens Core must not import `HwpDocument`,
WASM JSON schemas, PageLayerTree item types, Studio modules, or renderer DOM nodes.

## DocumentCore

DocumentCore is the command/query boundary over the parsed document and provides the document state used by
layout and interaction. HWPX Lens does not need to reproduce its editor command stack. For the current read-only
review product, the useful public outcomes are:

- document load and page count;
- semantic paragraph/table snapshot extraction;
- page and paragraph location queries;
- hit-test and range geometry;
- clipboard export;
- renderer input and diagnostics.

The Lens-facing boundary is now explicit:

```ts
interface DocumentAdapter {
  createSnapshot(): Promise<DocumentSnapshot>;
  dispose(): void;
}
```

`LensDocument` extends that interface and separately exposes `rendering` and optional `interaction`. This is a
small type-boundary clarification; it is not a session migration.

## PageRenderTree / PageLayerTree

PageRenderTree and PageLayerTree are shared render/layout products. Public PageLayerTree and CanvasKit replay
queries are useful for:

- diagnosing whether an object reached the render tree;
- page geometry and object bounds;
- classifying shared-layout versus backend failures;
- CanvasKit capability/preflight inspection;
- testing semantic-to-visual correspondence.

They are not a license for Lens to build another renderer. HWPX Lens does not replay PageLayerTree and does not
copy Studio's replay implementation. Any tree-specific parsing remains inside the rhwp adapter or research tests.

## SVG

SVG preserves a page-shaped document and remains the current M0 default. It is useful as a diagnostic backend
and existing fallback, but it has two independent problem classes:

1. glyph/text node fragmentation and DOM ordering make browser-native selection and copy unreliable;
2. shared pagination/layout/resource defects remain visible in representative documents.

The isolated SVG semantic-layer experiment repaired logical copy and mapping for a small scope, but it duplicated
text geometry and increased synchronization risk. Native rhwp interaction is a simpler first choice, so the HTML
semantic overlay remains deprioritized.

## Canvas2D

Canvas2D is public through `HwpDocument.renderPageToCanvas(...)` and works with the same native interaction
coordinates. All required synthetic fixture categories and the ignored 301-page local fixture loaded in the
locally built Studio and in the Lens Canvas PoC. Browser tests previously verified real canvas painting,
selection overlay, semantic clipboard, and change navigation.

Canvas2D removes the browser's SVG text-selection failure because selection is semantic rather than pixel- or
DOM-based. It does not prove improved page fidelity. The same page count and near-identical page geometry seen in
the SVG/Canvas comparison are evidence that both backends consume the same upstream layout decisions.

Canvas2D is therefore the leading experimental backend for interaction, but it is not approved as the default
until representative documents are checked page-by-page against a trusted visual reference.

## CanvasKit

CanvasKit support is split across public core planning data and a substantial Studio TypeScript renderer. The
public `HwpDocument` surface exposes document preflight and page replay plans, but no simple
`renderPageToCanvasKit(canvas, page)` equivalent. A downstream CanvasKit adoption would therefore either embed
Studio or recreate/maintain its replay and resource pipeline; neither is justified by current results.

Static Node-side preflight categorized the 11 synthetic fixtures as eligible because it had no live Studio font
resource state. The resource-aware browser result was stricter:

- all forced CanvasKit synthetic renders completed, but every first-page diagnostic reported
  `textRun:glyphMapping` as an unexpected unsupported operation;
- runtime readiness was `false` for every forced synthetic render;
- no bundled or local CanvasKit typefaces were loaded in the external-font-disabled offline build;
- automatic selection rejected even `simple-paragraph` because `함초롬바탕` was unavailable and chose
  Canvas2D;
- the 301-page local fixture was `incomplete` at document preflight because `maxPages` is 128 and automatic
  selection chose Canvas2D;
- forcing CanvasKit on that document rendered page 0 but again failed runtime readiness and reported four
  unresolved Hanyang font families;
- sampled replay plans for pages 0, 3, 15, and 300 contained 49, 111, 69, and 65 items; page 0 contained one
  hidden-overlay violation, while the other three samples had no unsupported item in the static plan.

This separates two risks: resource readiness is currently insufficient for offline exact-font rendering, and
at least one real page also has a direct-replay compatibility blocker. A forced paint is not a fidelity pass.

## Selection APIs

The public core surface proved the following useful primitives:

- body hit-test to section/paragraph/character offset;
- body selection rectangles;
- cell/path selection rectangles;
- footnote-specific rectangles;
- page-indexed geometry for multi-line and multi-page ranges.

The Lens Canvas PoC verified partial-line, whole-line, wrapped multi-line, cross-paragraph, reverse-drag, and one
table-cell selection. A `Change` is mapped to a renderer-neutral semantic range, then to page rectangles, then
to independent selection and Lens overlays.

Remaining contract gaps:

- table context appears in runtime hit-test JSON but is not represented by an exported typed result;
- body/cell and multi-cell range transitions require context logic not yet exposed as one stable range API;
- headers, footers, notes, and drawing text have separate interaction paths;
- a cross-paragraph sample returned a broad line-tail rectangle unsuitable for precise diff highlighting without
  a clarified contract.

These gaps belong in the rhwp adapter/upstream boundary. Lens must not copy Studio's full editor state machine.

## Clipboard APIs

Public semantic clipboard methods successfully produced logical plain text and HTML for ordinary body text and
one table cell. Browser `Ctrl+C` writes that payload to the system clipboard instead of asking SVG or Canvas to
derive text from visual nodes.

Previously verified samples retained normal reading order for one line, wrapped text, reverse cross-paragraph
selection, one table cell, and one range from the ignored 301-page fixture. This directly fixes the reported
one-character-per-line copy behavior without adding an HTML text overlay.

## Compare Engine

Studio's internal compare engine includes snapshot building, identity and alignment modes, text similarity,
paragraph/control alignment, reflow suppression, and page annotations. It is relevant to HWPX Lens but is not a
public `@rhwp/core` or separate npm contract.

HWPX Lens does not import or copy `rhwp-studio/src/compare/diff-engine.ts`. The existing narrow `DiffAdapter`
remains. A public, versioned `@rhwp/compare` or `compareDocuments(...)` API returning semantic anchors would be
the appropriate upstream boundary.

## `@rhwp/editor`

The installed editor package contains the wrapper and transport declarations, not the Studio application,
WASM, CanvasKit, or font assets. Its public constructor creates an iframe and communicates with a Studio URL via
`MessageChannel`/`postMessage`.

Assessment:

- the default Studio URL is remote and therefore invalid for the Lens offline requirement;
- a local Studio production build can be served without external fonts, and the local PoC did so successfully;
- the wrapper requires an HTTP(S) Studio origin, so a packaged Tauri app would need a separately served local
  Studio origin rather than a direct opaque/custom asset URL;
- two independent editor instances would duplicate Studio UI/WASM/document state;
- the current public SDK exposes load, page count, SVG retrieval, renderer diagnostics, export/save state, and
  lifecycle methods;
- it does not expose semantic selection state, hit-test, selection rectangles, range navigation, Lens overlay
  injection, compare results/navigation, or a complete read-only review SDK.

Consequently `@rhwp/editor` is valuable as a local diagnostic/reference host, not as the primary HWPX Lens
integration.

## Offline Compatibility

`@rhwp/core` plus the current Lens adapters is compatible with the offline requirement: parsing, WASM, rendering,
selection, copy, and diff processing are local. The app CSP and build audit reject remote runtime assets.

CanvasKit is technically bundleable, but the local build adds roughly 7.2 MB of CanvasKit WASM on top of roughly
8.0 MB of rhwp WASM and still needs locally distributable fonts that satisfy the document families. Disabling
external webfonts exposed the real current gap rather than hiding it with network access.

`@rhwp/editor` can be made network-independent only by separately packaging and serving the full Studio build and
all resources. That is operationally possible, but not the simplest architecture and does not provide the
required public review controls.

## Renderer A/B Results

Scoring: Pass = exercised successfully; Smoke = opened/rendered without a trusted visual reference; Fail = a
mandatory gate is known to fail; Conditional = useful but incomplete; N/A = not applicable or not measured.

| Metric | SVG | Canvas2D | CanvasKit |
| --- | --- | --- | --- |
| Synthetic content open | Pass | Pass | Paint completed |
| Trusted visual equivalence | Not established | Not established | Not established |
| Complex-document visual fidelity | Fail from observed clipping/tables/captions/images | Fail/unknown improvement; shared defects remain | Fail readiness gate |
| Paragraph placement / wrapping | Smoke | Smoke; same layout family | Blocked by font/glyph readiness |
| Simple/merged tables | Smoke | Smoke | Static plans only; no trusted reference |
| PNG image/caption | Smoke | Smoke | Forced paint only |
| WMF/EMF | Fail in observed documents | Resource/shared status unresolved | Not validated |
| Native text selection | Fail UX | Pass in PoC | Same native geometry is possible, renderer still blocked |
| Semantic copy | Pass via adapter, not native SVG DOM | Pass | Public semantic copy is backend-neutral |
| Change mapping/navigation | Pass via adapter/overlay | Pass via native adapter/overlay | Geometry path exists; backend not accepted |
| 301-page automatic backend | N/A | Selected | Rejected by 128-page preflight limit |
| Offline assets | Pass | Pass | Bundleable, but exact local fonts not ready |
| Integration complexity | Existing | Moderate and bounded | High: Studio replay/resources/gates |

The mandatory visual gate remains failed. High interaction scores cannot compensate for missing or malformed
document content.

## Engine vs Backend Failure Classification

### Backend-specific

- SVG DOM fragmentation/order causing unnatural selection and copy;
- CanvasKit replay/runtime readiness and surface-specific font registration;
- CanvasKit's automatic 128-page document preflight ceiling.

### Shared parser/layout/render-tree

- page clipping and pagination if reproduced identically in SVG and Canvas2D;
- paragraph and complex-table geometry;
- boxed-table layout;
- caption placement or numbering when the semantic/control data is already wrong before painting.

### Resource pipeline

- unavailable local font families and substitution metrics;
- WMF/EMF decode/conversion and embedded-resource preparation;
- CanvasKit typeface registration and glyph mapping.

Each reported real-document defect needs a synthetic reproduction and backend matrix before it is assigned to
one category. Lens CSS, clipping changes, or overlay offsets must not conceal a shared layout defect.

## Recommended HWPX Lens Architecture

```text
OriginalDocumentSession                  ModifiedDocumentSession
  RhwpDocumentAdapter                      RhwpDocumentAdapter
  RhwpInteractionAdapter                   RhwpInteractionAdapter
  RenderingAdapter                         RenderingAdapter
    Canvas2D candidate                        Canvas2D candidate
    SVG diagnostic fallback                  SVG diagnostic fallback
    CanvasKit gated experiment               CanvasKit gated experiment

Lens Core
  Change Model
  Semantic Mapping
  Navigation / Review State
  DiffAdapter

Lens UI
  Visual page
  Native selection overlay
  Lens change overlay
```

Rules:

1. One rhwp document session owns semantic and visual coordinates for each side.
2. Engine-specific objects and JSON are normalized inside adapters.
3. Canvas2D remains opt-in until complex-document fidelity passes.
4. SVG stays available for regression classification, not as the interaction authority.
5. CanvasKit may run only after resource-aware preflight and runtime readiness both pass; no forced production
   mode.
6. `@rhwp/editor` remains a diagnostic harness.
7. HTML semantic overlay remains dormant unless native interaction proves structurally insufficient.
8. Table/image/style diff development remains paused.

## Required Adapter Changes

Implemented in this assessment:

- added the explicit renderer-neutral `DocumentAdapter` lifecycle/snapshot interface;
- kept `LensDocument` as the composition root for document, rendering, and interaction adapters;
- added a public CanvasKit preflight/replay-plan contract test over the required synthetic corpus and optional
  ignored local fixture.

Deferred until a migration gate passes:

- renaming PoC constructors/backends into production session factories;
- runtime backend policy and diagnostics in product UI;
- full typed table/cell hit-test support;
- multi-context/multi-page drag state;
- CanvasKit renderer packaging;
- any alternate visual authority.

## PR Candidates

The ignored `prCandidates/rhwp/` workspace contains or should retain candidates for:

- typed downstream-native interaction/hit-test results, including cell paths;
- precise selection-rectangle line-tail semantics;
- native table-caption access and caption fidelity;
- complex boxed-table, clipping, and vector-resource reproductions;
- public headless compare API/package;
- self-contained or streamed CanvasKit preflight for long documents;
- offline CanvasKit font registration and glyph-readiness diagnostics;
- a review-oriented editor SDK only if upstream wants iframe embedding to be a supported downstream path.

No external issue or pull request is created automatically.

## Risks

- semantic completeness can mask visually missing content;
- Canvas2D and SVG may agree because both are wrong at the shared layout layer;
- locally unavailable fonts can alter line breaks and pagination before rendering;
- CanvasKit forced mode can paint while its own readiness contract says the result is not acceptable;
- an alternative visual engine may create semantic-to-visual coordinate drift;
- two full document sessions plus raster pages require long-document memory profiling;
- private Studio imports would create an unversioned dependency and are prohibited.

## Recommendation

**E. Hybrid rhwp architecture.**

Use rhwp for the document model, semantic snapshot, layout-linked locations, native selection geometry, and
semantic clipboard. Keep every renderer behind `RenderingAdapter`; keep Canvas2D as the current experimental
front-runner, SVG as a comparison/fallback backend, and CanvasKit disabled unless both preflight and runtime
readiness pass with packaged local fonts.

Do not change the default renderer or start a large migration yet. The next gate is a trusted visual regression
matrix for representative synthetic reproductions and ignored local documents. If shared rhwp layout defects
cannot reach zero meaningful omissions and acceptable table/image/caption fidelity, retain the semantic adapters
but replace or supplement the visual backend through the existing boundary. This conclusion preserves the HWPX
Lens product direction without preserving a renderer for sunk-cost reasons.

## Sources

- [rhwp repository and architecture](https://github.com/edwardkim/rhwp/blob/main/README_EN.md)
- [`@rhwp/core` package](https://www.npmjs.com/package/%40rhwp/core)
- [`@rhwp/editor` package](https://www.npmjs.com/package/%40rhwp/editor)
- [WASM/public API implementation](https://github.com/edwardkim/rhwp/blob/main/src/wasm_api.rs)
- [multi-renderer tracking](https://github.com/edwardkim/rhwp/issues/536)
- [editor MessageChannel transport](https://github.com/edwardkim/rhwp/issues/2186)
- [PageLayerTree tracking](https://github.com/edwardkim/rhwp/issues/1017)
