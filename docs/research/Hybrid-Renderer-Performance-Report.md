# Hybrid Renderer and Performance Foundation Report

Date: 2026-09-02

Branch: `codex/hybrid-renderer-performance-foundation`

Engine: `@rhwp/core@0.8.4`

## Executive Summary

This phase establishes the requested **analyse eagerly, render lazily** foundation without changing the HWPX
Lens product direction or coupling Lens Core to rhwp. Both documents are parsed into engine-neutral snapshots,
the complete change list is aligned, every change is mapped to Original and Modified visual coordinates, and
only then does the application enter `READY`. Visual pages are represented by exact-size placeholders and a
renderer-neutral, per-document LRU cache materializes only the current three-page window. A distant change
requests its target page first, scrolls after it is available, and then lets normal viewport observation load the
surrounding pages.

The former paragraph alignment allocated an `N × M` JavaScript matrix and could become the dominant memory and
UI risk. It has been replaced by exact unique anchors plus longest-increasing-subsequence alignment, bounded
dynamic programming for small unmatched regions, and bounded look-ahead for large unmatched regions. The new
4,000-paragraph regression measured about 4.5 ms for alignment (13 ms for the full test body) on the development machine; this is a scalability result,
not a universal diff-quality guarantee for heavily reordered or repetitive documents.

The ignored local large fixture was categorized as `HIGH`: 17.22 MiB compressed, 301 pages, 3,646 meaningful body
paragraphs, 381 tables, and 6,327 table cells. Across repeated local runs, cold Canvas document sessions opened
in roughly 0.40–0.52 seconds and snapshots took 51–66 ms. A single representative changed range was compared and
mapped on both sides in roughly 19–21 ms per stage. Page metadata for all 301 pages took 1.5–1.7 ms. These are high-end development-machine
measurements and do not replace an Office Baseline physical-PC run.

The renderer recommendation is **B. SVG Default / Canvas2D Experimental**. This is an operational migration
decision, not a declaration that SVG passes the fidelity gate. Canvas2D has lower measured page production cost
and the better native interaction path, but the previously reproduced clipping, complex boxed-table,
caption, and vector-image failures have not been eliminated or categorized as backend-only. Canvas2D therefore
cannot become the default until representative documents pass visual reference checks.

Persistent analysis caching is deliberately **not implemented**. Snapshots and changes contain sensitive
document text, so the current cache is session-only memory, holds at most four documents and four ordered pairs,
and is cleared when the Lens application unmounts. SHA-256 keys include the engine/snapshot/diff schema identity;
the hash implementation works with WebCrypto and has a local fallback for restricted WebViews/LAN test origins.

## Decision Summary

| Decision | Result |
| --- | --- |
| Renderer | **B. SVG Default / Canvas2D Experimental** |
| Eager semantic analysis | **Yes** |
| Lazy visual rendering | **Yes** |
| Page virtualization | **Yes** |
| Render cache | **Yes — 5 pages per document initially** |
| Persistent analysis cache | **No by default; optional only after security approval** |
| Hard file-size limit | **Keep the current 200 MiB guard temporarily** |
| Large-document warning | **Yes** |
| CanvasKit | Deferred / N/A in this phase |

## Current Bottlenecks

### Addressed

- Quadratic paragraph alignment no longer allocates two full numeric `N × M` matrices.
- The UI no longer retains every rendered page reached during a session.
- Change navigation does not smooth-scroll through and render all intervening pages.
- Pair re-selection no longer repeats snapshot, diff, and geometry mapping work when the content and schema keys
  are unchanged in the same application session.
- Page dimensions are collected without visual rendering, so the full scroll geometry is available immediately.

### Remaining

- `HwpDocument` construction is synchronous and took roughly 0.45–0.52 seconds per large document on the
  development machine. A slower office CPU can still produce a visible main-thread pause.
- rhwp geometry queries are synchronous. One changed range on both large-document sessions took about 21 ms;
  eager mapping is therefore batched and yields after every two changes, but total mapping time still scales with
  the change count.
- The bounded alignment fallback intentionally trades global optimality for predictable resource use in a large,
  unanchored, repetitive region. Additional adversarial diff-quality fixtures are required.
