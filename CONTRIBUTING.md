# Contributing to HWPX Lens

HWPX Lens is local-first document review software. Fidelity and document
privacy take priority over feature count.

## Before a change

- Preserve the `DocumentAdapter`, `RenderingAdapter`, `InteractionAdapter`, and
  `DiffAdapter` boundaries.
- Use only public `rhwp` APIs. Do not copy `rhwp-studio` implementation code or
  import its private modules.
- Do not add real business documents, screenshots, filenames, or identifying
  text. Put private validation files only in ignored `local-fixtures/`.
- Build minimal synthetic fixtures for regressions.

## Verification

```powershell
npm install
npm run verify
npm run test:e2e
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

For renderer or interaction changes, also run the applicable local-only test
with `HWPX_LENS_LOCAL_FIXTURE` set to a file under `local-fixtures/`. Never
commit the resulting document or generated evidence.

## Change policy

- Fidelity fixes must identify whether ownership is Lens integration, adapter,
  renderer backend, or shared `rhwp` layout.
- Upstream candidates belong in ignored `prCandidates/rhwp/`; architecture
  decisions belong in ignored `meetingForGpt/`.
- Do not create an external issue, pull request, public repository, or public
  release automatically.
