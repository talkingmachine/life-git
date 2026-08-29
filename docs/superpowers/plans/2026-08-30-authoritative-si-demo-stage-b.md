# Authoritative Slovenia demo package and local Codex Stage B

> Status: implementation plan approved by the user on 2026-08-30. Execute immediately after the
> plan checkpoint. This is a GREEN catch-up plan: add RED only for a production ambiguity or an
> executable break found while building the vertical.

## Goal

Deliver one honest local Ljubljana recovery and then expand the same package to the five selected
Slovenia demo cities:

```text
explicit local beta package
  -> independently sealed official authority and source plans
  -> verified historical Ljubljana safety source
  -> stale/broken effective source
  -> gpt-5.4 medium native-search candidate hints
  -> target-city publisher + capture + deterministic parser gates
  -> one SQLite Evidence -> Knowledge -> Frontier -> SourceBinding transaction
  -> repeat uses the replacement first
  -> sanitized owner report and direct verified public source link
```

The full production `si-city-package@1` remains unavailable until its separately approved
104-entry Registry, at-most-100 Catalog and per-member plans are sealed. Existing feasibility
fixtures remain non-installable. This plan introduces a distinct local-beta package identity whose
Catalog openly records `official_universe_partial`; it does not relabel the subjective demo seed or
claim national catalog completeness. The seed supplies job IDs only. Every installed fact, host,
capture, parser result and source replacement still needs official evidence.

## Non-negotiable boundaries

- Git and GitHub only. No Arc, Tracker, Arcanum or Yandex infrastructure.
- No browser automation. Live search uses only the reviewed local Codex runtime; official capture
  uses the existing bounded source gateway.
- Models remain fixed: Terra `low -> medium` for bounded extraction and `gpt-5.4 medium` for direct
  native-search discovery. No caller/environment override and no higher effort.
- Model/search output is an untrusted hint. It cannot add a publisher, host, delegation, parser,
  package, manifest, source version, fact, verdict or durable row.
- Package, manifest, authority directory, source plan, effective binding and policy versions are
  independently replayed before model/network/write.
- Direct discovery candidates are accepted only for a publisher explicitly listed in the target
  city source-plan entry and only on that publisher's `allowedHosts`. A delegated document host is
  reachable only after a captured trusted first-party link or redirect; it is never an independent
  direct candidate authority.
- A newly discovered official host remains yellow until an independently reviewed package/
  authority-directory revision installs it. The model never mutates authority.
- Green/red require verified Evidence. Technical failure, honest exhaustion or unavailable current
  source is yellow; yellow never mutates Evidence, Knowledge, Frontier or SourceBinding.
- Successful recovery is one immediate transaction across Evidence, Knowledge, Frontier,
  SourceVersion, SourceBinding CAS, audit and replacement event. Abort/lost ownership means no late
  truth write.
- Preserve historical `@1/@2`, reject unknown `@999`, retain legitimate ordinal 999, and keep public
  DTOs closed, owned, frozen and confidentiality-safe.
- `dev-llm` and the external API provider remain backlog-only.

## Current-state ruling

- M1-M6 recovery, persistence, event/public projection and source-observation boundaries are already
  implemented and offline green.
- Stage A is complete at checkpoint `773cc42`: 275 focused tests, 3901 full tests and three
  consecutive live PASS runs on the unchanged checkpoint.
- Production Slovenia readiness and behavior/default registries are intentionally empty. The
  existing catalog/safety fixtures explicitly state `installationAuthorized: false` and cannot be
  promoted.
- There is no production `CitySourceInstalledAuthorityPort`, no real fixed-route beta composition,
  and no Stage B evaluator.
- Risk review found two Important admission gaps: another municipality in the global directory can
  currently match a candidate, and a delegated host can currently be admitted as a direct candidate.
  These block Stage B and are the first implementation milestone.

## Milestone 8A — target-city candidate admission

Files:

