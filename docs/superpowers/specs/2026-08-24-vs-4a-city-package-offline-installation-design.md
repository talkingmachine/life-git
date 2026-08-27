# VS-4A City Package Offline Installation Boundary

**Status:** approved

**Approval:** user selected option 1 and approved the written contract on 2026-08-24

**Parent spec:** `docs/superpowers/specs/2026-08-13-vs-4a-city-frontier-design.md`

**Affected plan:** `docs/superpowers/plans/2026-08-13-vs-4a-city-frontier-knowledge.md`, Tasks 9–10

## Purpose

Task 9 implements the offline persistence and installation substrate needed by later City Frontier
tasks. It does not certify the current Slovenia catalog, publish official source data, or turn the
current Slovenia package candidate into an installed package. Production Slovenia remains fail-closed
with `city_package_not_ready` until a separately reviewed Catalog Evidence publisher and approved
sealed artifacts exist.

This amendment resolves two gaps in the parent Task 9: it defines the exact installation use-case
boundary and distinguishes structural catalog persistence from official-source verification.

## Scope

Task 9 may implement and test, entirely offline:

- origin-specialized generic Evidence storage with the existing default remaining live-only;
- URL-free administrative package artifacts and their one sealed administrative Evidence bundle;
- structurally verified Registry/Catalog persistence;
- immutable installed-package manifests, exact historical lookup, and a signed country head;
- full four-fact City Knowledge persistence;
- an administrative installation use case exercised only with closed synthetic ready packages;
- restart, concurrency, tamper, HMAC, and historical replay behavior.

Task 9 must not:

- label the current Slovenia candidate `ready`;
- add a production Slovenia approved-defaults or executable-behavior registry entry;
- derive an official Registry/Catalog from the current feasibility fixtures;
- expose a browser, HTTP, model, generic route, or production composition entry that can publish a raw
  `CityCatalogProjection`;
- claim that structural reconstruction of a projection proves its official considered universe;
- delete or reset an incompatible existing database automatically.

## Catalog trust boundary

`CityCatalogStorePort.appendVerified` verifies only the closed Registry/Catalog structure, canonical
IDs, membership rules, HMAC/persisted bytes, and the equality of both Evidence snapshot identifiers.
It is not an official-source verifier. During this slice it is reachable only from the administrative
installation composition and synthetic integration tests, after the independently compiled package
availability resolver has returned a `ready` value.

The production resolver continues to return the existing Slovenia `not_ready` candidate. Therefore no
production call can reach catalog append or package installation. A later Catalog Evidence task must
own the official source/claim schema, sealed considered-universe and coordinate evidence, parser, and
publication operation. Only that later task may add a production `ready` availability entry.

Historical catalog compatibility remains exact: persisted schema is `city-catalog@1`; historical
rules `city-catalog@1` are load-only; new administrative append and installed-package roots require
`CITY_CATALOG_RULES_VERSION === "city-catalog@2"`.

`InstalledCityCatalogReadPort.latestInstalledVerified(countryCode)` is not a raw latest-catalog-row
query. It is an installation-scoped read capability that first verifies the signed installed-package
head and then loads the exact referenced Catalog projection from
`CityCatalogStorePort.loadVerified`. Unreferenced catalog rows never become current. Later Core
composition injects this port for latest installed-root reads and the Catalog store separately for
exact historical ID reads.

## Exact installation use case

The Application boundary is:

```ts
export interface InstallCityPackageInput {
  readonly countryCode: string;
  readonly installedAt: string;
  readonly catalogProjection: CityCatalogProjection;
  readonly fixedPlansByCityId: Readonly<Record<string, readonly [
    CityFixedSourcePlan<"si-city-long-term-rent">,
    CityFixedSourcePlan<"si-city-urban-transit">,
    CityFixedSourcePlan<"si-city-fixed-broadband">,
  ]>>;
  readonly safetySourcePlan: CitySafetySourcePlan;
  readonly officialAuthorityDirectory: OfficialAuthorityDirectory;
  readonly criteriaDefaults: InstalledCityCriteriaDefaults;
  readonly criterionDefinitions: InstalledCityCriterionDefinitionTuple;
}

export type CityPackageAvailabilityResolver = (
  this: void,
  countryCode: string,
) => CityResearchPackageAvailability | undefined;

export interface InstallCityPackagePorts {
  readonly resolveAvailability: CityPackageAvailabilityResolver;
  readonly catalog: CityCatalogStorePort;
  readonly administrativeEvidence: EvidenceWriteStore<
    "city-package-installation",
    CityPackageAdministrativeEvidenceClaim,
    "administrative"
  >;
  readonly manifests: InstalledCityPackageManifestAppendPort;
  readonly installedPackages: InstalledCityPackageLookupPort;
  readonly approvedDefaults: ApprovedCityCriteriaDefaultsRegistry;
  readonly integrity: EvidenceIntegrity;
}

export function installCityPackage(
  input: InstallCityPackageInput,
  ports: InstallCityPackagePorts,
): Promise<InstalledCityResearchPackage>;

export interface InstalledCityPackageManifestAppendInput {
  readonly ready: CityResearchPackageReadyCandidate;
  readonly catalog: VerifiedCityCatalogBundle;
  readonly administrativeEvidence: SealedCityPackageAdministrativeEvidence;
  readonly fixedPlansByCityId: InstallCityPackageInput["fixedPlansByCityId"];
  readonly safetySourcePlan: CitySafetySourcePlan;
  readonly officialAuthorityDirectory: OfficialAuthorityDirectory;
  readonly criteriaDefaults: InstalledCityCriteriaDefaults;
  readonly criterionDefinitions: InstalledCityCriterionDefinitionTuple;
  readonly installedAt: string;
}

export interface InstalledCityPackageManifestAppendPort {
  appendPrepared(
    input: InstalledCityPackageManifestAppendInput,
  ): InstalledCityPackageManifest;
}

export function reconstructInstalledCityCriterionDefinitionsStructure(
  value: unknown,
  expectedDefinitionIds: Readonly<Record<CityCriterionId, string>>,
): InstalledCityCriterionDefinitionTuple;
```

The structural criterion-definition reconstructor checks the complete closed four-item tuple, exact
`CITY_CRITERION_IDS` order, every identifier and the expected definition IDs derived from the approved
defaults. It first descriptor-owns and exact-closes the borrowed `expectedDefinitionIds` map to exactly
`CITY_CRITERION_IDS`, before reading the borrowed definitions. Arbitrary own-key insertion order is
accepted; hostile, extra, missing and swapped/misbound criterion-to-definition values are rejected. It
treats `evaluatorVersion` only as structural data. The existing three-argument
`reconstructInstalledCityCriterionDefinitions` delegates this structural work and then additionally
binds the exact compiled evaluator-version map. Therefore Application can validate package structure
without accepting an Infrastructure behavior registry, selector or behavior input capability, while
the Task 4 manifest adapter remains the sole executable evaluator/validator binding authority. A
structurally valid but compiled-unapproved `evaluatorVersion` can therefore reach `appendPrepared`;
Task 4 must reject it there as `integrity_mismatch` after Catalog/administrative Evidence may already
have been persisted but before any new manifest/head row. Only the Task 4-verified exact lookup result
supplies function-valued evaluator/validator capabilities; Application immediately captures them into
a function-preserving receiver-safe owned package, shape-validates and returns them but never invokes
them.

The use case descriptor-snapshots the complete input and rejects accessors without invocation,
symbols, proxies, sparse arrays, custom prototypes, cycles, extra or missing fields, invalid
identifiers and noncanonical timestamps before reading a port or invoking an integrity callback. After
that validation and before the first callback, it descriptor-owns and exact-closes the complete ports
root, owns the approved-defaults graph, and captures stable receiver-safe function values for
availability, integrity, Catalog, administrative Evidence, manifest and installed-package lookup.
Nested adapter receivers are retained only for their own captured capability; no callback receives the
complete ports root. Its exact call and authority order is:

1. own and validate the complete data-only input with zero port or integrity access;
2. before the first callback, exact-close the ports root, capture stable resolver,
   `canonical`/`hash`/`sign`, `appendVerified`/`loadVerified`, `appendArtifact`/`seal`,
   `appendPrepared` and lookup function values plus their narrow adapter receivers, own
   `approvedDefaults`, then invoke the captured resolver exactly once as a standalone function with
   `this === undefined`; normalize every resolver throw, including a spoofed recognized literal, to a
   fresh `integrity_mismatch` without reading a borrowed property; only returned `undefined` or a
   returned value that `assertCityPackageReady` proves is valid not-ready produces
   `city_package_not_ready`;
3. only after ready, activate the pre-captured integrity functions as receiver-safe frozen Decision
   `{ canonical, hash }` and sealing `{ canonical, hash, sign }` views; only now may any pre-captured
   integrity/store method be invoked, so resolver mutation of the root or nested methods cannot swap
   later authority;
4. reconstruct Registry/Catalog through the Decision view, bind input/ready/Registry/Catalog country,
   package and schema identities, then require `CITY_CATALOG_RULES_VERSION`;
5. independently call the trusted `resolveApprovedCityCriteriaDefaults` exactly once under the
   stage-specific descriptor-safe error normalizer, preserve only its exact fresh
   `city_package_behavior_unavailable` or `integrity_mismatch` code by throwing a new intrinsic Error,
   canonical-compare the entire supplied defaults value to the approved copy, and use only the
   approved copy afterward;
6. derive expected definition IDs from that approved copy, structurally reconstruct the definitions,
   fixed plans, authority directory and safety plan, and bind every Catalog member, city, source,
   criterion, definition, geo scope, unit, denominator and freshness value without invoking executable
   behavior;
7. call `catalog.appendVerified(reconstructedCatalog)` exactly once; after current `@2` has already
   been proved, normalize every append throw, including spoofed not-found, upgrade or recognized
   literals, to a fresh `integrity_mismatch`, then immediately descriptor-own and strictly reconstruct
   its closed return into a frozen copy and compare that complete owned projection with the expected
   Catalog;
8. call `catalog.loadVerified(expectedCatalogId)` exactly once and normalize every load throw by the
   same Catalog rule, then immediately descriptor-own and strictly reconstruct its closed return into
   a frozen copy and compare it completely; retain this fresh loaded owned equal DTO solely for
   `appendPrepared.catalog`, so sealing-time reentrant mutation of a borrowed return alias cannot
   change it, while the independently reconstructed expected Catalog remains the authority for
   expected ID and member order;
9. derive the five-field `InstalledCityPackageExactKey` only from the ready definition plus the
   independently reconstructed expected Catalog ID, and derive canonical member order only from that
   expected Catalog; neither append nor load return may select the key or order;
10. call `sealCityPackageAdministrativeEvidence` exactly once with the derived key,
    expected-Catalog-derived `catalogMemberIds`, approved defaults and reconstructed values; the seal
    call receives no Catalog DTO, and every unexpected administrative seal/store throw becomes a fresh
    `integrity_mismatch`;
11. call `manifests.appendPrepared(...)` exactly once with the fresh loaded equal Catalog DTO in its
    `catalog` field; its stage normalizer preserves only descriptor-safe exact fresh
    `city_package_behavior_unavailable` or `integrity_mismatch` by emitting a new intrinsic Error, and
    maps every other thrown shape/code to a fresh `integrity_mismatch`; Application never reads a head
    or supplies a predecessor, manifest ID, HMAC or executable behavior-version identifier;
12. immediately descriptor-own the manifest return as exactly sixteen keys, split the inherited exact
    thirteen-key payload from `id`/`payloadHash`/`hmac`, freeze both, and verify
    `canonical(payload)`, `payloadHash === hash(canonicalPayload)`,
    `id === "installed-city-package-manifest:" + payloadHash` and
    `hmac === sign(canonicalPayload)`; then compare the independently derived key, ready
    definition/status, Catalog root, `installedAt` and known sealed/input bindings without treating the
    manifest as lookup authority or constructing an expected payload; `predecessorManifestId` and the
    Task 4-derived behavior-version fields are checked only for closed type and signed
    self-consistency, never independently selected, supplied or expected by Application;
