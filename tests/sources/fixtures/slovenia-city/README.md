# Slovenia city source feasibility fixtures

These fixtures support the fail-closed source audit in
`docs/changes/active/vs-4a-city-frontier/source-field-map.md`. A complete source contract closes a
city fact as `verified | unknown`; these fixtures do not seal the artifact package or publish a
production city package.

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

`sourceContractStatus = bounded_verified_or_unknown`; `artifactInstallability =
not_installable_artifacts_unsealed`; `publicationStatus = not_published`; and `decision =
PROCEED_WITH_TASK_6; PUBLICATION_PENDING_ARTIFACTS`. The fresh `city-catalog@2` 100-member summary,
all 104 Registry point-on-surface projections and selected-member per-fact source-plan artifacts
remain unsealed. The legacy ten-member catalog and candidate-only safety fixtures are not those
artifacts. Safety is a candidate-only municipality/Police/SURS contract here: no installed plan,
fresh exact catalog-member numerator or same-year municipality denominator result is hash-bound. The
broad-scope and SURS files are unavailable projections or generated validator contracts, not verified
facts. AKOS reference-period/reuse limitations and DUJPP municipal-universe limitations are reasons
their facts close to unknown; additional AKOS or NAP evidence may improve a yellow fact to verified,
not unblock Task 6.

`SHA256SUMS` binds every committed fixture byte except itself. Each manifest separately records raw
transport or source-artifact hashes and transformations, so normalized/derived bytes are never
passed off as the original response.
