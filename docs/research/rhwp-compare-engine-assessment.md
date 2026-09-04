# rhwp Compare Engine Assessment

Date: 2026-09-02

Scope: implementation study only; no Studio source was copied into HWPX Lens.

## Executive Summary

The Studio compare engine is substantially more general than a UI helper. It builds document snapshots, aligns
independently loaded files, compares text and controls, suppresses false movement caused by reflow, and annotates
results with page information. HWPX Lens would be a credible downstream consumer of such a public package.

It is not currently an `@rhwp/core@0.8.4` public API. The implementation imports Studio-local types, aliases,
WasmBridge helpers, and UI/runtime assumptions. HWPX Lens must not copy it or depend on those private paths.

Recommendation: keep the current `DiffAdapter` and propose a public, engine-owned compare package/API upstream.

## Inspected Entry Points

Studio currently exports these module functions from its internal compare implementation:

- `buildSnapshotFromBytes`;
- `buildSnapshotFromWasm`;
- `compareSnapshots`;
- `compareDocuments`.

Their source location under `rhwp-studio/src/compare/` and dependencies on Studio's `WasmBridge` mean that
TypeScript `export` does not make them a supported npm/library surface.

## Snapshot Model

The internal snapshot model includes:

- document metadata and displayed page numbers;
- paragraph text and normalized text;
- paragraph/property signatures;
- global indices and optional stable IDs;
- visual anchors;
- control snapshots for tables, drawings, and images.

This is richer than HWPX Lens M0's intentionally narrow body/table snapshot and would reduce duplicated engine
knowledge if exposed upstream with a stable schema.

## Identity and Alignment Strategies

Two domains are explicitly separated:

- `identity` is intended for revisions from the same document/session when stable IDs are trustworthy;
- `alignment` is the default for independently opened files where stable IDs do not overlap.

If identity is requested but the stable-ID maps are incomplete or ambiguous, the engine falls back to alignment.
That behavior fits HWPX Lens' real use case, where previous/latest documents are usually separate files.

Alignment combines unique/high-quality paragraph anchors with segmented matching. It uses dynamic programming
where the segment and time budget permit, and greedy fallbacks for large or expensive regions. Text similarity,
structure distance, paragraph properties, and control context influence matching.

## Reflow and Page Annotation

The engine contains explicit suppression of movement records caused only by prefix insertion/deletion and
reflow. It also annotates diff items with left/right displayed page information based on the respective document
layouts. Both are directly relevant to side-by-side document review where the same semantic change may move from
one page number to another.

## Control Diff

Tables, drawings, and images are represented as controls and are matched with aligned paragraph context and
visual/identity cues. This is relevant long-term, but the current PoC does not enable table/image/style diff and
does not import any control-diff code.

## Reuse Boundary

Copying the file would create three problems:

1. a large private implementation would diverge from upstream quickly;
2. Studio-local bridge/types would leak across the Lens Adapter boundary;
3. bug fixes and schema changes would not be versioned as a downstream contract.

The acceptable boundary is a public package such as `@rhwp/compare`, or an explicitly supported core API such
as `compareDocuments(a, b, options)` returning a versioned renderer-neutral result. HWPX Lens would consume that
through `DiffAdapter`, preserving the ability to replace it.

## Public API Candidate Requirements

A useful upstream API should:

- accept bytes or documented public document handles;
- support alignment for independent files and identity for same-session history;
- return stable, versioned semantic anchors instead of Studio DOM/UI objects;
- expose performance/anchor tuning with safe defaults;
- keep table/control results optional by feature flag;
- distinguish semantic identity from layout/page annotations;
- run fully offline and without Studio UI dependencies;
- include long-document and reflow regression tests.

## Decision

The engine appears reusable enough to justify an upstream public API proposal. Until such an API exists, HWPX
Lens keeps its own narrow `DiffAdapter` implementation. No Studio code or private import path is added.