- Renderer fidelity, not page-production speed, remains the release blocker.
- Exact embedded-image count/byte inspection was intentionally excluded from the opening critical path. A
  diagnostic scan of the local fixture took about one second, which is too expensive for a mandatory progress
  label.

## Canvas2D Integration

Canvas2D remains isolated behind `RenderingAdapter`:

```text
Lens Core
  DocumentAdapter
  DiffAdapter

Lens UI
  RenderingAdapter
    RhwpSvgRenderingAdapter
    RhwpCanvas2DRenderingAdapter
  InteractionAdapter
    RhwpNativeInteractionAdapter
  Lens overlays
```

The Canvas adapter returns an engine-neutral page descriptor containing `viewBox` and a `paint(canvas, scale)`
callback. The React viewer owns the actual canvas lifetime. Evicting a page removes its canvas surface from the
DOM; Lens Core never sees an `HwpDocument`, renderer tree, canvas context, SVG DOM node, or Studio-private API.

Canvas2D is enabled only through the existing experimental route. SVG remains the default, and the existing SVG
implementation and regression tests are retained.

## SVG vs Canvas2D Fidelity

| Metric | SVG | Canvas2D | Finding |
| --- | --- | --- | --- |
| Semantic text completeness | Same document snapshot | Same document snapshot | Backend-independent snapshot succeeds |
| Page geometry | Shared rhwp layout | Shared rhwp layout | Agreement is not proof of correctness |
| Selection/copy | Browser SVG behavior remains poor | rhwp native semantic selection/copy | Canvas path preferred for interaction |
| Highlight mapping | rhwp selection rectangles | rhwp selection rectangles | Engine-neutral Lens overlay works |
| Tables/captions/vector images | Known complex-document failures remain | No trusted evidence of repair | Fidelity gate remains open |
| Synthetic corpus | Renders | Renders | No Hancom visual oracle; useful for regression only |
| CanvasKit | N/A | N/A | Explicitly deferred |

The current corpus proves that both backends can produce pages and that semantic geometry can drive overlays. It
does not prove that either output matches Hancom Office for difficult documents. The critical failures observed in
real use—meaningful clipping, broken boxed tables, caption numbering, and WMF/EMF content—must remain
separate upstream fidelity issues. No CSS or overlay compensation was added.

## SVG vs Canvas2D Performance

### Ignored 301-page local fixture

| Operation | Result |
| --- | ---: |
| Open Canvas Original session | 465.7 ms |
| Open Canvas Modified session | 398.0 ms |
| Open additional SVG diagnostic session | 381.2 ms |
| Original snapshot | 59.5 ms |
| Modified snapshot | 50.8 ms |
| One-change text diff | 18.8 ms |
| Map one change on both sides | 18.9 ms |
| All 301 page sizes | 1.5 ms |
| Four Canvas page descriptors | 0.08 ms, paint excluded |
| Four sanitized SVG pages | 150.5 ms |

The process-memory diagnostic rose from 142.8 MiB RSS to 331.5 MiB while deliberately keeping **three** parsed
sessions alive (two Canvas sessions plus an extra SVG diagnostic session). It is an upper-bound diagnostic, not
the two-session product peak. External/WASM-associated memory rose from 23.5 MiB to 205.3 MiB; this confirms that
document sessions, not only page DOM, require a future physical-PC memory gate.

### Browser/WebView observation

With the same 301-page fixture on both sides and a five-page limit:

- both 301-page scroll geometries existed immediately;
- only three Canvas pages per side were initially materialized; 596 of 602 total page cards remained
  placeholders;
- initial Canvas descriptors took 0.0–0.2 ms and the latest observed Canvas paints took 5.3–6.3 ms;
- sampled initial sanitized SVG pages took 7.2, 10.5, and 34.7 ms;
- six 371 × 524 canvas surfaces occupied about 4.45 MiB of pixel storage;
- full semantic pair analysis of identical large snapshots took about 43–53 ms;
- a same-session reopen reported two snapshot hits and a pair-analysis hit; diff and mapping were 0 ms and pair
  result restoration took about 1.2 ms. Each visual document still has to be parsed to render, so total reopen is
  not yet instant.

