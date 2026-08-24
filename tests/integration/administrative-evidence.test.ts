import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, expectTypeOf, test } from "vitest";

import type { CityCriterionDefinition, InstalledCityCriteriaDefaults } from "../../src/decision/city-criteria";
import {
  canonicalJson,
  createEvidenceIntegrity,
  sha256Text,
} from "../../src/infrastructure/integrity";
import { openEvidenceDatabase } from "../../src/infrastructure/sqlite/db";
import { SqliteAdministrativeEvidenceStore } from "../../src/infrastructure/sqlite/evidence-store";
import {
  sealCityPackageAdministrativeEvidence,
  type SealCityPackageAdministrativeEvidenceInput,
} from "../../src/application/seal-administrative-evidence";
import type { AdministrativeCapturedArtifact } from "../../src/research/contracts";
import type {
  CityFixedSourcePlan,
  SloveniaCityFixedSourceId,
} from "../../src/research/city-evidence";
import type {
  CitySafetySourcePlan,
  OfficialAuthorityDirectory,
} from "../../src/research/city-safety-source-plan";
import {
  buildInstalledPackageArtifactSetClaim,
  type CityPackageAdministrativeEvidenceClaim,
  type InstalledCityPackageJsonArtifactRole,
} from "../../src/research/city-package-artifact-set";
import type {
  EvidenceIntegrity,
  EvidenceWriteStore,
  SealedEvidence,
} from "../../src/research/research-plan";

const HMAC_KEY = "task-2-administrative-evidence-key-at-least-32-bytes";
const INSTALLED_AT = "2026-08-24T10:11:12.123Z";
const SOURCE_IDS = [
  "si-city-long-term-rent",
  "si-city-urban-transit",
  "si-city-fixed-broadband",
] as const;
const CRITERION_IDS = ["safety", "long_term_rent", "urban_transit", "fixed_broadband"] as const;

function fixedPlan<S extends SloveniaCityFixedSourceId>(
  cityId: string,
  sourceId: S,
): CityFixedSourcePlan<S> {
  const criterionId = sourceId === "si-city-long-term-rent"
    ? "long_term_rent"
    : sourceId === "si-city-urban-transit" ? "urban_transit" : "fixed_broadband";
  return {
    planId: `${cityId}:${sourceId}:plan@1`,
    sourceId,
    cityId,
    criterionId,
    definitionId: `${criterionId}-definition@1`,
    claimContract: {
      sourceId,
      criterionId,
      definitionId: `${criterionId}-definition@1`,
      scope: `municipality:${cityId}`,
      officialAreaId: cityId === "ljubljana" ? "061" : "070",
      geoScope: "municipality",
      unit: "canonical-unit",
      denominator: "canonical-denominator",
      freshnessPolicyVersion: "annual@1",
      valueKind: "canonical_scalar",
      valuePolicyVersion: "canonical-scalar@1",
      sourcePeriodPolicyVersion: "annual-period@1",
    },
    routes: [{
      routeId: `${sourceId}:primary`,
      navigationUrl: `https://official.example/${sourceId}`,
    }],
    parserVersion: `${sourceId}:parser@1`,
    rulesVersion: `${sourceId}:rules@1`,
  } as unknown as CityFixedSourcePlan<S>;
}

function directory(): OfficialAuthorityDirectory {
  return {
    schemaVersion: "official-authority-directory@1",
    id: "official-authority-directory:synthetic",
    countryCode: "SI",
    catalogRevisionId: `city-catalog:${"c".repeat(64)}`,
    requiredPublisherIds: { police: "police", gov: "gov", opsi: "opsi", surs: "surs" },
    publishers: [],
    municipalities: [],
    rulesVersion: "slovenia-official-authorities@1",
  };
}

function safetyPlan(): CitySafetySourcePlan {
  return {
    schemaVersion: "city-safety-source-plan@1",
    id: "city-safety-source-plan:synthetic",
    catalogRevisionId: `city-catalog:${"c".repeat(64)}`,
    authorityDirectoryId: "official-authority-directory:synthetic",
    entries: [],
    queryTemplateVersion: "slovenia-municipal-safety-query@1",
    definitionId: "si-municipal-police-offences-per-100000@1",
    freshnessPolicyVersion: "municipal-annual-july-boundary@1",
    discoveryRulesVersion: "city-safety-discovery@1",
  };
}

