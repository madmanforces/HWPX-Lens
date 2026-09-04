# Change Set contract fixture

The executable full-contract fixture lives in
`packages/lens-core/src/change-set.test.ts`. It constructs synthetic previous
and latest snapshots with text, outline, merged-cell-capable table metadata,
image metadata, full outline paths, and moved-plus-modified outline mapping.

Keeping the fixture as source data instead of a copied generated JSON prevents
the example from silently drifting away from the serializer. The test performs
both positive Draft 2020-12 validation and explicit negative mutations for
roles, hashes, IDs, enums, side nullability, relations, indexes, spans,
similarity, required fields, and non-JSON payload values.

No real document text, binary resource, local path, or private profile data is
stored here.
