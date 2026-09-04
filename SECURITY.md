# Security policy

HWPX Lens is currently a private Public Alpha candidate and has no public
release channel. Do not attach private or business HWPX documents to reports.

For a suspected vulnerability, record only a synthetic reproduction under the
tracked test fixtures. Keep sensitive details in the ignored `private/`
directory until the project owner chooses a private reporting channel.

The application processes selected files locally, sanitizes generated SVG,
and is expected to make no runtime network requests. Persistent document-content
caching and telemetry are not enabled. Run `npm run verify`, `npm run test:e2e`,
and the public-repository audit before distributing a build.