- modify `src/application/city-safety-contracts.ts`;
- modify `src/application/run-city-safety-discovery.ts`;
- modify `src/infrastructure/sources/slovenia-city-safety-adapter.ts`;
- update only focused cases in `tests/integration/city-safety-discovery.test.ts` and
  `tests/sources/slovenia-city-safety.test.ts`.

Implementation:

1. Carry the installed source-plan entry's exact `publisherIds` into every candidate inspection.
2. Reconstruct/freeze that set and require one matching publisher inside the set. Matching a global
   directory publisher outside the target entry is `authority_untrusted` before capture.
3. Split direct-host admission from navigation-host admission. The initial URL must match
   `allowedHosts`; `delegatedDocumentHosts` are accepted only after a retained first-party
   redirect/confirmed-document edge.
4. Keep prior/configured/discovered candidates on the same adapter rule; do not duplicate the
   lower-layer capture or parser semantics in Application.

Focused REDs are justified by the discovered ambiguity:

- an otherwise valid Maribor municipality URL cannot be inspected for Ljubljana;
- a direct delegated-document URL cannot be inspected;
- the same delegated URL succeeds only after a trusted allowed-host navigation document links it;
- target municipality and Police allowed-host candidates preserve current behavior;
- rejected admission performs zero capture/model/write.

Checkpoint after targeted Vitest, typecheck, lint and diff-check. One mandatory integrity reviewer
must report GO before live work.

## Milestone 8B — explicit local-beta package policy and sealed bundle

Files:

- create `src/research/slovenia-demo-city-package.ts`;
- create `src/decision/slovenia-demo-city-policy.ts`;
- create `src/infrastructure/sources/slovenia-demo-package-bundle.ts`;
- create `src/infrastructure/sources/slovenia-demo-package-policy-lock.ts`;
- create `tests/research/slovenia-demo-city-package.test.ts`;
- create `tests/integration/slovenia-demo-package-installation.test.ts`;
- later add the generated, reviewed bundle under `data/official-packages/si-demo/v1/`.

Package identity is separate from the blocked production package:

```ts
packageId: "si-demo-city-package"
packageSchemaVersion: "si-demo-city-package@1"
evidenceRulesVersion: "si-demo-city-evidence@1"
catalogScopePolicy: "subjective-relocation-demo@1" // bundle provenance, not CityCatalog DTO
```

The first sealed bundle contains Ljubljana only and an explicit Catalog
`coverage: { status: "incomplete", reasons: ["official_universe_partial"] }`. The next bundle
revision adds Maribor, Koper, Celje and Kranj. Global `getCityResearchPackageAvailability("SI")`,
`APPROVED_CITY_CRITERIA_DEFAULTS_REGISTRY` and `INSTALLED_CITY_PACKAGE_BEHAVIOR_REGISTRY` stay
unchanged; the evaluator injects beta-only approved registries and resolver capabilities.

The bundle loader must descriptor-safely own and freeze:

- exact city identity, official names, municipality/settlement codes and reviewed coordinates;
- population basis and source artifact hashes;
- authority-directory publishers, host/media/redirect/retention policies and municipality binding;
- safety and three fixed source plans for every member;
- criteria defaults/definitions and exact compiled behavior versions;
- artifact IDs, SHA-256 values, capture instants, source URLs and one bundle manifest digest.

It rebuilds Registry, Catalog, directory and plans through existing constructors and compares their
canonical IDs; caller-supplied derived IDs/membership are never authority. It then produces the
existing `InstallCityPackageInput`. Missing, synthetic, non-official, unsealed, extra-member,
cross-city or hash-mismatched material fails before SQLite write.

Installable authority is a two-artifact gate:

1. a mutable acquisition bundle containing captured/derived public evidence;
2. an independently reviewed policy lock containing the expected canonical bundle-manifest digest,
   exact publisher/host/route relations, policy versions and referenced capture hashes.

