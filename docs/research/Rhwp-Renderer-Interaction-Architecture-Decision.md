# Rhwp Renderer and Interaction Architecture Decision

Date: 2026-09-02

Branch: `codex/canvas-native-poc`

Engine: `@rhwp/core@0.8.4`

# Executive Summary

Canvas2D plus rhwp native selection is a clear interaction improvement over browser-native SVG selection:
dragging, logical copy, body/cell hit-testing, change highlighting, and previous/next navigation all work in the
tested scope. It also avoids a duplicate invisible HTML text document.

It does **not** satisfy the complete HWPX Lens renderer gate. SVG and Canvas2D use the same rhwp layout and page
tree family, while the actual target document class has already shown repeated clipping, broken complex tables and
boxed tables, caption-number problems, and WMF/EMF failures. The 301-page local fixture opens and semantic
coverage is complete, but opening and extracting text do not prove that all pixels match the source document.

The hit-test contract also lacks documented public table-context fields, and the PoC does not cover cross-page,
cross-cell, header/footer, footnote, or drawing-text interaction without recreating Studio's state machine.

Decision: **E. rhwp interaction surface is insufficient — evaluate another architecture.** Keep the isolated
Canvas/native Adapter as evidence and a reusable candidate component, but do not make it the default renderer and
do not resume product feature expansion yet.

## Implemented PoC Architecture

```text
Lens Core
  RenderingAdapter (engine-neutral)
    RhwpSvgRenderingAdapter       existing default
    RhwpCanvasRenderingAdapter    explicit PoC
  InteractionAdapter (engine-neutral)
    RhwpSemanticInteractionAdapter existing SVG experiment
    RhwpNativeInteractionAdapter   explicit PoC
  DiffAdapter                     unchanged

Canvas page
  Canvas2D visual layer
  native selection overlay
  Lens change overlay
  pointer/hit-test surface
```

The experiment is enabled only with `?canvas-poc=1`. SVG M0, the SVG semantic-layer PoC, existing navigation,
tests, and Windows packaging remain intact. No rhwp type or object crosses into Lens Core.

## Public API Result

| Area | Result | Gate impact |
| --- | --- | --- |
| Canvas2D paint | Public and functional | Pass |
| Body hit-test | Public and functional | Pass |
| Body selection rectangles | Public and functional | Pass with geometry caveat |
| Body plain-text/HTML copy | Public and functional | Pass |
| One-cell rectangles/copy | Public methods work | Conditional: hit-test cell JSON fields are undocumented |
| Multi-cell/cross-context range | No single stable downstream contract used | Fail for full-document interaction |
| Multi-page pointer drag | Rect API can span pages; PoC UI does not | Conditional |
| CanvasKit | Planning/replay APIs only; Studio replay layer required | N/A |
| Compare engine | Studio-internal, not npm public surface | Keep current DiffAdapter; propose upstream API |

## Canvas2D Visual Result

All required synthetic fixture types, plus the retained mixed-font regression, opened through the Canvas
Adapter. Canvas and SVG reported the same page count and
page geometry (maximum view-box rounding difference below 0.1 page unit). The browser rendered real Canvas
elements, lazy-materialized pages, and produced no console warnings/errors.

This is a smoke/layout-consistency pass, not a fidelity reference pass. There is no Hancom-generated reference
raster for the synthetic corpus. More importantly, identical page-tree geometry means Canvas cannot be credited
with fixing layout errors merely because it paints them through a different backend.

## Native Selection and Copy Result

Browser validation passed:

- partial and full line selection;
- wrapped multi-line selection;
- reverse cross-paragraph selection;
- one table-cell selection;
- selection clear;
- Ctrl+C logical plain text;
- separate selection and Lens overlays.

Copy samples retained normal reading order, including a 224-character wrapped range and a two-paragraph reverse
drag. The old one-glyph-per-line SVG clipboard failure is backend/DOM-specific and is eliminated by semantic
clipboard APIs.

## Change Mapping and Navigation

The M0 `Change` range is converted to section/paragraph/offset, passed to `getSelectionRects()`, and drawn as an
independent overlay. The public two-change fixture navigated `1 / 2 → 2 / 2 → 1 / 2` correctly on both sides.
No SVG DOM parsing or mutation is used.

One cross-paragraph test produced a broad first-line tail rectangle. It does not corrupt copied text, but precise
diff highlighting requires a clarified or tighter rectangle contract.

## Local Fixture Evidence

The ignored 301-page local fixture produced:

- 3,646 body paragraphs and 381 tables in the semantic snapshot;
- 26,361 page-layout runs;
- 126,788 meaningful body characters with 0 uncovered characters;
- 0 source-range mismatches;
- a sampled Canvas/native range with exact plain-text copy;
- four sampled Canvas page descriptors and real browser Canvas painting.

No filename, document text, or file bytes are stored in Git.

The same document class has observed visual failures in clipping, complex boxed tables, captions, and
vector images. Semantic completeness cannot override those visible failures.

## Fidelity Matrix

