# M0 security and offline model

## Local-only document handling

- HWPX bytes are obtained from browser file inputs or drag-and-drop.
- File contents and names remain in memory and are never written, uploaded, or
  logged persistently by HWPX Lens.
- Runtime dependencies, including `rhwp_bg.wasm`, are bundled as local assets.
- Production CSP limits connections to the application origin and Tauri IPC.

## Untrusted rendering output

SVG returned by the document engine is treated as untrusted. Before insertion,
the adapter removes scripts, foreign objects, embedded documents, animation,
event-handler attributes, executable URLs, and remote resource references.

`rhwp` can represent legacy document pictures as nested `data:image/svg+xml`
images. HWPX Lens decodes those images locally, rejects DTD/entity declarations,
recursively applies the same sanitizer, enforces byte/element/depth budgets, and
only then re-encodes them. A nested image that fails any check remains blocked;
raw embedded SVG is never accepted directly.

## Scope reduction

M0 reads body paragraph text only. Table, image, style, and control comparison
paths are not exposed through the UI or the `DiffAdapter` capability list.

## Verification

- Boundary audit rejects rhwp imports outside the adapter package.
- Build audit rejects literal remote assets and verifies that one local WASM
  binary is emitted.
- Browser E2E records any runtime network request outside the local test origin.
- Ignore audit rejects tracked local meeting, candidate, and private fixture data.
