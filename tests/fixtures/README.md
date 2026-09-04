# HWPX test fixture

`body-text-public.hwpx.base64` is a base64 encoding of the small
`samples/누름틀-2024.hwpx` fixture from the rhwp repository. It is used only
for parser, rendering, and coordinate contract tests. The upstream rhwp
repository is licensed under the MIT License.

Tests decode these fixtures in memory; no private user document is checked into
the repository.

The `modified` and `repacked` files are deterministic derivatives of that same
fixture. The modified variant changes its two body paragraphs; the repacked
variant changes only ZIP serialization. Their `mimetype` entry is stored first
and uncompressed as required by HWPX.

`tests/helpers/rhwp-fidelity-fixtures.ts` builds the SVG interaction PoC corpus
in memory from this public seed. It covers simple, wrapped, mixed-font, long,
multi-page, table, merged-table, image-caption, table-caption-surrogate, and
long-document cases without committing another HWPX binary.

Real documents must be placed under the ignored `/local-fixtures/` directory.
The opt-in local audit reads `HWPX_LENS_LOCAL_FIXTURE` and rejects paths outside
that directory.
