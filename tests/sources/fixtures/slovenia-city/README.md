# Slovenia city source feasibility fixtures

These fixtures support the fail-closed source audit in
`docs/changes/active/vs-4a-city-frontier/source-field-map.md`. They do not install a production
city package and do not turn an unavailable criterion into a verified fact.

Every source directory distinguishes six classes explicitly:

- `official`: exact or newline-normalized public authority bytes;
- `normalized-official`: an official payload with a declared encoding, formatting or field-only
  normalization; its raw transport hash is retained separately;
- `redacted-derived`: a projection or aggregate computed from captured official bytes, with the
  raw artifact hash retained in the manifest;
- `synthetic`: invented boundary rows containing no real case, person, address or property ID;
- `generated-request`: a deterministic public API request body, containing no source observation;
- `unavailable_projection`: a fail-closed status/provenance contract that explicitly contains no
  captured official result and cannot be published as a fact.

Large archives, geometries, addresses, free-text notes, case descriptions, person rows and source
credentials are intentionally excluded. Source URLs, capture dates, raw artifact hashes and
transformations are recorded beside each fixture.

The package remains `unavailable`. Safety now has a closed contract for an official
municipality/Police/SURS source plan and therefore reaches
`candidate_available_with_partial_official_coverage`, but no installed plan, fresh exact
catalog-member numerator or same-year municipality denominator result is hash-bound here. The new
broad-scope and SURS files are explicitly unavailable projections or generated validator contracts,
not verified facts. AKOS still lacks a proven source reference period/reuse license, and nationwide
DUJPP alone cannot prove complete coverage of the municipal urban-transit definition.

`SHA256SUMS` binds every committed fixture byte except itself. Each manifest separately records raw
transport or source-artifact hashes and transformations, so normalized/derived bytes are never
passed off as the original response.
