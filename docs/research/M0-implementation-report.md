# HWPX Lens M0 implementation report

Date: 2026-09-01

## Outcome

M0 implements an offline Windows compare/review flow for HWPX body paragraph
text. Original and Modified documents render independently, semantic changes
navigate in a shared list, and each selected range is highlighted using public
rhwp selection rectangles.

## Required boundaries

- `lens-core` owns engine-neutral `DiffAdapter` and `RenderingAdapter`
  contracts. It imports no rhwp code or types.
- `hwpx-adapter` is the only package that imports `@rhwp/core@0.8.4`.
- `rhwp-studio` compare source was reference material only. No Studio code or
  private module is copied or imported.
- The only enabled change type is body paragraph text.
- Table, image, style, header/footer, footnote, text box, shape, and control
  comparison remain disabled.

## Implemented M0 sequence

1. npm workspace, React/Vite frontend, Tauri 2 shell, MIT/NOTICE, ignore rules.
2. Locally bundled rhwp WASM and browser text-measurement bridge.
3. Engine-neutral adapters, owned document session, disposal and load errors.
4. HWPX picker/drop loading, extension/size/ZIP validation, memory-only names.
5. Independent viewers, lazy page rendering, loading/error/empty states.
6. Normalized body paragraph alignment and added/removed/modified text changes.
7. Character anchors mapped with public `getSelectionRects()` coordinates.
8. Change list, previous/next navigation, scroll targeting, active overlays.
9. CSP, SVG sanitization, local-asset audit, license inventory and notices.
10. Public fixture regression, adapter contract, browser E2E, release and NSIS.

## Verification evidence

- `npm audit --audit-level=high`: 0 vulnerabilities.
- `npm run verify`: passed.
- Vitest: 4 files, 16 tests passed.
- Playwright: file selection + drag/drop + two changes + two highlights +
  navigation + disabled scope + zero external requests passed.
- In-app browser visual QA: independent viewers, page scale, change scrolling,
  contextual and exact highlights; zero console warnings/errors.
- `cargo fmt --check` and `cargo check --locked`: passed.
- Windows release executable stayed alive through a five-second smoke test.
- Tauri generated one x64 NSIS bundle.
- Windows Cargo graph: 259 locked packages, 0 missing SPDX license values.

## Known M0 limitations

- Layout can differ from Hancom Office when document fonts are unavailable.
- Long documents still parse/layout on the UI thread; correctness was prioritized
  over worker/virtualization work in M0.
- Duplicate short paragraphs can reduce alignment confidence.
- The development installer is not code-signed.
- Table/image/style comparison requires a separately approved milestone.

## M0.11 complex-document rendering compatibility

`rhwp` may emit legacy HWPX pictures as nested `data:image/svg+xml` references.
The initial fail-closed sanitizer removed those references, which left empty
picture frames in complex documents even though ordinary raster pictures rendered.

M0.11 keeps the existing `RenderingAdapter` boundary and text-only `DiffAdapter`
scope. The adapter now decodes embedded SVG locally, rejects DTD/entity input,
recursively applies the untrusted-SVG sanitizer, enforces per-image/per-page
byte, element, and nesting budgets, and re-encodes only accepted output.

Local user-authorized verification used two untracked documents without recording
their contents:

- 311-page local document A: 108/108 embedded SVG image occurrences retained
- 301-page local document B: 100/100 image occurrences retained, including 11 SVG
- all 612 pages rendered with zero blocked images and zero page errors
- UI still reported 627 body-text changes; table/image/style comparison remained
  disabled

The real files remain outside the repository. Tracked regression tests use only
synthetic SVG payloads covering scripts, foreign objects, remote URLs, DTDs,
malformed data, byte limits, and recursion depth.

### M0.11 Windows artifact

- Version: `0.0.2`
- Bundle: `HWPX Lens_0.0.2_x64-setup.exe`
- Size: 3,648,905 bytes
- SHA-256: `D3512AE93C9917F23C675BE3EBFE4D0B570742004E0F1CE88A365030AD00E381`
- Signature: unsigned development build
- Release executable: five-second launch smoke test passed without early exit

## Rebuild

```powershell
npm install
npm run verify
npm run test:e2e
npm run tauri:build
```

The current host uses Rust 1.98.0 with the x86_64 MSVC toolchain.
