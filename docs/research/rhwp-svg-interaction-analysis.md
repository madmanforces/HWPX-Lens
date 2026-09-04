# rhwp SVG Interaction Analysis

Date: 2026-09-02

Scope: `@rhwp/core@0.8.4` public API only

## Summary

`renderPageSvg()` is suitable as a visual snapshot, but its SVG is not a semantic document tree. Text is
emitted as independently positioned glyph elements and the SVG nodes do not carry paragraph, run, cell,
or character-range identifiers. A separate public API, `getPageTextLayout()`, does expose enough text and
geometry to build an adapter-owned interaction layer without teaching Lens Core about SVG.

## SVG Text Structure

The public one-page fixture produced:

- 17 visible characters;
- 17 `<text>` elements;
- 0 `<tspan>` elements;
- one character per `<text>` element;
- absolute `x` and `y` on every glyph;
- `textLength` plus `lengthAdjust="spacingAndGlyphs"` on every glyph.

A sampled complex page in an ignored local fixture produced 744 `<text>` elements, all single-character,
and 0 `<tspan>` elements. The result is optimized for positioning, not browser reading order or selection.

## DOM Order

On the simple fixture, SVG glyph order matches logical text order after whitespace is removed. On a complex
page containing body text and table content, SVG DOM order does not match the non-whitespace order returned
by `getPageTextLayout()`. Coordinate placement can make the page look correct while DOM selection follows
a different sequence.

## Semantic Metadata

Rendered SVG text nodes contain visual attributes only. They do not contain section, paragraph, run, cell,
or source offsets.

`getPageTextLayout(page)` returns run objects with:

- `text`, `x`, `y`, `w`, `h`;
- `charX`, an X boundary array for character ranges;
- font family, size, emphasis, ratio, spacing, and color;
- `secIdx`, `paraIdx`, and `charStart` for body text;
- `parentParaIdx`, `controlIdx`, `cellIdx`, `cellParaIdx`, and `cellPath` for table text.

Some generated/header/footer runs contain sentinel or body-looking coordinates. The PoC verifies a proposed
body anchor by reading the same range with `getTextRange()` before exposing it through `InteractionAdapter`.
This rejected five false-looking candidates in one 301-page local audit while preserving all real body text.

## Search-to-Layout Mapping

`searchAllText()` returns section, paragraph, character offset, and length for body matches. Those fields can
be matched to the verified `secIdx`/`paraIdx`/`charStart` ranges from `getPageTextLayout()`. Search does not
need to inspect SVG nodes.

## Character Range Geometry

For a range inside one run, the PoC calculates:

1. local start/end offsets from the engine-neutral `BodyTextAnchor`;
2. left/right boundaries from `charX`;
3. page rectangles using run `x`, `y`, and `h`.

Synthetic fixtures showed at most 0.4 page-coordinate units of rounding difference between the reported
run width and the last `charX` boundary. Browser placement of the HTML layer was within 0.04 CSS px of the
expected position in the sampled page; the active change highlight was within 0.05 CSS px.

The existing `getSelectionRects()` API remains useful as a page hint, but not always as exact text geometry.
On an auto-numbered local paragraph, the returned rectangle included the number/indent area and differed
from the actual text-run X coordinate by up to 110 page units. `charX`-based geometry removed that error.

## Table Coordinates

Text layout runs expose public `cellPath` data and visual coordinates, so table-cell semantic mapping is
technically possible inside an adapter. It was not promoted to a product feature in this PoC. SVG nodes do
not expose the cell path directly.

## Page Coordinate System

The SVG `viewBox`, `getPageInfo()` width/height, `getPageTextLayout()` coordinates, and selection rectangles
use the same page coordinate space (approximately 793.7 × 1122.5 for the sampled A4-like pages). The HTML
interaction canvas scales from that coordinate space to the responsive page card.

One local sample returned a `getPageInfo()` payload whose embedded `pageIndex` did not equal the requested
global page index. The PoC therefore trusts the request index and dimensions, not that embedded field.

## Architectural Finding

The viable boundary is:

```text
Lens Core BodyTextAnchor
        ↓
InteractionAdapter
        ↓
rhwp getPageTextLayout / getTextRange / getSelectionRects
```

Lens Core and Lens UI do not traverse rhwp SVG DOM. SVG-specific behavior remains inside the adapter.

## Limitation

This analysis proves that semantic interaction geometry can be derived. It does not improve missing or
incorrect visual content produced by `renderPageSvg()`. Table, caption, vector-image, clipping, and pagination
fidelity remain renderer issues.