These timings were gathered in a development browser and are not directly comparable to a packaged Tauri
WebView on a constrained office PC.

## Analysis Pipeline

The implemented pipeline is:

```text
validate local HWPX
  SHA-256 fingerprint
  open rhwp document session
  document snapshot cache lookup
  build semantic snapshot and complexity profile on miss
  ordered pair cache lookup
  full diff on miss
  eagerly map every Original/Modified anchor
  store session pair result
  READY with final change count
```

Progress state is visible for validation, fingerprinting, document opening, snapshot building, comparison, and
range mapping. React is allowed to paint before synchronous comparison begins, and mapping yields to the event
loop every two changes. After `READY`, the change count is final and Previous/Next navigation uses precomputed
targets.

The per-document cache makes partial reuse possible now: if Original is unchanged and Modified changes, the
Original snapshot is reused, Modified is rebuilt, and only the ordered pair diff/mapping is recomputed.

## Page Virtualization

Every page owns a lightweight card with its rhwp page aspect ratio. The page card remains a placeholder until an
`IntersectionObserver` requests the current page and one neighbor on either side. This preserves full document
scroll height without generating hundreds of SVG strings or canvases.

Change navigation has a separate priority path:

1. request target page ±1;
2. wait for those page descriptors;
3. jump the target page to the center without smooth-scrolling through intermediate pages;
4. paint the existing Lens overlay;
5. let viewport observation maintain the surrounding working set.

The E2E fixture verifies that a change beyond page five can be selected while each viewer retains no more than
five rendered pages and that scrolling produces a real eviction.

## Render Cache

Each viewer has its own LRU page cache. An entry contains the renderer-neutral page result, optional semantic SVG
PoC text data, and page-load duration. In-flight loads are deduplicated, stale results are rejected by generation,
and renderer/session changes clear the cache.

The default is **five pages per document**. The 5/10/20 candidates have the following pixel-surface implications
for two Canvas documents:

| Pages per document | At measured 371 × 524 surface | At illustrative 760 × 1,074 surface |
| ---: | ---: | ---: |
| 5 | about 7.4 MiB | about 31 MiB |
| 10 | about 14.8 MiB | about 62 MiB |
| 20 | about 29.7 MiB | about 125 MiB |

The values exclude parsed documents, images, JS objects, browser compositing, and device-pixel-ratio growth.
Twenty pages therefore consumes too much unproven headroom for two large documents on an 8 GiB office machine.
Five pages covers target ±1 plus a small recent working set and is configurable for continued measurement.

## Analysis Cache

The implemented key model is:

```text
document key = SHA-256(file bytes) + rhwp/snapshot schema identity
pair key = ordered Original key + Modified key + DiffAdapter identity
```

`mtime` and filename are never cache authorities. A content change or analysis-schema change invalidates the
entry. The current LRU stores four document snapshots and four ordered pair results. It is memory-only and is
cleared with the application component.

This cache optimizes repeated semantic analysis but cannot skip `HwpDocument` construction because rendering
and native interaction still require live engine sessions. A true instant reopen would require a public rhwp
serialized-layout/session facility or a secure persistent snapshot plus a separate fast visual-session strategy.

## Large Document Results

The 301-page fixture demonstrates that compressed byte size is a weak complexity signal: the file is only 17.22
MiB but has hundreds of pages and tables. The cheap opening profile records compressed bytes, page count, all
source paragraph count, meaningful snapshot paragraph count, table count, table-cell count, and graphic-control
count. It classifies a document as `HIGH` when any current safety threshold is crossed and adds a large-document
mode message.

Exact image count, encoded image bytes, and largest embedded resource remain nullable. Computing them through
the presently available document queries was not cheap enough for the critical path and could force resource
work the lazy rendering policy is intended to avoid.

No file above 200 MiB and no controlled OOM fixture was available. The current 200 MiB block is a Lens UI guard,
not a discovered rhwp limit. It must not be raised or removed without a separate memory-pressure benchmark.

## Office PC Considerations

