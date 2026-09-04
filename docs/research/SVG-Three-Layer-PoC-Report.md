# SVG Three-Layer PoC Report

Date: 2026-09-02

Branch: `codex/svg-three-layer-poc`

Renderer: `@rhwp/core@0.8.4`

# Executive Summary

The semantic interaction experiment works technically, but the proposed architecture does not satisfy the
product gate as a whole.

- A public-API-only `InteractionAdapter` can create selectable HTML text from rhwp page-layout runs.
- Character-range highlights align accurately with the visual page.
- A 301-page ignored local fixture produced 100% semantic coverage of 126,788 meaningful body characters,
  with zero verified anchor mismatches.
- The semantic layer does not fix the already reproduced renderer failures: clipped/missing visual content,
  broken and boxed tables, caption numbering, and WMF/EMF placement/conversion.

Decision: **C. Reject SVG Three-Layer Architecture as the shipping primary-view architecture and evaluate an
alternative renderer.** Keep this PoC as evidence and as a possible interaction technique for a future hybrid,
but do not extend product features on top of the current SVG visual layer.

## Current rhwp SVG Structure

rhwp emits one absolutely positioned `<text>` element per visible character, with no `<tspan>` grouping and
no paragraph/run/cell source metadata on the SVG node. A simple 17-character fixture produced 17 `<text>`
elements. A complex local page produced 744 single-character `<text>` elements and no `<tspan>` elements.

The separate public `getPageTextLayout()` API provides run text, source offsets, cell paths, fonts, rectangles,
and character X boundaries. This API—not SVG traversal—is the viable semantic source.

## Copy/Paste Root Cause

Browser selection sees hundreds of independent SVG glyph nodes. Depending on the WebView path, copying them
adds unwanted line breaks or follows SVG DOM order rather than reading order. On a sampled complex local page,
the non-whitespace SVG DOM sequence differed from `getPageTextLayout()` order.

The PoC copies from logical HTML runs and inserts line breaks only between semantic blocks. Korean split-run,
paragraph-boundary, and partial-range tests pass.

## Three-Layer Architecture

```text
Visual Layer        rhwp sanitized SVG (unchanged)
Interaction Layer   transparent HTML run spans from InteractionAdapter
Overlay Layer       independent SVG highlight rectangles
```

The default M0 path remains unchanged. The experiment is enabled only through the separate
`createRhwpInteractionPocDocument()` entry point and `?semantic-poc=1`. Lens Core contains engine-neutral
types only; rhwp calls and field normalization remain in `packages/hwpx-adapter`.

## Semantic Text Layer Result

Pass at the adapter/DOM level:

- visual/style fragments preserve logical paragraph membership;
- public body anchors are verified against `getTextRange()` before exposure;
- table runs are retained for logical copy but not promoted to a table-diff feature;
- SVG pointer selection is disabled only in PoC mode;
- the visible document remains the original SVG.

Native mouse-drag could not be automatically asserted because the selected browser-control surface failed to
synthesize native text selection even on an ordinary HTML heading. This is a test-surface limitation, not a
claimed shipping pass. A physical mouse and Notepad validation remains mandatory if this technique is reused.

## Highlight Result

`InteractionAdapter.resolveTextTarget()` intersects a `BodyTextAnchor` range with layout runs and uses `charX`
boundaries. It does not mutate SVG elements.

On the public modified fixture, the HTML run containing the changed Korean range and its overlay rectangle
differed by at most:

- X: 0.008 CSS px;
- Y: 0.031 CSS px;
- width: 0.047 CSS px;
- height: 0.005 CSS px.

This is visually negligible in the tested page.

## Geometry Accuracy

Public fixture HTML-placement measurements:

| Dimension | Mean error | Maximum error |
| --- | ---: | ---: |
| X | 0.0044 CSS px | 0.0044 CSS px |
| Y | 0.0341 CSS px | 0.0372 CSS px |
| Width | 0.000007 CSS px | 0.000011 CSS px |
| Height | 0.0030 CSS px | 0.0030 CSS px |

Across the synthetic corpus, `charX` and run-width rounding differed by no more than 0.4 page units.

The older `getSelectionRects()` geometry is not exact enough for all text. An auto-numbered local paragraph
included the numbering/indent region and differed from the text-layout X coordinate by up to 110 page units.
The PoC uses it only to find candidate pages, then calculates the highlight from `charX`.

## Renderer Fidelity Findings

Scoring: 5 = automated strong pass, 3 = structural/smoke pass only, 1 = observed failure, 0 = unavailable.