The policy lock lives outside the mutable generated bundle and is never computed or rewritten by
the acquisition command. The loader accepts only the exact pinned lock revision and verifies every
reference in both directions. A self-recomputed manifest, an unpinned new host, a captured link
without a lock revision, or any existing Slovenia feasibility fixture cannot install or authorize a
source.

Fixed criteria may close honestly to bounded unknown for the first beta. Add a real production
adapter for a sealed `universe_incomplete | reference_period_unproved | license_unproved` plan
outcome rather than injecting test fakes. Ljubljana safety is the only required verified fact in the
first vertical.

## Milestone 8C — official acquisition and deterministic Ljubljana safety parser

Files:

- create `evals/prepare-slovenia-demo-package.ts`;
- create `src/infrastructure/sources/slovenia-official-directory-bootstrap.ts`;
- create `src/infrastructure/sources/slovenia-police-safety-analyzer.ts` or a narrower
  source-format-specific analyzer selected after the live discovery result;
- create `src/infrastructure/sources/slovenia-surs-population-loader.ts`;
- add focused parser/gateway tests and privacy-safe fixtures only for the exact selected format;
- add `prepare:si-demo-package` to `package.json`.

The acquisition command is explicit opt-in, produces staging-only data and starts with the reviewed package roots already
documented by official evidence: GOV.SI, Police, SURS and GURS. Local Codex may locate pages under
those roots but cannot authorize a host. An independently captured official-government or
already-authorized first-party link is evidence for a municipality host, never authority by itself;
TLS success or model assertion is insufficient. A separate milestone review verifies staging,
writes the policy lock, records its canonical digest in Git and reruns the offline
loader/install/replay gates before Stage B can see the bundle.

For Ljubljana acquire and seal:

1. exact settlement/municipality identity and population from official SURS material;
2. official coordinate or a declared deterministic point-on-surface from official GURS geometry;
3. municipality/police/SURS publisher policies and route provenance;
4. one historical exact-municipality Police numerator plus same-year SURS denominator that the
   deterministic parser verifies;
5. one current replacement candidate, if official material actually exists. If it does not, the
   live result must remain yellow and no success is fabricated.

The analyzer is chosen only after seeing the real format. It may parse one exact reviewed
PDF/CSV/JSON family and must independently reproduce municipality, full calendar year, integer
offence total and Police data authority. `source.extract` may propose a bounded quote only when the
existing public projection can be deterministically derived; it never replaces the parser.

Generated artifacts contain official public/derived non-personal data only. Do not commit raw
offence/person/case/address rows. Seal only aggregate counts, minimum parser vectors, raw source
hashes and provenance allowed by the retention policy.

## Milestone 8D — production installed-source authority

Files:

- create `src/infrastructure/sqlite/city-source-installed-authority.ts`;
- create `src/infrastructure/local-beta-city-frontier-composition.ts`;
- add `tests/infrastructure/city-source-installed-authority.test.ts`;
- minimally extend the local-beta composition factory, not the public app root.

The authority derives the installed baseline internally from independently replayed package,
manifest and verified City Evidence. It does not accept a caller-provided `CitySourceVersionV1`.
It emits a SourceVersion only when artifact hashes, exact source link, parser version, check run,
Evidence snapshot and package key agree. Missing prior verified Evidence returns unavailable and
cannot be replaced. Historical replay performs zero model/network/current-source calls.

Do not add generic store access to `composition-root.ts` or browser routes. A private local-beta
factory owns the database, integrity key, installed-package replay and
`SqliteCitySourceInstalledAuthority`, then delegates inward to `createCityFrontierComposition`.
Neither Stage B nor any caller may supply or relay an installed-authority port. The factory exposes
only beta application operations. Negative tests pass a forged/relay authority-shaped object and
prove rejection before model/network/write.

## Milestone 8E — sanitized Stage B evaluator

Files:

- create `evals/local-codex-stage-b.ts`;
- create `tests/integration/local-codex-stage-b-contract.test.ts`;
- add `eval:local-codex-stage-b` to `package.json`;
- add ignored output directory `data/evals/local-codex-stage-b/` if needed.

