# Changelog

## 0.1.0 — First Public Alpha candidate

- Added compact `Structure` / `Changes` review workspace and section scoping.
- Added renderer-neutral table-cell and image Review Ink.
- Added `IMAGE_ADDED`, `IMAGE_REMOVED`, and `IMAGE_CHANGED` semantics backed by
  original resource SHA-256 and visual-render metadata.
- Added detachable Review Workspace using a shared analysis session.
- Added a GitHub-safe general-document distribution; private taxonomy profiles
  and their installers are supplied only from Git-ignored local configuration.
- Preserved SVG as the default renderer, Canvas2D as experimental, local-only
  processing, selection/copy behavior, virtualization, and in-memory caches.
- Kept style diff, editing, AI, cloud, accounts, and collaboration out of scope.

Manual fidelity validation on representative HWPX pairs remains required
before any public release.