| Fixture | Text completeness | Ordering/copy model | Page visual | Object fidelity | Mapping/highlight | Notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| simple-paragraph | 5 | 5 | 3 | n/a | 5 | Public synthetic |
| multiline-paragraph | 5 | 5 | 3 | n/a | 5 | Wrapped runs map exactly |
| mixed-font | 5 | 5 | 3 | 3 | 5 | Two existing public char shapes |
| long-paragraph | 5 | 5 | 3 | n/a | 5 | Two pages |
| multi-page-text | 5 | 5 | 3 | n/a | 5 | Four pages |
| simple-table | 5 | 5 | 3 | 3 | 5 | Cell runs present; no reference raster |
| merged-table | 5 | 5 | 3 | 3 | 5 | Smoke only; complex production tables still fail |
| image-caption | 5 | 5 | 3 | 3 | 5 | Simple PNG/caption only |
| table-caption | 5 | 5 | 3 | 0 | 5 | Native caption creation unavailable; plain visual surrogate used |
| long-document | 5 | 5 | 3 | n/a | 5 | 12 synthetic pages |
| ignored real local fixture | 5 semantic / 1 visual | 3 | 1 | 1 | 5 sampled | Clipping, tables, captions, and vector images remain unreliable |

The synthetic visual score is capped at 3 because no Hancom reference raster was available. Opening/rendering
without an exception is not proof of visual fidelity.

The mandatory **visual content completeness** gate fails: real target documents repeatedly show clipped or
missing content even though the semantic text remains extractable. A transparent text layer cannot make hidden
or incorrectly placed SVG content trustworthy.

## Performance

Indicative local measurements, not a formal benchmark:

- 301-page local fixture: 26,361 semantic runs; page-layout median 2.089 ms, p95 3.911 ms, max 25.423 ms;
- full local semantic audit plus sampled rendering: about 1.57 seconds;
- 12-page synthetic long document: 1,982 mapped body runs; all-page semantic layout about 154 ms;
- the UI continues to lazy-load pages near the viewport.

The semantic layer is not the main performance blocker. Whole-page SVG rendering and existing long-document
text comparison remain larger costs.

## Offline Verification

The PoC adds no network dependency and uses the packaged WASM/public APIs. Build output passes the static
offline audit, and the browser PoC ran from localhost with the application's OFFLINE state. The existing M0
offline boundary remains intact.

A final installed-app restart with the physical network disconnected was not repeated in this PoC; that is a
release gate, not evidence needed to reverse the architecture rejection.

## Failure Cases

1. Real document SVG content can be clipped or omitted.
2. Complex, merged, and boxed tables can render incorrectly.
3. Figure/table caption numbering can be absent or displaced.
4. WMF/EMF content can be broken even when the sanitizer preserves the rendered image node.
5. Native table-caption fixture creation is not available through the tested public API; `attachCaptionAt()`
   rejects a table as not being a drawing object.
6. Generated/header/footer runs can expose source-looking coordinates that are not body anchors; validation is
   required.
7. Cross-page native selection conflicts with lazy page loading.
8. A future document re-save can change positional section/paragraph addresses; stable semantic identity is not
   guaranteed by SVG.

## Upstream PR Candidates

Recorded locally under `prCandidates/rhwp/`:

- logical run grouping or a semantic selection/copy API;
- semantic IDs/source types on page-layout output;
- exact range geometry and unambiguous page indices;
- native table-caption creation/inspection support;
- synthetic renderer regressions for tables, captions, boxed tables, clipping, and WMF/EMF.

No external issue or PR was created.

## Architecture Risks

- Two text layout systems must remain aligned at every zoom and font fallback.
- Invisible DOM duplicates document text and adds selection-order maintenance.
- Generated content, captions, headers, footers, and nested cells need richer source typing.
- Renderer bugs remain visible even when semantic mapping is perfect.
- Fixing interaction can create false confidence in visually incorrect pages.
- A hybrid renderer could introduce new pagination and coordinate drift unless one engine owns page geometry.

## Recommendation

**C. Reject SVG Three-Layer Architecture and evaluate an alternative renderer.**

More precisely:

- reject the current rhwp SVG output as the authoritative shipping visual layer for target documents;
- keep `RenderingAdapter`, `DiffAdapter`, and the new experimental `InteractionAdapter` boundary;
- preserve rhwp as a possible parser/semantic source while renderer alternatives are evaluated;
- do not start additional table/image/style product work;
- do not merge the opt-in PoC into the default product path;
- decide the alternative-renderer or hybrid-renderer strategy in `meetingForGpt/rendering/` before further feature
  implementation.
