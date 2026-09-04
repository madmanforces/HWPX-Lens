# HWPX Lens

HWPX Lens is an offline-first Windows desktop application for comparing two
HWPX documents in their rendered page layout. It finds semantic text, outline,
table-cell/structure, and image changes, then navigates both sides to the real
document position with non-destructive Review Ink.

The current codebase is the v0.1.0 First Public Alpha candidate. The GitHub
repository and installer release remain private until the owner completes the
manual document checks in `Manual Validation Required.txt`.

## Public Alpha scope

- Side-by-side local HWPX rendering with eager analysis and lazy page rendering
- Merged `Structure` tree plus scoped `Changes` workflow
- Character-level text Review Ink and Korean spacing proof marks
- Cell-level table changes with safe whole-table structure fallback
- Image added/removed/changed detection using original resource SHA-256
- Detachable Review Workspace sharing the existing in-memory analysis session
- SVG default renderer; Canvas2D remains an experimental diagnostic path

Style diff, editing, accept/reject, AI, cloud, accounts, and collaboration are
not part of this alpha.

## Product profiles

The GitHub repository and its default build contain the general-document
product. All table-shaped content uses the standard table category.

Private deployments may inject a local presentation/taxonomy profile from a
Git-ignored JSON file. No private profile definition or private installer is
stored in the public repository. Parsing, rendering, semantic snapshots,
diffing, navigation, Review Ink, and caches remain shared. The default commands
explicitly clear local profile configuration before producing a public build.

## Architecture

- `packages/lens-core`: engine-neutral snapshots, changes, adapter contracts,
  and text/outline/table/image alignment algorithms.
- `packages/hwpx-adapter`: the only package allowed to import `@rhwp/core`.
- `packages/lens-ui`: React review workflow that depends on adapter contracts,
  never on rhwp APIs.
- `apps/desktop`: Vite frontend and Tauri 2 shell composition root.

## Development

```powershell
npm install
npm run dev                 # general, GitHub-safe default
npm run verify
npm run test:e2e
```

The Tauri commands additionally require the Rust toolchain and Windows WebView2
build prerequisites:

```powershell
npm run tauri:dev           # general
npm run tauri:build         # general
```

The generic `*:profile` commands exist for locally managed profile files. Keep
those files under ignored `private/` storage; see the profile build policy.

All runtime assets, including the rhwp WASM binary, are included in the Vite
build. The production application is designed to issue no network requests.

v0.0.7 and later temporarily carry an ABI-compatible `@rhwp/core@0.8.6` WASM
patch for caption AutoNumber rendering. `npm run build` verifies and prepares
that local runtime automatically; provenance, checksum, license, and the
upstream-ready text patch are in `vendor/rhwp-0.8.6-hwpx-lens/`.

## Privacy and fixtures

Real business documents belong only in ignored `local-fixtures/`. Never add
them, their screenshots, or identifying text to Git. Public regression tests
use synthetic/base64 fixtures under `tests/fixtures/`. Analysis caches are
in-memory and are cleared with the application session.

See `CONTRIBUTING.md`, `SECURITY.md`, and `THIRD_PARTY_NOTICES.md` before
sharing source or a build.
