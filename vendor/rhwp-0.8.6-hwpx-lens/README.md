# rhwp 0.8.6 temporary WASM patch

This directory contains the temporary HWPX Lens runtime patch for
`@rhwp/core@0.8.6`. The JavaScript and TypeScript public API continues to come
from the published npm package; only the ABI-compatible WASM binary is replaced.

- Upstream repository: `https://github.com/edwardkim/rhwp`
- Base tag: `v0.8.6`
- Base commit: `f1f9c6ae58344ee9368996d3543f76b9345cf227`
- Patch: `caption-autonum.patch`
- WASM SHA-256: `58F3465C5EC679367AF93EC3E280418BB89BD4BF3EA3BD007251DF5E6FBE8EB9`
- Build command: `scripts/wasm-pack-locked.ps1 --target web --out-dir pkg`

The patch replaces a caption AutoNumber placeholder by its semantic control
position instead of searching for a literal two-space pattern. It preserves the
raw model character axis by writing only `display_text`.

Remove this directory and restore the npm WASM import after an upstream release
contains the same regression fix. This is not a permanent rhwp fork.