Scoring: 5 = strong tested pass, 3 = smoke/structural pass only, 1 = repeated real-fixture failure, N/A = not
tested. A high average cannot override content-completeness or mapping failure.

| Fixture | SVG visual | Canvas2D visual | Native selection/copy | Mapping | Notes |
| --- | ---: | ---: | ---: | ---: | --- |
| simple-paragraph | 3 | 3 | 5 | 5 | Synthetic, no reference raster |
| multiline-paragraph | 3 | 3 | 5 | 5 | Five-rect copy sample passed |
| mixed-font | 3 | 3 | 4 | 5 | Existing public shapes only |
| long-paragraph | 3 | 3 | 4 | 5 | Two pages |
| multi-page-text | 3 | 3 | 3 | 4 | API geometry exists; cross-page pointer drag not implemented |
| simple-table | 3 | 3 | 5 in one cell | 4 | Cell hit JSON typing gap |
| merged-table | 3 | 3 | 3 | 3 | Smoke only; no cross-cell selection |
| image | 3 | 3 | N/A | N/A | No image diff/interaction added |
| image-caption | 3 | 3 | N/A | 3 | Simple PNG only |
| table-caption | 3 | 3 | N/A | 3 | Synthetic visual surrogate; native table caption creation unavailable |
| long-document | 3 | 3 | 3 | 4 | 12 synthetic pages, lazy UI |
| ignored real fixture | 1 | 1/unknown fixes | 4 sampled | 4 sampled | Mandatory visual gate remains failed |

## Backend Diagnosis

### Backend-specific

- SVG glyph DOM selection/copy order: Canvas/native semantic copy fixes it.

### Shared layout or PageLayerTree

- pagination and page clipping;
- paragraph/table measurement;
- merged/complex and boxed-table geometry;
- caption placement and automatic number representation.

If both renderers receive wrong geometry, Lens CSS or overlays must not hide it.

### Resource pipeline

- local font availability/fallback;
- WMF/EMF conversion and embedded image preparation.

These require isolated upstream fixtures before assigning the defect to one backend.

## Performance

Indicative local measurements, not a formal benchmark:

- local 301-page Canvas/native snapshot plus sampled mapping/copy/descriptors: about 0.63 seconds in the Node
  integration harness;
- complete semantic coverage audit of the same local file: about 1.60 seconds;
- browser page virtualization materialized only nearby Canvas pages;
- public two-document Canvas flow produced no browser errors.

Canvas raster buffers consume memory proportional to page size, scale, and device pixel ratio. The UI caps the
paint ratio and keeps lazy page materialization; a production memory benchmark is still required.

## Offline and Packaging

The path uses the packaged rhwp WASM and local browser APIs only. No CDN, font server, or web service was added.
The static offline audit passed and the Windows NSIS installer built successfully. A physical
network-disconnected restart is still a manual acceptance check.

## Verification Summary

- project verification: typecheck, Adapter-boundary audit, 59 unit/integration tests, production build, offline
  asset audit, and ignored-path audit passed;
- Canvas/native focused suite: body/cell unit and integration cases plus every required synthetic fixture passed;
- browser e2e: default compare flow and Canvas render/select/copy/navigation flow passed;
- local-only tests: 301-page semantic coverage and Canvas/native sampled mapping/copy passed;
- Tauri: optimized Windows x64 executable and NSIS setup bundle built successfully.

## Architecture Comparison

| Candidate | Fidelity | Interaction | Mapping | Maintainability | Public API stability | Offline | Complexity |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A. SVG native DOM | 1 | 1 | 2 | 3 | 4 | 5 | 3 |
| B. SVG + semantic HTML | 1 | 4 | 5 | 2 | 3 | 5 | 2 |
| C. Canvas2D + rhwp native | 1 | 4 | 4 | 4 | 3 | 5 | 4 |
| CanvasKit | N/A | N/A | N/A | 1 pending | 2 pending | 2 pending | 1 pending |

Canvas/native wins interaction simplicity, but no candidate using the current rhwp visual layout passes the
mandatory real-document fidelity gate.

## Failure Criteria Triggered

1. table-cell hit-test metadata is not a documented public TypeScript contract;
2. full interaction would require more Studio-like context handling than this review PoC should own;
3. repeated complex-document renderer failures remain upstream of the Canvas/SVG choice;
4. CanvasKit would require unjustified replay/resource complexity before showing a fidelity benefit.

## Compare Engine Decision

Studio's compare engine is general and relevant, but private to Studio. Its identity/alignment split, anchor
matching, reflow suppression, control matching, and page annotation justify a public upstream compare API. HWPX
Lens keeps `DiffAdapter` and does not copy the implementation.

## Final Decision

**E. rhwp interaction surface is insufficient — evaluate another architecture.**

Operational meaning:

- do not switch the default renderer from SVG to Canvas2D;
- retain the Canvas/native PoC behind Adapter and query-flag isolation;
- pause table/image/style product expansion;
- evaluate an alternative visual authority or an upstream-first fidelity plan;
- if a hybrid is considered, one engine must own pagination and expose stable semantic range geometry;
- request public typed hit-test/cell contracts and a public compare package upstream rather than importing Studio.
