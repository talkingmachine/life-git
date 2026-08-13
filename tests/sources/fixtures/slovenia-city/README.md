# Slovenia city source feasibility fixtures

These fixtures support the fail-closed source audit in
`docs/changes/active/vs-4a-city-frontier/source-field-map.md`. They do not install a production
city package and do not turn an unavailable criterion into a verified fact.

Every source directory distinguishes five classes explicitly:

- `official`: exact or newline-normalized public authority bytes;
- `normalized-official`: an official payload with a declared encoding, formatting or field-only
  normalization; its raw transport hash is retained separately;
- `redacted-derived`: a projection or aggregate computed from captured official bytes, with the
  raw artifact hash retained in the manifest;
- `synthetic`: invented boundary rows containing no real case, person, address or property ID.
- `generated-request`: a deterministic public API request body, containing no source observation.

Large archives, geometries, addresses, free-text notes, case descriptions, person rows and source
credentials are intentionally excluded. Source URLs, capture dates, raw artifact hashes and
transformations are recorded beside each fixture.

The package remains `unavailable`: the official catalog source contract is now reproducible, but
the current Police numerator was not captured and is overdue; AKOS does not expose a proven source
reference period and its production reuse license is unproved; and the nationwide DUJPP feed alone
cannot prove complete coverage of the approved municipal urban-transit definition.

`SHA256SUMS` binds every committed fixture byte except itself. Each manifest separately records raw
transport or source-artifact hashes and transformations, so normalized/derived bytes are never
passed off as the original response.