function definitions(): readonly [
  CityCriterionDefinition,
  CityCriterionDefinition,
  CityCriterionDefinition,
  CityCriterionDefinition,
] {
  return CRITERION_IDS.map((criterionId) => ({
    criterionId,
    definitionId: `${criterionId}-definition@1`,
    direction: "at_most" as const,
    unit: "canonical-unit",
    denominator: "canonical-denominator",
    compatibleGeoScopes: ["municipality"],
    freshnessPolicyVersion: "annual@1",
    evaluatorVersion: `${criterionId}-evaluator@1`,
  })) as unknown as readonly [
    CityCriterionDefinition,
    CityCriterionDefinition,
    CityCriterionDefinition,
    CityCriterionDefinition,
  ];
}

function defaults(): InstalledCityCriteriaDefaults {
  return {
    schemaVersion: "city-criteria-defaults@1",
    mappingVersion: "synthetic-defaults@1",
    criteria: CRITERION_IDS.map((criterionId, index) => ({
      criterionId,
      definitionId: `${criterionId}-definition@1`,
      mode: index === 0 ? "required" as const : "weighted" as const,
      importance: (index + 1) as 1 | 2 | 3 | 4,
      target: `${index + 1}`,
    })) as unknown as InstalledCityCriteriaDefaults["criteria"],
  };
}

function packageInput(memberIds: readonly string[] = ["ljubljana", "maribor"]):
SealCityPackageAdministrativeEvidenceInput {
  return {
    key: {
      countryCode: "SI",
      packageId: "si-city-package",
      packageSchemaVersion: "si-city-package@1",
      catalogRevisionId: `city-catalog:${"c".repeat(64)}`,
      evidenceRulesVersion: "si-city-evidence@1",
    },
    installedAt: INSTALLED_AT,
    catalogMemberIds: [...memberIds],
    fixedPlansByCityId: Object.fromEntries(memberIds.map((cityId) => [cityId, [
      fixedPlan(cityId, "si-city-long-term-rent"),
      fixedPlan(cityId, "si-city-urban-transit"),
      fixedPlan(cityId, "si-city-fixed-broadband"),
    ]])) as SealCityPackageAdministrativeEvidenceInput["fixedPlansByCityId"],
    safetySourcePlan: safetyPlan(),
    officialAuthorityDirectory: directory(),
    criteriaDefaults: defaults(),
    criterionDefinitions: definitions(),
  };
}

function materialValues(input: SealCityPackageAdministrativeEvidenceInput): readonly unknown[] {
  return [
    ...input.catalogMemberIds.flatMap((cityId) => input.fixedPlansByCityId[cityId]!),
    input.safetySourcePlan,
    input.officialAuthorityDirectory,
    input.criteriaDefaults,
    input.criterionDefinitions,
  ];
}

class RecordingStore implements EvidenceWriteStore<
  "city-package-installation",
  CityPackageAdministrativeEvidenceClaim,
  "administrative"
> {
  readonly artifactArguments: AdministrativeCapturedArtifact<"city-package-installation">[] = [];
  readonly artifactCopies: AdministrativeCapturedArtifact<"city-package-installation">[] = [];
  readonly sealedArguments: Array<SealedEvidence<
    "city-package-installation",
    CityPackageAdministrativeEvidenceClaim,
    "administrative"
  >> = [];

  constructor(private readonly mutateArguments = false) {}

  async appendArtifact(
    artifact: AdministrativeCapturedArtifact<"city-package-installation">,
  ): Promise<void> {
    this.artifactArguments.push(artifact);
    this.artifactCopies.push(structuredClone(artifact));
    if (this.mutateArguments) {
      artifact.bytes.fill(255);
      (artifact as { role: string }).role = "mutated-by-store";
    }
  }

  async seal(sealed: SealedEvidence<
    "city-package-installation",
    CityPackageAdministrativeEvidenceClaim,
    "administrative"
  >): Promise<void> {
    this.sealedArguments.push(sealed);
    if (this.mutateArguments) {
      (sealed.manifest.artifacts[0] as { role: string }).role = "mutated-by-store";
    }
  }
}

