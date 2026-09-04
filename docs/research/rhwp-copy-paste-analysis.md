# rhwp Copy/Paste Analysis

Date: 2026-09-02

Scope: `@rhwp/core@0.8.4` public SVG output

## Root Cause

The copy failure is structural. `renderPageSvg()` emits each visible character as a separate, absolutely
positioned `<text>` element rather than logical paragraph/run nodes. Chromium/WebView selection serializes
those independent elements according to SVG DOM behavior, which can insert line breaks between glyphs or
follow a non-reading-order sequence.

This matches the reported result where a horizontal Korean sentence pastes one character per line. It is not
caused by the HWPX Lens sanitizer: raw and sanitized SVG preserve the same text element structure.

## Evidence

| Sample | Visible SVG text elements | Single-character elements | `<tspan>` | DOM/logical order |
| --- | ---: | ---: | ---: | --- |
| Public one-page fixture | 17 | 17 | 0 | Matches after whitespace removal |
| Complex ignored local page | 744 | 744 | 0 | Does not match text-layout order |

The public search API returns logical source offsets, but those offsets are not attached to SVG elements.

## PoC Approach

The PoC disables pointer selection on the visual SVG and overlays transparent HTML spans built from
`getPageTextLayout()` runs. The spans retain logical text and adapter-normalized block identifiers while their
positions are scaled into the same page coordinate system.

The `copy` handler writes `text/plain` from the logical run sequence:

- visual/style fragments in the same paragraph are concatenated;
- different logical paragraphs are separated by CRLF;
- partial start/end character offsets are preserved;
- no text is read back from SVG DOM.

Unit tests cover a Korean sentence split across visual runs, paragraph boundaries, and a partial Korean range.

## Selection Finding

Standard selectable HTML is materially better suited to selection than glyph-level SVG. The in-app browser
automation surface used for the PoC could not synthesize native text selection even on an ordinary page
heading, so automated mouse-drag evidence is not reliable. DOM geometry, Range-to-plain-text behavior, and
copy serialization were verified; a final physical mouse/Notepad check would still be required for a shipping
implementation.

## Complexity Assessment

The logical copy override is small and adapter-independent. It is not enough by itself to approve the overall
three-layer architecture because:

- native selection appearance still depends on transparent font metrics;
- cross-page selection conflicts with lazy page loading;
- generated/header/footer/table reading order needs more source typing;
- it cannot repair renderer clipping, captions, tables, or vector images.

## Conclusion

The one-character-per-line problem originates in the SVG structure. A semantic HTML layer can normalize
plain-text copy without modifying SVG, but this is an interaction remedy only—not a renderer fidelity remedy.