The command requires `--live-local-subscription`, re-verifies the reviewed Codex installation and
requires a current successful Stage A artifact/gate before subscription use. It uses one fresh local
SQLite database and the sealed beta bundle, then executes:

1. install/replay the beta package and manifest;
2. run the verified historical Ljubljana check to establish the installed baseline;
3. run a later check where that source is broken/stale;
4. perform native-search discovery, capture and deterministic parsing;
5. on usable official material, commit the complete replacement transaction;
6. repeat and prove replacement-first with zero discovery;
7. run a forced no-search/no-candidate case and prove yellow with unchanged truth heads/counts.

The Stage B artifact follows Stage A's symlink-safe fixed-path, stale cleanup, atomic write and mode
0600 pattern. Exact output fields are limited to schema/policy/runtime versions, closed outcome,
counts, durations, boolean atomicity/repeat/yellow proofs and content hashes. It never contains raw
prompt, query, candidate URL, model output, source bytes, credentials, profile values or database
path. The owner audit remains in SQLite; the public result exposes only the verified current
`PublicFactSourceV1`.

## Milestone 8F — five-city SI batch

After one unchanged Stage B checkpoint passes three consecutive times, acquire and seal the same
package material for Maribor, Koper, Celje and Kranj. Run the five discovery jobs through the existing
five-slot pool, with one job per city and no shared mutable authority state. The batch is valid when:

- each job starts from its own target-city publisher set;
- no URL/model/source material crosses jobs;
- each verified result has an independently replayable source link;
- unavailable cities remain yellow without blocking the others;
- package upgrade and each successful source replacement are atomic and history-replayable.

Only after this SI batch should equivalent authoritative beta packages be planned for the remaining
nine demo countries.

## Executable feedback and review

After each code milestone run the smallest changed suite, then:

```bash
pnpm typecheck
pnpm lint
pnpm audit:codex-runtime
git diff --check
```

At milestone closure run:

```bash
pnpm test
```

One implementation reviewer reviews every checkpoint. The second reviewer is mandatory only for
authority/integrity, persistence/atomicity, concurrency/abort or confidentiality changes. Critical
blocks. Important that does not affect the current vertical goes to the hardening backlog.

Live commands run only after offline GREEN and the mandatory reviews. Package preparation cannot be
chained directly into Stage B: staging must be reviewed and pinned in a separate Git checkpoint.

```bash
pnpm eval:local-codex-stage-a -- --live-local-subscription \
  --artifact data/evals/local-codex-stage-a/result.json
pnpm prepare:si-demo-package -- --live-official-sources
# stop: independently review staging, create/pin the policy lock, commit, then rerun offline gates
pnpm eval:local-codex-stage-b -- --live-local-subscription \
  --artifact data/evals/local-codex-stage-b/result.json
```

## Definition of done

- The blocked production Slovenia package and old fixtures remain blocked and unchanged in meaning.
- The beta package is explicitly partial, independently sealed, installable and replayable.
- The acquisition bundle alone is never installable; Stage B accepts only the separately reviewed
  and Git-pinned policy-lock revision.
- Candidate admission is target-city-scoped and direct delegated-host admission is closed.
- One real Ljubljana source is verified; a broken/stale link yields yellow or a real automatic
  official replacement, never a fabricated red/green.
- A successful replacement is atomic across Evidence, Knowledge, Frontier, SourceVersion,
  SourceBinding, audit and event; repeat uses it first.
- No-candidate/no-search is yellow with zero truth mutation.
- Abort, lost ownership and CAS loss cause no late write.
- Public source DTO and local artifact are closed, frozen and confidentiality-safe.
- The local-beta composition constructs installed authority internally; no caller-supplied or relay
  authority capability reaches the recovery store.
- Three consecutive Stage B PASS runs succeed on one unchanged Git checkpoint before the five-city
  batch begins.