function countedIntegrity() {
  const base = createEvidenceIntegrity(HMAC_KEY);
  const calls = { canonical: 0, hash: 0, sign: 0 };
  const receiverKeys: string[][] = [];
  const integrity: EvidenceIntegrity = {
    canonical(this: unknown, value) {
      calls.canonical += 1;
      receiverKeys.push(Object.keys(this as object).sort());
      return base.canonical(value);
    },
    hash(this: unknown, value) {
      calls.hash += 1;
      receiverKeys.push(Object.keys(this as object).sort());
      return base.hash(value);
    },
    sign(this: unknown, value) {
      calls.sign += 1;
      receiverKeys.push(Object.keys(this as object).sort());
      return base.sign(value);
    },
  };
  return { calls, integrity, receiverKeys };
}

describe("sealCityPackageAdministrativeEvidence", () => {
  test("canonicalizes the exact 3N+4 order once and delegates one generic administrative seal", async () => {
    // Break caught: a second signer, HTTP lineage, caller order, or noncanonical material bytes.
    const input = packageInput();
    const values = materialValues(input);
    const store = new RecordingStore();
    const { calls, integrity, receiverKeys } = countedIntegrity();
    const sealed = await sealCityPackageAdministrativeEvidence(input, { store, integrity });
    const artifactCount = 3 * input.catalogMemberIds.length + 4;

    expect(store.artifactArguments).toHaveLength(artifactCount);
    expect(store.sealedArguments).toHaveLength(1);
    expect(sealed.artifacts).toHaveLength(artifactCount);
    expect(sealed.bindings).toHaveLength(artifactCount);
    expect(calls).toEqual({ canonical: artifactCount + 2, hash: artifactCount + 2, sign: 1 });
    expect(receiverKeys.filter((keys) => keys.length === 2)).toEqual([
      ["canonical", "hash"],
      ["canonical", "hash"],
    ]);
    expect(receiverKeys.filter((keys) => keys.length === 3))
      .toHaveLength(receiverKeys.length - 2);
    expect(store.artifactCopies.map(({ bytes }) => new TextDecoder().decode(bytes)))
      .toEqual(values.map(canonicalJson));
    expect(store.artifactCopies.map(({ sha256 }) => sha256))
      .toEqual(values.map((value) => sha256Text(canonicalJson(value))));

    const direct = buildInstalledPackageArtifactSetClaim({
      key: input.key,
      installedAt: input.installedAt,
      orderedMaterials: store.artifactCopies.map((artifact, artifactOrdinal) => ({
        artifactOrdinal,
        slot: artifactOrdinal < input.catalogMemberIds.length * 3
          ? {
              kind: "fixed_plan" as const,
              cityId: input.catalogMemberIds[Math.floor(artifactOrdinal / 3)]!,
              sourceId: SOURCE_IDS[artifactOrdinal % 3]!,
            }
          : [
              { kind: "safety_source_plan" as const },
              { kind: "official_authority_directory" as const },
              { kind: "criteria_defaults" as const },
              { kind: "criterion_definitions" as const },
            ][artifactOrdinal - input.catalogMemberIds.length * 3]!,
        role: artifact.role as InstalledCityPackageJsonArtifactRole,
        sha256: artifact.sha256,
      })),
    }, { canonical: canonicalJson, hash: sha256Text });
    expect(sealed.installRunId).toBe(direct.installRunId);
    expect(sealed.evidenceId).toBe(direct.evidenceId);
    expect(sealed.evidence.snapshot.claims).toEqual([direct.claim]);
    expect(sealed.evidence.snapshot.id).toBe(direct.evidenceId);
    expect(sealed.evidence.snapshot.assessmentDate).toBe("2026-08-24");
    expect(sealed.evidence.snapshot.coverage).toEqual({
      "city-package-installation": "verified",
    });
    expect(sealed.evidence.snapshot.parserVersions).toEqual({
      "city-package-installation": "city-package-administrative-json@1",
    });
    expect(sealed.evidence.snapshot.rulesVersion).toBe("city-package-administrative-evidence@1");
    expect(sealed.evidence.snapshot).not.toHaveProperty("contextHash");
    expect(sealed.evidence.snapshot).not.toHaveProperty("knowledgeBaselineRevisionId");
    expect(sealed.evidence.manifest.entries).toEqual([{
      sourceId: "city-package-installation",
      origin: "administrative",
      artifactIds: sealed.artifacts.map(({ artifactId }) => artifactId),
    }]);
    expect(sealed.artifacts.every((artifact) =>
      artifact.sourceId === "city-package-installation" &&
      artifact.origin === "administrative" &&
      artifact.runId === sealed.installRunId &&
      artifact.mediaType === "application/json" &&
      artifact.producer === "install-city-package@1" &&
      artifact.createdAt === INSTALLED_AT)).toBe(true);
    for (const artifact of sealed.artifacts) {
      expect(Reflect.ownKeys(artifact).sort()).toEqual([
        "artifactId", "bytes", "createdAt", "mediaType", "origin", "producer", "role",
        "runId", "sha256", "sourceId",
      ]);
      expect(artifact).not.toHaveProperty("url");
      expect(artifact).not.toHaveProperty("request");
      expect(artifact).not.toHaveProperty("responseUrl");
      expect(artifact).not.toHaveProperty("responseStatus");
      expect(artifact).not.toHaveProperty("capturedAt");
    }
    for (const provenance of sealed.evidence.manifest.artifacts) {
      expect(Reflect.ownKeys(provenance).sort()).toEqual([
        "artifactId", "byteLength", "createdAt", "mediaType", "origin", "producer", "role",
        "runId", "sha256", "sourceId",
      ]);
    }
    for (const [artifactOrdinal, binding] of sealed.bindings.entries()) {
      const artifact = sealed.artifacts[artifactOrdinal]!;
      expect(Reflect.ownKeys(binding).sort()).toEqual([
        "artifactId", "artifactOrdinal", "evidenceSnapshotId", "mediaType", "role", "runId",
        "sha256", "sourceId",
      ]);
      expect(binding).toEqual({
        evidenceSnapshotId: sealed.evidenceId,
        artifactId: artifact.artifactId,
        artifactOrdinal,
        runId: sealed.installRunId,
        sourceId: "city-package-installation",
        role: artifact.role,
        mediaType: "application/json",
        sha256: artifact.sha256,
      });
    }
    expectTypeOf(sealCityPackageAdministrativeEvidence).parameter(1).toEqualTypeOf<{
      readonly store: EvidenceWriteStore<
        "city-package-installation",
        CityPackageAdministrativeEvidenceClaim,
        "administrative"
      >;
      readonly integrity: EvidenceIntegrity;
    }>();
  });

  test("serializes a private input snapshot when the first canonical callback mutates the caller", async () => {
    // Break caught: material callbacks can reorder or replace later borrowed package values.
    const baseline = await sealCityPackageAdministrativeEvidence(packageInput(), {
      store: new RecordingStore(),
      integrity: createEvidenceIntegrity(HMAC_KEY),
    });
    const borrowed = packageInput();
    const base = createEvidenceIntegrity(HMAC_KEY);
    let first = true;
    const mutableIntegrity: {
      canonical(value: unknown): string;
      hash(value: string): string;
      sign(value: string): string;
    } = {
      canonical(value) {
        if (first) {
          first = false;
          (borrowed as { installedAt: string }).installedAt =
            "2026-08-25T10:11:12.123Z";
          (borrowed as unknown as { catalogMemberIds: string[] }).catalogMemberIds.reverse();
          (borrowed.fixedPlansByCityId.ljubljana![1] as { planId: string }).planId = "mutated";
          (borrowed.safetySourcePlan as { id: string }).id = "mutated";
          (borrowed.criteriaDefaults as { mappingVersion: string }).mappingVersion = "mutated";
          mutableIntegrity.canonical = () => "forged-canonical";
          mutableIntegrity.hash = () => "0".repeat(64);
          mutableIntegrity.sign = () => "0".repeat(64);
        }
        return base.canonical(value);
      },
      hash: base.hash,
      sign: base.sign,
    };
    const result = await sealCityPackageAdministrativeEvidence(borrowed, {
      store: new RecordingStore(),
      integrity: mutableIntegrity,
    });
    expect(result).toEqual(baseline);
    expect(Object.isFrozen(borrowed)).toBe(false);
    expect(Object.isFrozen(borrowed.safetySourcePlan)).toBe(false);
  });

  test("keeps canonical bytes and returned artifacts stable when store callbacks mutate arguments", async () => {
    // Break caught: one mutable Uint8Array is shared by persistence, sealing, and the returned bundle.
    const input = packageInput(["ljubljana"]);
    const expectedTexts = materialValues(input).map(canonicalJson);
    const store = new RecordingStore(true);
    const result = await sealCityPackageAdministrativeEvidence(input, {
      store,
      integrity: createEvidenceIntegrity(HMAC_KEY),
    });

    expect(result.artifacts.map(({ bytes }) => new TextDecoder().decode(bytes))).toEqual(expectedTexts);
    expect(result.evidence.manifest.artifacts.map(({ role }) => role))
      .toEqual(result.artifacts.map(({ role }) => role));
    expect(result.artifacts.every((artifact, index) =>
      artifact.bytes !== store.artifactArguments[index]!.bytes)).toBe(true);
    expect(store.artifactArguments.every(({ bytes }) => bytes.every((value) => value === 255)))
      .toBe(true);
    expect(store.sealedArguments[0]).not.toBe(result.evidence);
  });

  test.each([
    ["unsorted catalog members", (value: SealCityPackageAdministrativeEvidenceInput) => {
      const swapped = packageInput(["maribor", "ljubljana"]);
      Object.assign(value as object, swapped);
    }],
    ["duplicate catalog member", (value: SealCityPackageAdministrativeEvidenceInput) => {
      (value as unknown as { catalogMemberIds: string[] }).catalogMemberIds = [
        "ljubljana",
        "ljubljana",
      ];
    }],
    ["missing fixed member", (value: SealCityPackageAdministrativeEvidenceInput) => {
      delete (value.fixedPlansByCityId as Record<string, unknown>).maribor;
    }],
    ["sparse fixed tuple", (value: SealCityPackageAdministrativeEvidenceInput) => {
      const sparse = new Array(3);
      sparse[0] = value.fixedPlansByCityId.ljubljana![0];
      (value.fixedPlansByCityId as Record<string, unknown>).ljubljana = sparse;
    }],
    ["wrong plan city", (value: SealCityPackageAdministrativeEvidenceInput) => {
      (value.fixedPlansByCityId.ljubljana![0] as { cityId: string }).cityId = "maribor";
    }],
    ["wrong plan source", (value: SealCityPackageAdministrativeEvidenceInput) => {
      (value.fixedPlansByCityId.ljubljana![0] as { sourceId: string }).sourceId =
        "si-city-urban-transit";
    }],
    ["extra fixed member", (value: SealCityPackageAdministrativeEvidenceInput) => {
      (value.fixedPlansByCityId as Record<string, unknown>).celje =
        value.fixedPlansByCityId.ljubljana;
    }],
    ["nested undefined", (value: SealCityPackageAdministrativeEvidenceInput) => {
      (value.safetySourcePlan as unknown as { optional?: undefined }).optional = undefined;
    }],
    ["nested function", (value: SealCityPackageAdministrativeEvidenceInput) => {
      (value.safetySourcePlan as unknown as { callback?: () => void }).callback = () => undefined;
    }],
    ["nested bigint", (value: SealCityPackageAdministrativeEvidenceInput) => {
      (value.safetySourcePlan as unknown as { count?: bigint }).count = 1n;
    }],
    ["nested Date", (value: SealCityPackageAdministrativeEvidenceInput) => {
      (value as unknown as { safetySourcePlan: Date }).safetySourcePlan = new Date(INSTALLED_AT);
    }],
    ["nested Map", (value: SealCityPackageAdministrativeEvidenceInput) => {
      (value as unknown as { criteriaDefaults: Map<string, string> }).criteriaDefaults = new Map();
    }],
    ["nested Uint8Array", (value: SealCityPackageAdministrativeEvidenceInput) => {
      (value as unknown as { criterionDefinitions: Uint8Array }).criterionDefinitions =
        Uint8Array.of(1);
    }],
    ["NaN", (value: SealCityPackageAdministrativeEvidenceInput) => {
      (value.criteriaDefaults.criteria[0] as { importance: number }).importance = Number.NaN;
    }],
  ] as const)("rejects %s before integrity or store callbacks", async (_name, mutate) => {
    // Break caught: canonical JSON drops or normalizes a hostile non-JSON package graph.
    const value = packageInput();
    mutate(value);
    const store = new RecordingStore();
    const { calls, integrity } = countedIntegrity();
    await expect(sealCityPackageAdministrativeEvidence(value, { store, integrity }))
      .rejects.toThrow("integrity_mismatch");
    expect(calls).toEqual({ canonical: 0, hash: 0, sign: 0 });
    expect(store.artifactArguments).toHaveLength(0);
    expect(store.sealedArguments).toHaveLength(0);
  });

  test("rejects accessors and proxies without invoking traps or callbacks", async () => {
    // Break caught: input inspection executes untrusted behavior before taking private ownership.
    let traps = 0;
    const trap = (): never => { traps += 1; throw new Error("trap"); };
    const hostileInputs = [
      (() => {
        const value = packageInput();
        Object.defineProperty(value.fixedPlansByCityId.ljubljana![0], "planId", {
          enumerable: true,
          get: trap,
        });
        return value;
      })(),
      new Proxy(packageInput(), {
        get: trap,
        getOwnPropertyDescriptor: trap,
        getPrototypeOf: trap,
        ownKeys: trap,
      }),
      (() => {
        const revoked = Proxy.revocable(packageInput(), {});
        revoked.revoke();
        return revoked.proxy;
      })(),
    ];
    for (const value of hostileInputs) {
      const store = new RecordingStore();
      const { calls, integrity } = countedIntegrity();
      await expect(sealCityPackageAdministrativeEvidence(value, { store, integrity }))
        .rejects.toThrow("integrity_mismatch");
      expect(calls).toEqual({ canonical: 0, hash: 0, sign: 0 });
      expect(store.artifactArguments).toHaveLength(0);
    }
    expect(traps).toBe(0);
  });

  test("converges exact SQLite retries, rejects installed-time provenance drift, and changes run on content drift", async () => {
    // Break caught: retry leaks a uniqueness error or run identity incorrectly includes installedAt.
    const directoryPath = mkdtempSync(join(tmpdir(), "city-package-administrative-"));
    const path = join(directoryPath, "evidence.sqlite");
    const firstDb = openEvidenceDatabase(path);
    const secondDb = openEvidenceDatabase(path);
    try {
      const integrity = createEvidenceIntegrity(HMAC_KEY);
      const first = await sealCityPackageAdministrativeEvidence(packageInput(["ljubljana"]), {
        store: new SqliteAdministrativeEvidenceStore(firstDb, integrity),
        integrity,
      });
      const retry = await sealCityPackageAdministrativeEvidence(packageInput(["ljubljana"]), {
        store: new SqliteAdministrativeEvidenceStore(secondDb, integrity),
        integrity,
      });
      expect(retry).toEqual(first);
      expect(secondDb.prepare("SELECT COUNT(*) FROM evidence_snapshots").pluck().get()).toBe(1);
      expect(secondDb.prepare("SELECT COUNT(*) FROM artifacts").pluck().get()).toBe(7);

      const later = packageInput(["ljubljana"]);
      (later as { installedAt: string }).installedAt = "2026-08-25T10:11:12.123Z";
      await expect(sealCityPackageAdministrativeEvidence(later, {
        store: new SqliteAdministrativeEvidenceStore(secondDb, integrity),
        integrity,
      })).rejects.toThrow("integrity_mismatch");
      expect(secondDb.prepare("SELECT COUNT(*) FROM evidence_snapshots").pluck().get()).toBe(1);

      const changed = packageInput(["ljubljana"]);
      (changed.fixedPlansByCityId.ljubljana![0] as { planId: string }).planId += ":v2";
      const changedResult = await sealCityPackageAdministrativeEvidence(changed, {
        store: new SqliteAdministrativeEvidenceStore(secondDb, integrity),
        integrity,
      });
      expect(changedResult.installRunId).not.toBe(first.installRunId);
      expect(changedResult.evidenceId).not.toBe(first.evidenceId);
      expect(secondDb.prepare("SELECT COUNT(*) FROM evidence_snapshots").pluck().get()).toBe(2);
    } finally {
      firstDb.close();
      secondDb.close();
      rmSync(directoryPath, { recursive: true, force: true });
    }
  });
});
