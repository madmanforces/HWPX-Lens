# Public Distribution and Local Profile Policy

## Decision

HWPX Lens publishes one general-document product while allowing an owner to
inject a local-only presentation and taxonomy profile.

| Distribution | Configuration | Repository status |
|---|---|---|
| GitHub/public | Built-in `general` profile | Source, tests, documentation and release installer are public |
| Local validation | JSON supplied with `HWPX_LENS_PROFILE_CONFIG` | Profile file and installer remain Git-ignored |

The public/default build is always `general`. Default commands explicitly clear
`HWPX_LENS_PROFILE_CONFIG`, so an inherited machine environment cannot silently
change a public artifact. Runtime document detection never switches profiles.

## Shared implementation

Parsing, rendering, semantic snapshots, diffing, navigation, Review Ink,
selection, clipboard, virtualization and caches are shared. A local profile
contains presentation terminology and taxonomy policy only.

## Commands

```powershell
npm run build:general
npm run tauri:build:general

# Called only by a local script that sets HWPX_LENS_PROFILE_CONFIG:
npm run build:profile
npm run tauri:build:profile
```

Every build emits `apps/desktop/dist/product-profile.json`; the build command
records both the profile ID and whether the artifact is `public` or `local`.
Release automation must verify `general` + `public` before publication.

## Artifact folders

```text
release/
  general/<version>/
  <local-profile>/<version>/
```

The GitHub repository contains the general source, tests and documentation.
Only `release/general/<version>/` is eligible as a GitHub Release asset; all
other release folders and the entire `private/` tree remain ignored.
