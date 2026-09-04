# Changelog

## 0.1.1 — Change Set JSON export

- Added a generic, deterministic Change Set JSON contract backed by the same
  canonical changes used by Review Ink.
- Added full outline mapping coverage, typed text/outline/table/image data,
  semantic anchors, full outline paths, content fingerprints, and confidence.
- Added deterministic raw-file comparison identity and UTF-8/LF serialization.
- Added a local desktop save flow with a clear content-sensitivity warning.
- Added Draft 2020-12 schema, cross-reference/integrity validation, negative
  contract tests, deterministic repeat-export tests, and offline E2E coverage.
- Unified the Review Workspace collapse/detach action styling and verified the
  compact collapse-and-restore interaction.
- Preserved renderer, comparison, Review Ink, navigation, virtualization,
  in-memory cache, general product profile, and offline boundaries.

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
