# ADR-0001: Isolate rhwp behind HWPX Lens adapters

Status: Accepted for M0

Date: 2026-09-01

## Decision

HWPX Lens Core owns engine-neutral `DiffAdapter` and `RenderingAdapter`
contracts. Only `packages/hwpx-adapter` may import `@rhwp/core` or handle its
WASM document objects and JSON responses.

The M0 diff implementation reads public body paragraph APIs and performs its
own limited text alignment. The `rhwp-studio` compare engine is reference
material only: its code is not copied and its private modules are not imported.

## M0 capability boundary

Supported:

- Body paragraph additions, removals, and modifications
- Character-range mapping to public selection rectangles
- Page SVG rendering and side-by-side navigation

Explicitly disabled:

- Table and table-cell comparison
- Image comparison
- Style and formatting comparison
- Header, footer, footnote, text box, shape, and other control comparison

These disabled capabilities require a separate post-M0 milestone and decision.

## Consequences

- A future engine can implement the two contracts without changing Lens Core or
  the review UI.
- Pre-1.0 rhwp API changes remain inside one package and are guarded by adapter
  contract tests.
- The M0 matcher stays deliberately smaller than the full rhwp Studio compare
  implementation.