The development result is an upper-performance reference only. The release gate still requires a Windows 10/11
physical office machine with 4–6 CPU cores, 8–16 GiB RAM, integrated graphics, and SSD. That run must capture:

- two distinct representative documents rather than the same file twice;
- end-to-end cold load and reopen;
- longest main-thread task and visible progress behavior;
- two-session RSS/private working set and WebView GPU/pixel memory;
- cold and cached far-change navigation;
- sustained scroll frame behavior;
- offline packaged-app execution;
- trusted visual comparison for the known fidelity failures.

CPU throttling can supplement this run but cannot approve the office baseline.

## Offline and Windows Packaging

The production build audit found only local assets and the bundled rhwp WASM binary. The full E2E suite observed
no external HTTP request while loading, comparing, navigating, selecting, and exercising the cache. The Windows
x64 NSIS build also completed successfully and produced the version 0.0.4 installer. No document upload,
telemetry, remote font, remote image, or external API was introduced.

## File Size Limit Assessment

`packages/lens-ui/src/file-validation.ts` owns the current 200 MiB rejection. It predates a measured rhwp memory
ceiling and currently serves as a conservative OOM guard. Because a small compressed file can still be layout
heavy and a large image-heavy file can be cheap to analyze but expensive to decode, size alone should not be the
long-term policy.

Decision: **Keep** the 200 MiB guard temporarily. The desired follow-up is a meeting-approved replacement with a
complexity warning plus measured safety cap, not an unmeasured removal. A warning is already shown for `HIGH`
structural complexity below that cap.

## Security Impact of Cache

Snapshots, normalized paragraphs, change previews, and mapped targets can expose document content or structure.
Persisting them unencrypted would conflict with privacy-sensitive or offline environments. Even a
hash-only index can reveal whether a known document was opened.

The current implementation therefore:

- writes no snapshots, text, changes, fingerprints, filenames, or cache index to disk;
- sends no telemetry or document bytes over the network;
- keeps cache contents only in the LensApp process lifetime;
- bounds the cache and clears references on unmount;
- uses generated performance logs only for explicitly invoked local tests under ignored `test-results/`.

Persistent caching remains optional future work. It requires an explicit security decision covering opt-in or
policy control, encryption and key ownership, cache clear/retention, crash artifacts, backups, and auditability.

## rhwp Upstream Candidates

The existing complex-object fidelity and public interaction candidates remain open. This phase adds local
candidates for a cheap public document-complexity/resource-summary API and a cooperative/worker-friendly large
document open path. The first would avoid iterating page trees or decoding assets for warnings; the second would
let a downstream WebView report progress around synchronous parse work. No upstream issue or PR was created.

The current public page-info API is fast enough: 301 page-size queries took 1.7 ms, so a speculative batch API is
not justified by this evidence.

## Architecture Risks

- Canvas2D and SVG can agree because both consume incorrect shared layout.
- Live rhwp sessions retain substantial WASM/external memory even when page rendering is virtualized.
- Eager location mapping can dominate a pair with hundreds of changes.
- Bounded large-region alignment may misclassify highly repetitive/reordered paragraphs.
- Canvas pixel memory grows quadratically with page display scale/device pixel ratio.
- Session cache references are cleared but JavaScript/WASM memory reclamation timing remains runtime-controlled.
- The current complexity thresholds are engineering starting points, not product policy.
- A route/query parameter is appropriate for PoC selection but not a final renderer fallback UX.

## Recommendation

Choose **B. SVG Default / Canvas2D Experimental** for the next gated phase. Keep the hybrid adapters, eager full
semantic result, lazy visual pages, exact placeholder geometry, five-page-per-document LRU, and memory-only
analysis cache. Do not delete SVG, make Canvas2D default, implement automatic/per-page renderer selection, or
resume image/style feature expansion yet.

The next approval gate is a packaged, offline Office Baseline run with two distinct local documents and trusted
visual references. If Canvas2D passes clipping/table/caption/vector fidelity and native mapping there, prepare a
separate migration plan for **Canvas2D Default / SVG Fallback**. If both backends reproduce the same critical
defects, address or upstream the shared rhwp layout/resource path; do not hide it in Lens overlays.