13. call `installedPackages.findExact(derivedKey)` exactly once and never call `findReady`; after the
    successful manifest append, normalize every lookup throw to a fresh `integrity_mismatch`, so lookup
    cannot reclassify a compiled-behavior failure, immediately descriptor-own its return into a strict
    function-preserving receiver-safe frozen package copy, then reject a missing result, serializable
    drift, extra/accessor/proxy surface or capability-shape drift; the evaluator registry must have the
    exact four definitions and function-valued capabilities, but Application never invokes them;
14. return only that owned fresh verified exact package.

Canonical equality is never an ownership or closure check: JSON canonicalization can omit own
`undefined`, cannot make accessor/proxy input safe and cannot prevent later alias mutation. Every port
return is therefore owned/reconstructed immediately before any equality check or subsequent callback.

Error normalization is stage-specific and never dispatches by reading `error.message`. It first
rejects non-objects and proxies, requires the intrinsic Error prototype and an own non-accessor string
`message` descriptor, admits only the codes explicitly trusted for that call stage, and always throws a
new intrinsic Error. Accessor, proxy, inherited-message, custom-prototype, arbitrary-code and spoofed
recognized-code errors at every other stage become a fresh `integrity_mismatch`; Catalog and lookup
can never leak internal not-found, upgrade or behavior codes.

The error precedence and permitted completed effects are exact:

| Condition | Error | Permitted completed effects |
| --- | --- | --- |
| malformed input, port or integrity boundary | `integrity_mismatch` | zero callbacks and writes when the input is malformed |
| resolver throws any value or code | fresh `integrity_mismatch` | exactly one resolver call; zero integrity/store method calls and writes |
| resolver returns `undefined` or valid not-ready | `city_package_not_ready` | exactly one resolver call; port/integrity descriptors may have been captured, but zero integrity/store method calls and writes |
| otherwise matching Catalog uses legacy rules `@1` | `city_catalog_upgrade_required` | availability and Decision reconstruction only; zero defaults/persistence |
| no approved-defaults match | `city_package_behavior_unavailable` | zero persistence |
| malformed or multiple approved-defaults matches | `integrity_mismatch` | zero persistence; the approved Task 3 contract is unchanged |
| pre-persistence Application-visible structural or cross-binding drift in steps 4–6 | `integrity_mismatch` | zero persistence |
| Catalog append/load throws any value or code after current `@2` is proved | fresh `integrity_mismatch` | Catalog effects may remain; zero administrative Evidence/manifest/head/lookup calls after the failing call |
| administrative seal/store throws unexpectedly | fresh `integrity_mismatch` | Catalog and partial administrative Evidence effects may remain; zero manifest/head/lookup calls |
| trusted descriptor-safe `integrity_mismatch` from `appendPrepared`, including Task 4 compiled evaluator/fixed-policy binding drift | `integrity_mismatch` | Catalog/administrative Evidence may already exist; zero new manifest/head rows |
| zero or multiple compiled behavior matches | `city_package_behavior_unavailable` | Catalog/administrative Evidence may already exist; zero new manifest/head rows |
| `appendPrepared` throws any non-whitelisted code/shape | fresh `integrity_mismatch` | Catalog/administrative Evidence may already exist; Task 5 adds no outer transaction |
| missing, malformed or drifted Catalog or manifest return | `integrity_mismatch` | operations already completed by earlier independent ports may remain; Task 5 adds no outer transaction |
| `findExact` throws, or its return is missing, malformed or drifted | fresh `integrity_mismatch` | successful Catalog/Evidence/manifest/head effects remain; lookup cannot reclassify behavior availability |

The input/ports contain no source, search, HTTP, browser, model, clock, ID generator, compiled behavior
registry, behavior selector or serialized behavior input capability. Only the Task 4-verified lookup
result supplies function-valued evaluator/validator capabilities; Application immediately owns them
behind receiver-safe wrappers, shape-validates and returns them but never invokes them.

