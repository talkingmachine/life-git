# VS-4A City Package Offline Installation Boundary

**Status:** approved direction; written contract pending final user review  
**Approval:** user selected option 1 on 2026-08-24  
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

`latestInstalledVerified(countryCode)` is not a raw latest-catalog-row query. It is an
installation-scoped read capability that first verifies the signed installed-package head and then
loads the exact referenced Catalog projection from `CityCatalogStorePort.loadVerified`. Unreferenced
catalog rows never become current.

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

export interface InstallCityPackagePorts {
  readonly resolveAvailability: (
    countryCode: string,
  ) => CityResearchPackageAvailability | undefined;
  readonly catalog: CityCatalogStorePort;
  readonly administrativeEvidence: EvidenceWriteStore<
    "city-package-installation",
    CityPackageAdministrativeEvidenceClaim,
    "administrative"
  >;
  readonly manifests: InstalledCityPackageManifestStorePort;
  readonly installedPackages: InstalledCityPackageLookupPort;
  readonly approvedDefaults: ApprovedCityCriteriaDefaultsRegistry;
  readonly integrity: EvidenceIntegrity;
}

export function installCityPackage(
  input: InstallCityPackageInput,
  ports: InstallCityPackagePorts,
): Promise<InstalledCityResearchPackage>;
```

The use case snapshots the complete input and rejects accessors, symbols, sparse arrays, custom
prototypes, extra keys, invalid identifiers, and noncanonical timestamps before invoking any port or
integrity callback. It then:

1. resolves availability by `countryCode` and calls `assertCityPackageReady`;
2. requires the ready definition to match the complete supplied projection and current catalog rules;
3. independently resolves the approved defaults entry for that definition and compares the entire
   supplied defaults value before evaluator use;
4. reconstructs the Registry/Catalog, all fixed plans, safety plan/directory, criterion definitions,
   and defaults;
5. appends and reloads the exact Catalog projection;
6. derives the five-field `InstalledCityPackageExactKey` and canonical member order;
7. seals one administrative package Evidence bundle;
8. appends the immutable package manifest/head;
9. loads the result through `installedPackages.findExact(key)` and returns only that fresh verified
   package.

Missing or non-ready availability throws `city_package_not_ready` before persistence. Legacy catalog
rules throw `city_catalog_upgrade_required` with zero new rows. A missing exact package after a
successful manifest append, drift between any returned projection/key, or malformed input is
`integrity_mismatch`. The interface contains no source, search, HTTP, browser, model, clock, or ID
generator capability.

The composition root supplies the production availability resolver. Tests may inject a closed
synthetic ready resolver and compiled test-only defaults/behavior registries. No runtime caller may
supply availability through serialized input.

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

