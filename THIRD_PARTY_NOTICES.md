# Third-party notices

This document covers dependencies included in the HWPX Lens Public Alpha runtime.
Development and test tools are not shipped in the application bundle.

## @rhwp/core 0.8.6

- Copyright: Edward Kim and rhwp contributors
- License: MIT
- Source: https://github.com/edwardkim/rhwp

The bundled `rhwp_bg.wasm` and JavaScript bindings are used through the public
`@rhwp/core` API. No source from the rhwp Studio compare engine is included.

## React 19.1.1, React DOM 19.1.1, and Scheduler

- Copyright: Meta Platforms, Inc. and affiliates
- License: MIT
- Source: https://github.com/facebook/react

## fflate 0.8.2

- Copyright: Arjun Barrett
- License: MIT
- Source: https://github.com/101arrowz/fflate

Only HWPX section XML entries are decompressed to index the source image-to-caption
relationship that is not exposed by the current `@rhwp/core` picture query.

## Tauri 2 and @tauri-apps/api 2.11.1

- Copyright: Tauri Programme within The Commons Conservancy
- License: Apache-2.0 OR MIT
- Source: https://github.com/tauri-apps/tauri

The complete MIT license text is included in the root `LICENSE` file. Additional
texts required by the locked Windows dependency graph are bundled from the
`licenses/` directory: Apache-2.0, MPL-2.0, Unicode-3.0, BSD-3-Clause, and Zlib.
The complete Windows package inventory and SPDX audit are recorded in
`docs/research/M0-rust-license-audit.md`.