The manifest adapter constructs the inherited exact thirteen-key persisted payload inside one
`BEGIN IMMEDIATE`. It independently selects exactly one compiled behavior entry by the approved
package definition, verifies evaluator bindings against the reconstructed definitions, derives every
behavior-version field, loads the verified current country head to derive
`predecessorManifestId`, signs the payload, inserts it and compare-and-swap advances the head. Missing
or ambiguous compiled behavior is `city_package_behavior_unavailable` with zero new manifest/head rows.
The full-payload insert is private Infrastructure code.

The dedicated administrative composition boundary is exact:

```ts
export interface CityPackageInstallationCompositionOptions {
  readonly database: Database.Database;
  readonly hmacKey: string;
  readonly resolveAvailability: CityPackageAvailabilityResolver;
  readonly approvedDefaults: ApprovedCityCriteriaDefaultsRegistry;
  readonly behaviors: InstalledCityPackageBehaviorRegistry;
}

export interface CityPackageInstallationComposition {
  readonly installCityPackage: (
    input: InstallCityPackageInput,
  ) => Promise<InstalledCityResearchPackage>;
}

export function createCityPackageInstallationComposition(
  options: CityPackageInstallationCompositionOptions,
): Readonly<CityPackageInstallationComposition>;
```

All five options are mandatory code dependencies; the factory has no production resolver, defaults or
behavior fallback. It independently owns the approved-defaults data once and creates exactly one
`EvidenceIntegrity` instance from `hmacKey`. The same captured `database` and that integrity instance
go to `new SqliteCityCatalogStore(database, integrity)`,
`new SqliteAdministrativeEvidenceStore(database, integrity)` and
`new SqliteCityPackageManifestStore(database, integrity, approvedDefaults, behaviors)`. The same owned
`approvedDefaults` go only to the manifest store and Application; the Catalog and administrative
Evidence constructors do not accept defaults. `behaviors` goes only to the manifest store, and
`InstalledCityPackages` wraps that same manifest store. Application receives the constructed Catalog,
administrative Evidence, manifest and exact-lookup ports plus the captured resolver, integrity and
owned defaults; it never receives the raw database. The returned object is frozen and has exactly one
own key, `installCityPackage`; it exposes no raw store, registry, resolver or append capability.

The dedicated administrative factory is production code, but this slice gives it no user-facing or
production-wired invocation, route or startup registration. It does not create an installation eval,
modify the user-facing composition root, import the administrative factory there, or re-export it from
that root. The user-facing boundary is protected by a future-stable negative audit for forbidden
installer, Catalog-write, manifest-append, availability, defaults and behavior capabilities, not by a
brittle allowlist of all unrelated application keys. The dedicated factory is invoked only by
integration tests with a closed synthetic ready resolver. No runtime caller may supply availability
through serialized input. A later Catalog Evidence publisher must add its own reviewed invocation.

## Task ownership

Task 9 owns the persistence substrate and the exact installation use case above. Its title and success
claim are narrowed to “persist City Knowledge and prepare offline city-package installation.” It may
prove the installation protocol using synthetic ready packages, but must report official Slovenia
publication as pending.

Task 10 remains an offline proof-only Application replay boundary. It must descriptor-snapshot its
three-field input before calling a port, resolve the historical exact five-field package key, and use no
live-source or signing capability. Production wiring may be added only by a later consumer task; Task
10 itself does not modify composition.

## Acceptance

- Current Slovenia remains byte-for-byte `not_ready` with all four readiness issues.
- The Task 9 focused matrix, full test suite, typecheck, full lint, production build, and diff checks
  pass without a network, browser, model, or official-source call.
- Old live-only databases fail preflight with `database_schema_reset_required`; no code automatically
  deletes or migrates user data.
- Task 9 reports synthetic installation infrastructure complete and official Slovenia publication
  pending.
- Task 10 proves exact offline Evidence replay after restart and successor installation, with zero live
  calls and no fallback from historical package A to current package B.
