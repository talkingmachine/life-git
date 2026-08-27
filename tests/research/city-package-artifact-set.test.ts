import { describe, expect, test } from "vitest";

import { canonicalJson, sha256Text } from "../../src/infrastructure/integrity";
import {
  buildInstalledPackageArtifactSetClaim,
  reconstructAdministrativeEvidenceShell,
  reconstructInstalledPackageArtifactSetClaim,
  type AdministrativeEvidenceLoadExpectations,
  type BuildInstalledPackageArtifactSetClaimInput,
  type CityPackageAdministrativeEvidenceClaim,
  type InstalledPackageArtifactSetMaterial,
} from "../../src/research/city-package-artifact-set";

const INSTALLED_AT = "2026-08-24T10:11:12.123Z";
const KEY = {
  countryCode: "SI",
  packageId: "si-city-package",
  packageSchemaVersion: "si-city-package@1",
  catalogRevisionId: `city-catalog:${"c".repeat(64)}`,
  evidenceRulesVersion: "si-city-evidence@1",
} as const;
const INTEGRITY = Object.freeze({ canonical: canonicalJson, hash: sha256Text });

function materials(): InstalledPackageArtifactSetMaterial[] {
  return materialsForMembers(["ljubljana", "maribor"]);
}

function materialsForMembers(memberIds: readonly string[]): InstalledPackageArtifactSetMaterial[] {
  const fixed = memberIds.flatMap((cityId) => [
    {
      slot: { kind: "fixed_plan" as const, cityId, sourceId: "si-city-long-term-rent" as const },
      role: "installed_city_fixed_source_plan" as const,
      sha256: sha256Text(`${cityId}:long-rent`),
    },
    {
      slot: { kind: "fixed_plan" as const, cityId, sourceId: "si-city-urban-transit" as const },
      role: "installed_city_fixed_source_plan" as const,
      sha256: sha256Text(`${cityId}:transit`),
    },
    {
      slot: { kind: "fixed_plan" as const, cityId, sourceId: "si-city-fixed-broadband" as const },
      role: "installed_city_fixed_source_plan" as const,
      sha256: sha256Text(`${cityId}:broadband`),
    },
  ]);
  return [
    ...fixed,
    {
      slot: { kind: "safety_source_plan" as const },
      role: "installed_city_safety_source_plan" as const,
      sha256: sha256Text("safety"),
    },
    {
      slot: { kind: "official_authority_directory" as const },
      role: "installed_city_official_authority_directory" as const,
      sha256: sha256Text("directory"),
    },
    {
      slot: { kind: "criteria_defaults" as const },
      role: "installed_city_criteria_defaults" as const,
      sha256: sha256Text("defaults"),
    },
    {
      slot: { kind: "criterion_definitions" as const },
      role: "installed_city_criterion_definitions" as const,
      sha256: sha256Text("definitions"),
    },
  ].map((material, artifactOrdinal) => ({ artifactOrdinal, ...material }));
}

function input(): BuildInstalledPackageArtifactSetClaimInput {
  return { key: structuredClone(KEY), installedAt: INSTALLED_AT, orderedMaterials: materials() };
}

function expectedRunId(value = input()): string {
  return `city-package-install:${sha256Text(canonicalJson({
    schemaVersion: "city-package-install-run@1",
    key: value.key,
    artifacts: value.orderedMaterials,
  }))}`;
}

function isDeeplyFrozen(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value !== "object" || seen.has(value)) return true;
  seen.add(value);
  return Object.isFrozen(value) && Object.values(value).every((item) =>
    isDeeplyFrozen(item, seen));
}

describe("installed package artifact-set claim", () => {
  test("derives the closed canonical order, identifiers, claim, and ordinal-zero anchor", () => {
    // Break caught: a caller controls an ID/order/anchor or the run hash includes installedAt.
    const borrowed = input();
    const built = buildInstalledPackageArtifactSetClaim(borrowed, INTEGRITY);
    const runId = expectedRunId(borrowed);
    const artifactIds = borrowed.orderedMaterials.map((material) =>
      `${runId}:artifact:${String(material.artifactOrdinal).padStart(3, "0")}` +
      `:${material.role}:${material.sha256}`);

    expect(built.installRunId).toBe(runId);
    expect(built.evidenceId).toBe(`${runId}:evidence`);
    expect(built.orderedArtifacts).toHaveLength(3 * 2 + 4);
    expect(built.orderedArtifacts.map(({ artifactOrdinal, role, artifactId }) => ({
      artifactOrdinal,
      role,
      artifactId,
    }))).toEqual(artifactIds.map((artifactId, artifactOrdinal) => ({
      artifactOrdinal,
      role: borrowed.orderedMaterials[artifactOrdinal]!.role,
      artifactId,
    })));
    expect(Reflect.ownKeys(built.claim).sort()).toEqual([
      "anchor", "claimId", "scope", "sourceId", "sourcePeriod", "status", "value",
    ]);
    expect(Reflect.ownKeys(built.claim.value).sort()).toEqual([
      "evidenceId", "installRunId", "key", "orderedArtifacts", "schemaVersion",
    ]);
    expect(built.claim).toEqual({
      claimId: `${runId}:artifact-set`,
      sourceId: "city-package-installation",
      value: {
        schemaVersion: "installed-city-package-artifact-set@1",
        key: KEY,
        installRunId: runId,
        evidenceId: `${runId}:evidence`,
        orderedArtifacts: artifactIds.map((artifactId, artifactOrdinal) => ({
          artifactOrdinal,
          role: borrowed.orderedMaterials[artifactOrdinal]!.role,
          artifactId,
        })),
      },
      scope: "city-package-installation",
      sourcePeriod: INSTALLED_AT,
      anchor: {
        artifactId: artifactIds[0],
        locator: `urn:city-package-installation:${runId}`,
        excerptSha256: borrowed.orderedMaterials[0]!.sha256,
      },
      status: "verified",
    });
    expect(isDeeplyFrozen(built)).toBe(true);
    expect(built.claim.value.key).not.toBe(borrowed.key);
    expect(built.orderedArtifacts).not.toBe(borrowed.orderedMaterials);
    expect(built.orderedArtifacts[0]!.slot).not.toBe(borrowed.orderedMaterials[0]!.slot);
    expect(Object.isFrozen(borrowed)).toBe(false);
    expect(Object.isFrozen(borrowed.orderedMaterials[0]!)).toBe(false);

    const later = buildInstalledPackageArtifactSetClaim({
      ...input(),
      installedAt: "2026-08-25T10:11:12.123Z",
    }, INTEGRITY);
    expect(later.installRunId).toBe(built.installRunId);
    expect(later.evidenceId).toBe(built.evidenceId);
    expect(later.orderedArtifacts.map(({ artifactId }) => artifactId))
      .toEqual(built.orderedArtifacts.map(({ artifactId }) => artifactId));
    expect(later.claim.sourcePeriod).not.toBe(built.claim.sourcePeriod);

    const second = buildInstalledPackageArtifactSetClaim(input(), INTEGRITY);
    expect(second).toEqual(built);
    expect(second).not.toBe(built);
    expect(second.claim).not.toBe(built.claim);
    expect(second.claim.value).not.toBe(built.claim.value);
    expect(second.claim.value.key).not.toBe(built.claim.value.key);
    expect(second.claim.value.orderedArtifacts).not.toBe(built.claim.value.orderedArtifacts);
    expect(second.claim.value.orderedArtifacts[0]).not.toBe(built.claim.value.orderedArtifacts[0]);
    expect(second.claim.anchor).not.toBe(built.claim.anchor);
    expect(second.orderedArtifacts[0]!.slot).not.toBe(built.orderedArtifacts[0]!.slot);
  });

  test.each([
    ["swapped catalog city groups", (value: BuildInstalledPackageArtifactSetClaimInput) => {
      const ordered = value.orderedMaterials as InstalledPackageArtifactSetMaterial[];
      const swapped = [...ordered.slice(3, 6), ...ordered.slice(0, 3), ...ordered.slice(6)];
      swapped.forEach((item, index) =>
        (item as { artifactOrdinal: number }).artifactOrdinal = index);
      (value as unknown as { orderedMaterials: InstalledPackageArtifactSetMaterial[] }).orderedMaterials =
        swapped;
    }],
    ["wrong fixed source order", (value: BuildInstalledPackageArtifactSetClaimInput) => {
      const ordered = value.orderedMaterials as InstalledPackageArtifactSetMaterial[];
      [ordered[0], ordered[1]] = [ordered[1]!, ordered[0]!];
      ordered.forEach((item, index) => (item as { artifactOrdinal: number }).artifactOrdinal = index);
    }],
    ["duplicate slot", (value: BuildInstalledPackageArtifactSetClaimInput) => {
      (value.orderedMaterials[1] as { slot: unknown }).slot =
        structuredClone(value.orderedMaterials[0]!.slot);
    }],
    ["slot-role mismatch", (value: BuildInstalledPackageArtifactSetClaimInput) => {
      (value.orderedMaterials[0] as { role: string }).role = "installed_city_safety_source_plan";
    }],
    ["singleton order drift", (value: BuildInstalledPackageArtifactSetClaimInput) => {
      const ordered = value.orderedMaterials as InstalledPackageArtifactSetMaterial[];
      [ordered[6], ordered[7]] = [ordered[7]!, ordered[6]!];
      ordered.forEach((item, index) => (item as { artifactOrdinal: number }).artifactOrdinal = index);
    }],
    ["ordinal gap", (value: BuildInstalledPackageArtifactSetClaimInput) => {
      (value.orderedMaterials[2] as { artifactOrdinal: number }).artifactOrdinal = 9;
    }],
    ["negative zero ordinal", (value: BuildInstalledPackageArtifactSetClaimInput) => {
      (value.orderedMaterials[0] as { artifactOrdinal: number }).artifactOrdinal = -0;
    }],
    ["fractional ordinal", (value: BuildInstalledPackageArtifactSetClaimInput) => {
      (value.orderedMaterials[0] as { artifactOrdinal: number }).artifactOrdinal = 0.5;
    }],
    ["unsafe ordinal", (value: BuildInstalledPackageArtifactSetClaimInput) => {
      (value.orderedMaterials[0] as { artifactOrdinal: number }).artifactOrdinal =
        Number.MAX_SAFE_INTEGER + 1;
    }],
    ["uppercase SHA", (value: BuildInstalledPackageArtifactSetClaimInput) => {
      (value.orderedMaterials[9] as { sha256: string }).sha256 = "A".repeat(64);
    }],
    ["noncanonical timestamp", (value: BuildInstalledPackageArtifactSetClaimInput) => {
      (value as { installedAt: string }).installedAt = "2026-08-24T10:11:12Z";
    }],
    ["extra key", (value: BuildInstalledPackageArtifactSetClaimInput) => {
      (value.orderedMaterials[0] as unknown as { extra?: boolean }).extra = true;
    }],
    ["sparse material array", (value: BuildInstalledPackageArtifactSetClaimInput) => {
      const sparse = new Array<InstalledPackageArtifactSetMaterial>(value.orderedMaterials.length);
      sparse[0] = value.orderedMaterials[0]!;
      (value as unknown as { orderedMaterials: InstalledPackageArtifactSetMaterial[] })
        .orderedMaterials = sparse;
    }],
  ] as const)("rejects %s before returning identifiers", (_name, mutate) => {
    const value = input();
    mutate(value);
    expect(() => buildInstalledPackageArtifactSetClaim(value, INTEGRITY))
      .toThrow("integrity_mismatch");
  });

  test("enforces one through one-hundred complete member triplets", () => {
    // Break caught: partial/empty/oversized catalog material sets escape the 3N+4 contract.
    const memberIds = Array.from({ length: 100 }, (_, index) =>
      `city-${String(index).padStart(3, "0")}`);
    const hundred = { ...input(), orderedMaterials: materialsForMembers(memberIds) };
    expect(buildInstalledPackageArtifactSetClaim(hundred, INTEGRITY).orderedArtifacts)
      .toHaveLength(304);

    const invalidSets = [
      materialsForMembers([]),
      materialsForMembers(["ljubljana"]).slice(0, -1),
      materialsForMembers([...memberIds, "city-100"]),
    ];
    for (const orderedMaterials of invalidSets) {
      let callbacks = 0;
      expect(() => buildInstalledPackageArtifactSetClaim({ ...input(), orderedMaterials }, {
        canonical: () => { callbacks += 1; return ""; },
        hash: () => { callbacks += 1; return ""; },
      })).toThrow("integrity_mismatch");
      expect(callbacks).toBe(0);
    }
  });

  test.each([
    ["lowercase country", (value: Record<string, unknown>) => { value.countryCode = "si"; }],
    ["long country", (value: Record<string, unknown>) => { value.countryCode = "SVN"; }],
    ["empty package", (value: Record<string, unknown>) => { value.packageId = ""; }],
    ["space in schema", (value: Record<string, unknown>) => {
      value.packageSchemaVersion = "package schema";
    }],
    ["empty catalog", (value: Record<string, unknown>) => { value.catalogRevisionId = ""; }],
    ["slash in rules", (value: Record<string, unknown>) => { value.evidenceRulesVersion = "a/b"; }],
    ["extra key", (value: Record<string, unknown>) => { value.extra = true; }],
    ["missing key", (value: Record<string, unknown>) => { delete value.catalogRevisionId; }],
  ] as const)("rejects an exact-key %s before callbacks", (_name, mutate) => {
    const value = input();
    mutate(value.key as unknown as Record<string, unknown>);
    let callbacks = 0;
    expect(() => buildInstalledPackageArtifactSetClaim(value, {
      canonical: () => { callbacks += 1; return ""; },
      hash: () => { callbacks += 1; return ""; },
    })).toThrow("integrity_mismatch");
    expect(callbacks).toBe(0);
  });

  test.each([
    ["missing material key", (value: BuildInstalledPackageArtifactSetClaimInput) => {
      delete (value.orderedMaterials[0] as unknown as { sha256?: string }).sha256;
    }],
    ["extra slot key", (value: BuildInstalledPackageArtifactSetClaimInput) => {
      (value.orderedMaterials[0]!.slot as unknown as { extra?: boolean }).extra = true;
    }],
    ["missing slot key", (value: BuildInstalledPackageArtifactSetClaimInput) => {
      delete (value.orderedMaterials[0]!.slot as unknown as { cityId?: string }).cityId;
    }],
    ["invalid city", (value: BuildInstalledPackageArtifactSetClaimInput) => {
      (value.orderedMaterials[0]!.slot as { cityId: string }).cityId = "bad city";
    }],
    ["unknown source", (value: BuildInstalledPackageArtifactSetClaimInput) => {
      (value.orderedMaterials[0]!.slot as { sourceId: string }).sourceId = "unknown";
    }],
  ] as const)("rejects a descriptor with %s before callbacks", (_name, mutate) => {
    const value = input();
    mutate(value);
    let callbacks = 0;
    expect(() => buildInstalledPackageArtifactSetClaim(value, {
      canonical: () => { callbacks += 1; return ""; },
      hash: () => { callbacks += 1; return ""; },
    })).toThrow("integrity_mismatch");
    expect(callbacks).toBe(0);
  });

  test("snapshots the complete builder input before integrity callbacks", () => {
    // Break caught: accessors or reentrant callbacks can alter the hashed descriptor graph.
    const hostile = input();
    let getters = 0;
    let callbacks = 0;
    Object.defineProperty(hostile.orderedMaterials[0]!.slot, "cityId", {
      enumerable: true,
      get: () => {
        getters += 1;
        return "ljubljana";
      },
    });
    expect(() => buildInstalledPackageArtifactSetClaim(hostile, {
      canonical: () => { callbacks += 1; return ""; },
      hash: () => { callbacks += 1; return ""; },
    })).toThrow("integrity_mismatch");
    expect({ getters, callbacks }).toEqual({ getters: 0, callbacks: 0 });

    const borrowed = input();
    const expected = buildInstalledPackageArtifactSetClaim(input(), INTEGRITY);
    let first = true;
    const reentrant = buildInstalledPackageArtifactSetClaim(borrowed, {
      canonical(value) {
        if (first) {
          first = false;
          (borrowed.key as { packageId: string }).packageId = "mutated";
          (borrowed.orderedMaterials[0] as { sha256: string }).sha256 = "f".repeat(64);
        }
        return canonicalJson(value);
      },
      hash: sha256Text,
    });
    expect(reentrant).toEqual(expected);

    let observedFrozenPayload = false;
    let rejectedPayloadMutation = false;
    const guarded = buildInstalledPackageArtifactSetClaim(input(), {
      canonical(value) {
        observedFrozenPayload = Object.isFrozen(value) &&
          Object.isFrozen((value as { key: object }).key) &&
          Object.isFrozen((value as { artifacts: object }).artifacts);
        rejectedPayloadMutation = !Reflect.set(value as object, "schemaVersion", "forged");
        return canonicalJson(value);
      },
      hash: sha256Text,
    });
    expect(guarded).toEqual(expected);
    expect({ observedFrozenPayload, rejectedPayloadMutation }).toEqual({
      observedFrozenPayload: true,
      rejectedPayloadMutation: true,
    });
  });

  test("rejects builder proxies and descriptor anomalies before callbacks or traps", () => {
    // Break caught: a proxy/accessor/non-enumerable/array extension reaches hashing.
    let traps = 0;
    const trap = (): never => { traps += 1; throw new Error("trap"); };
    const revoked = Proxy.revocable(input(), {});
    revoked.revoke();
    const cases: BuildInstalledPackageArtifactSetClaimInput[] = [
      new Proxy(input(), {
        get: trap,
        getOwnPropertyDescriptor: trap,
        getPrototypeOf: trap,
        ownKeys: trap,
      }),
      revoked.proxy,
      (() => {
        const value = input();
        Object.defineProperty(value.key, "countryCode", {
          value: "SI",
          enumerable: false,
        });
        return value;
      })(),
      (() => {
        const value = input();
        (value.orderedMaterials as unknown as { extra?: boolean }).extra = true;
        return value;
      })(),
    ];
    for (const value of cases) {
      let callbacks = 0;
      expect(() => buildInstalledPackageArtifactSetClaim(value, {
        canonical: () => { callbacks += 1; return ""; },
        hash: () => { callbacks += 1; return ""; },
      })).toThrow("integrity_mismatch");
      expect(callbacks).toBe(0);
    }
    expect(traps).toBe(0);
  });

  test("reconstructs only the one exact owned claim and rejects every field drift", () => {
    // Break caught: a re-signed outer bundle can substitute any package claim field.
    const built = buildInstalledPackageArtifactSetClaim(input(), INTEGRITY);
    const borrowed = [structuredClone(built.claim)];
    const reconstructed = reconstructInstalledPackageArtifactSetClaim(borrowed, input(), INTEGRITY);
    expect(reconstructed).toEqual(built);
    expect(reconstructed).not.toBe(built);
    expect(reconstructed.claim).not.toBe(borrowed[0]);
    expect(isDeeplyFrozen(reconstructed)).toBe(true);
    expect(Object.isFrozen(borrowed)).toBe(false);
    expect(Object.isFrozen(borrowed[0]!)).toBe(false);

    const mutations: readonly [string, (claims: CityPackageAdministrativeEvidenceClaim[]) => void][] = [
      ["claim id", (claims) => (claims[0] as { claimId: string }).claimId += ":drift"],
      ["source id", (claims) => (claims[0] as { sourceId: string }).sourceId = "other"],
      ["scope", (claims) => (claims[0] as { scope: string }).scope = "other"],
      ["source period", (claims) => (claims[0] as { sourcePeriod: string }).sourcePeriod =
        "2026-08-25T10:11:12.123Z"],
      ["status", (claims) => (claims[0] as { status: string }).status = "missing"],
      ["schema", (claims) => (claims[0]!.value as { schemaVersion: string }).schemaVersion = "other"],
      ["key field", (claims) => (claims[0]!.value.key as { packageId: string }).packageId = "other"],
      ["run id", (claims) => (claims[0]!.value as { installRunId: string }).installRunId += ":x"],
      ["evidence id", (claims) => (claims[0]!.value as { evidenceId: string }).evidenceId += ":x"],
      ["item ordinal", (claims) => (claims[0]!.value.orderedArtifacts[0] as {
        artifactOrdinal: number;
      }).artifactOrdinal = 1],
      ["item role", (claims) => (claims[0]!.value.orderedArtifacts[0] as {
        role: string;
      }).role = "installed_city_criteria_defaults"],
      ["item artifact id", (claims) => (claims[0]!.value.orderedArtifacts[0] as {
        artifactId: string;
      }).artifactId += ":x"],
      ["anchor artifact", (claims) => (claims[0]!.anchor as { artifactId: string }).artifactId += ":x"],
      ["anchor locator", (claims) => (claims[0]!.anchor as { locator: string }).locator += ":x"],
      ["anchor SHA", (claims) => (claims[0]!.anchor as { excerptSha256: string }).excerptSha256 =
        "f".repeat(64)],
      ["extra claim key", (claims) => (claims[0] as unknown as { extra?: boolean }).extra = true],
      ["extra value key", (claims) => (claims[0]!.value as unknown as { extra?: boolean }).extra = true],
      ["extra key key", (claims) => (claims[0]!.value.key as unknown as { extra?: boolean }).extra = true],
      ["extra item key", (claims) => (claims[0]!.value.orderedArtifacts[0] as unknown as {
        extra?: boolean;
      }).extra = true],
      ["extra anchor key", (claims) => (claims[0]!.anchor as unknown as { extra?: boolean }).extra = true],
      ["missing claim", (claims) => { claims.splice(0, 1); }],
      ["duplicate claim", (claims) => { claims.push(structuredClone(claims[0]!)); }],
      ["reordered items", (claims) => {
        const items = claims[0]!.value.orderedArtifacts as unknown as Array<
          CityPackageAdministrativeEvidenceClaim["value"]["orderedArtifacts"][number]
        >;
        [items[0], items[1]] = [items[1]!, items[0]!];
      }],
      ["sparse items", (claims) => {
        const items = new Array(claims[0]!.value.orderedArtifacts.length);
        items[0] = claims[0]!.value.orderedArtifacts[0];
        (claims[0]!.value as unknown as { orderedArtifacts: unknown[] }).orderedArtifacts = items;
      }],
    ];
    for (const [name, mutate] of mutations) {
      const claims = [structuredClone(built.claim)];
      mutate(claims);
      expect(() => reconstructInstalledPackageArtifactSetClaim(claims, input(), INTEGRITY), name)
        .toThrow("integrity_mismatch");
    }
  });

  test("rejects hostile borrowed claim graphs before builder or integrity callbacks", () => {
    // Break caught: descriptor/prototype traps execute or a malformed claim reaches hashing.
    const built = buildInstalledPackageArtifactSetClaim(input(), INTEGRITY);
    const levels = ["claim", "value", "key", "item", "anchor"] as const;
    for (const level of levels) {
      const claims = [structuredClone(built.claim)];
      const target = level === "claim" ? claims[0]!
        : level === "value" ? claims[0]!.value
          : level === "key" ? claims[0]!.value.key
            : level === "item" ? claims[0]!.value.orderedArtifacts[0]!
              : claims[0]!.anchor;
      let getters = 0;
      let callbacks = 0;
      const property = Object.keys(target)[0]!;
      const original = (target as unknown as Record<string, unknown>)[property];
      Object.defineProperty(target, property, {
        enumerable: true,
        get: () => { getters += 1; return original; },
      });
      expect(() => reconstructInstalledPackageArtifactSetClaim(claims, input(), {
        canonical: () => { callbacks += 1; return ""; },
        hash: () => { callbacks += 1; return ""; },
      }), level).toThrow("integrity_mismatch");
      expect({ getters, callbacks }, level).toEqual({ getters: 0, callbacks: 0 });
    }

    for (const mutate of [
      (claim: CityPackageAdministrativeEvidenceClaim) => {
        (claim.value as unknown as Record<symbol, unknown>)[Symbol("hidden")] = true;
      },
      (claim: CityPackageAdministrativeEvidenceClaim) => {
        Object.setPrototypeOf(claim.anchor, { inherited: true });
      },
    ]) {
      const claims = [structuredClone(built.claim)];
      mutate(claims[0]!);
      let callbacks = 0;
      expect(() => reconstructInstalledPackageArtifactSetClaim(claims, input(), {
        canonical: () => { callbacks += 1; return ""; },
        hash: () => { callbacks += 1; return ""; },
      })).toThrow("integrity_mismatch");
      expect(callbacks).toBe(0);
    }

    const revoked = Proxy.revocable([structuredClone(built.claim)], {});
    revoked.revoke();
    for (const claims of [
      new Proxy([structuredClone(built.claim)], {
        get: () => { throw new Error("trap"); },
        getOwnPropertyDescriptor: () => { throw new Error("trap"); },
        getPrototypeOf: () => { throw new Error("trap"); },
        ownKeys: () => { throw new Error("trap"); },
      }),
      revoked.proxy,
      (() => {
        const value = [structuredClone(built.claim)];
        Object.defineProperty(value, "0", { value: value[0], enumerable: false });
        return value;
      })(),
    ]) {
      let callbacks = 0;
      expect(() => reconstructInstalledPackageArtifactSetClaim(claims, input(), {
        canonical: () => { callbacks += 1; return ""; },
        hash: () => { callbacks += 1; return ""; },
      })).toThrow("integrity_mismatch");
      expect(callbacks).toBe(0);
    }
  });

  test("compares a private claim snapshot when an integrity callback mutates the caller graph", () => {
    // Break caught: reconstruction compares a live caller object after invoking callbacks.
    const built = buildInstalledPackageArtifactSetClaim(input(), INTEGRITY);
    const claims = [structuredClone(built.claim)];
    let first = true;
    const reconstructed = reconstructInstalledPackageArtifactSetClaim(claims, input(), {
      canonical(value) {
        if (first) {
          first = false;
          (claims[0]!.value as { evidenceId: string }).evidenceId = "mutated";
          (claims[0]!.value.orderedArtifacts[0] as { artifactId: string }).artifactId = "mutated";
          (claims[0]!.anchor as { locator: string }).locator = "mutated";
          claims.push(structuredClone(claims[0]!));
        }
        return canonicalJson(value);
      },
      hash: sha256Text,
    });
    expect(reconstructed).toEqual(built);
    expect(claims).toHaveLength(2);
  });

  test("captures one integrity authority before reconstruction callbacks", () => {
    // Break caught: reconstruction re-reads mutable integrity methods after its internal build.
    const built = buildInstalledPackageArtifactSetClaim(input(), INTEGRITY);
    const claims = [structuredClone(built.claim)];
    let first = true;
    let swappedCalls = 0;
    const integrity = {
      canonical(value: unknown): string {
        if (first) {
          first = false;
          integrity.canonical = () => {
            swappedCalls += 1;
            throw new Error("swapped canonical");
          };
          integrity.hash = () => {
            swappedCalls += 1;
            throw new Error("swapped hash");
          };
        }
        return canonicalJson(value);
      },
      hash: sha256Text,
    };
    expect(reconstructInstalledPackageArtifactSetClaim(claims, input(), integrity)).toEqual(built);
    expect(swappedCalls).toBe(0);

    let canonicalReads = 0;
    let hashReads = 0;
    const getterIntegrity = Object.defineProperties({}, {
      canonical: {
        enumerable: true,
        get() {
          canonicalReads += 1;
          return canonicalJson;
        },
      },
      hash: {
        enumerable: true,
        get() {
          hashReads += 1;
          return sha256Text;
        },
      },
    }) as typeof INTEGRITY;
    expect(reconstructInstalledPackageArtifactSetClaim(
      [structuredClone(built.claim)],
      input(),
      getterIntegrity,
    )).toEqual(built);
    expect({ canonicalReads, hashReads }).toEqual({ canonicalReads: 1, hashReads: 1 });
  });
});

describe("administrative Evidence shell", () => {
  function expectations(): AdministrativeEvidenceLoadExpectations {
    const built = buildInstalledPackageArtifactSetClaim(input(), INTEGRITY);
    return {
      evidenceId: built.evidenceId,
      installedAt: INSTALLED_AT,
      artifactIds: built.orderedArtifacts.map(({ artifactId }) => artifactId),
    };
  }

  function snapshot(): Record<string, unknown> {
    const built = buildInstalledPackageArtifactSetClaim(input(), INTEGRITY);
    return {
      id: built.evidenceId,
      assessmentDate: "2026-08-24",
      artifactIds: built.orderedArtifacts.map(({ artifactId }) => artifactId),
      claims: [structuredClone(built.claim)],
      blockers: [],
      coverage: { "city-package-installation": "verified" },
      parserVersions: {
        "city-package-installation": "city-package-administrative-json@1",
      },
      rulesVersion: "city-package-administrative-evidence@1",
      manifestHash: "b".repeat(64),
      hmac: "d".repeat(64),
    };
  }

  test("returns a fresh frozen exact shell with optional live bindings structurally absent", () => {
    // Break caught: the SQLite boundary supplies envelope literals or retains parsed row objects.
    const borrowedSnapshot = snapshot();
    const borrowedExpected = expectations();
    const shell = reconstructAdministrativeEvidenceShell(borrowedSnapshot, borrowedExpected);
    expect(Reflect.ownKeys(shell).sort()).toEqual([
      "artifactIds", "assessmentDate", "blockers", "claims", "coverage", "hmac", "id",
      "manifestHash", "parserVersions", "rulesVersion",
    ]);
    expect(shell.assessmentDate).toBe(INSTALLED_AT.slice(0, 10));
    expect(shell.artifactIds).toEqual(borrowedExpected.artifactIds);
    expect(shell.coverage).toEqual({ "city-package-installation": "verified" });
    expect(shell.blockers).toEqual([]);
    expect(shell.claims).toHaveLength(1);
    expect(shell.parserVersions).toEqual({
      "city-package-installation": "city-package-administrative-json@1",
    });
    expect(shell.rulesVersion).toBe("city-package-administrative-evidence@1");
    expect(shell).not.toHaveProperty("contextHash");
    expect(shell).not.toHaveProperty("knowledgeBaselineRevisionId");
    expect(shell).not.toBe(borrowedSnapshot);
    expect(shell.artifactIds).not.toBe(borrowedSnapshot.artifactIds);
    expect(shell.claims[0]).not.toBe((borrowedSnapshot.claims as unknown[])[0]);
    expect(isDeeplyFrozen(shell)).toBe(true);
    expect(Object.isFrozen(borrowedSnapshot)).toBe(false);
    expect(Object.isFrozen(borrowedExpected)).toBe(false);
  });

  test.each([
    ["id", (value: Record<string, unknown>) => { value.id = "other"; }],
    ["extra root", (value: Record<string, unknown>) => { value.extra = true; }],
    ["missing root", (value: Record<string, unknown>) => { delete value.hmac; }],
    ["assessment date", (value: Record<string, unknown>) => { value.assessmentDate = "2026-08-23"; }],
    ["artifact order", (value: Record<string, unknown>) => {
      const ids = value.artifactIds as string[];
      [ids[0], ids[1]] = [ids[1]!, ids[0]!];
    }],
    ["sparse artifact IDs", (value: Record<string, unknown>) => {
      value.artifactIds = new Array((value.artifactIds as string[]).length);
    }],
    ["zero claims", (value: Record<string, unknown>) => { value.claims = []; }],
    ["sparse claims", (value: Record<string, unknown>) => { value.claims = new Array(1); }],
    ["second claim", (value: Record<string, unknown>) => {
      const claims = value.claims as unknown[];
      claims.push(structuredClone(claims[0]));
    }],
    ["blocker", (value: Record<string, unknown>) => { value.blockers = [{ kind: "missing" }]; }],
    ["sparse blockers", (value: Record<string, unknown>) => { value.blockers = new Array(1); }],
    ["coverage", (value: Record<string, unknown>) => {
      value.coverage = { "city-package-installation": "unavailable" };
    }],
    ["extra coverage key", (value: Record<string, unknown>) => {
      value.coverage = { "city-package-installation": "verified", other: "verified" };
    }],
    ["parser key", (value: Record<string, unknown>) => {
      value.parserVersions = { other: "city-package-administrative-json@1" };
    }],
    ["parser value", (value: Record<string, unknown>) => {
      value.parserVersions = { "city-package-installation": "other@1" };
    }],
    ["rules", (value: Record<string, unknown>) => { value.rulesVersion = "other@1"; }],
    ["context present undefined", (value: Record<string, unknown>) => { value.contextHash = undefined; }],
    ["baseline present undefined", (value: Record<string, unknown>) => {
      value.knowledgeBaselineRevisionId = undefined;
    }],
    ["context present", (value: Record<string, unknown>) => { value.contextHash = "context"; }],
    ["baseline present", (value: Record<string, unknown>) => {
      value.knowledgeBaselineRevisionId = "baseline";
    }],
    ["short manifest hash", (value: Record<string, unknown>) => { value.manifestHash = "a"; }],
    ["uppercase HMAC", (value: Record<string, unknown>) => { value.hmac = "A".repeat(64); }],
  ] as const)("rejects shell %s drift", (_name, mutate) => {
    const value = snapshot();
    mutate(value);
    expect(() => reconstructAdministrativeEvidenceShell(value, expectations()))
      .toThrow("integrity_mismatch");
  });

  test.each([
    ["wrong evidence ID", (value: AdministrativeEvidenceLoadExpectations) => {
      (value as { evidenceId: string }).evidenceId = "other";
    }],
    ["noncanonical installed time", (value: AdministrativeEvidenceLoadExpectations) => {
      (value as { installedAt: string }).installedAt = "2026-08-24T10:11:12Z";
    }],
    ["extra key", (value: AdministrativeEvidenceLoadExpectations) => {
      (value as unknown as { extra?: boolean }).extra = true;
    }],
    ["missing key", (value: AdministrativeEvidenceLoadExpectations) => {
      delete (value as unknown as { installedAt?: string }).installedAt;
    }],
    ["duplicate artifact", (value: AdministrativeEvidenceLoadExpectations) => {
      const ids = value.artifactIds as string[];
      ids[1] = ids[0]!;
    }],
    ["sparse artifacts", (value: AdministrativeEvidenceLoadExpectations) => {
      (value as unknown as { artifactIds: string[] }).artifactIds =
        new Array(value.artifactIds.length);
    }],
  ] as const)("rejects hostile expectations with %s", (_name, mutate) => {
    const expected = expectations();
    mutate(expected);
    expect(() => reconstructAdministrativeEvidenceShell(snapshot(), expected))
      .toThrow("integrity_mismatch");
  });

  test("rejects shell accessors, symbols, custom prototypes, and hostile expectations", () => {
    // Break caught: a pure row reconstructor executes borrowed descriptors or normalizes bad input.
    const targets = ["snapshot", "claim", "expectations"] as const;
    for (const target of targets) {
      const value = snapshot();
      const expected = expectations();
      const selected = target === "snapshot" ? value
        : target === "claim" ? (value.claims as Record<string, unknown>[])[0]!
          : expected;
      const key = Object.keys(selected)[0]!;
      const original = (selected as unknown as Record<string, unknown>)[key];
      let getters = 0;
      Object.defineProperty(selected, key, {
        enumerable: true,
        get: () => { getters += 1; return original; },
      });
      expect(() => reconstructAdministrativeEvidenceShell(value, expected), target)
        .toThrow("integrity_mismatch");
      expect(getters, target).toBe(0);
    }

    const symbol = snapshot();
    (symbol.claims as unknown as Record<symbol, unknown>[])[0]![Symbol("hidden")] = true;
    expect(() => reconstructAdministrativeEvidenceShell(symbol, expectations()))
      .toThrow("integrity_mismatch");
    const prototype = snapshot();
    Object.setPrototypeOf(prototype.parserVersions, { inherited: true });
    expect(() => reconstructAdministrativeEvidenceShell(prototype, expectations()))
      .toThrow("integrity_mismatch");
  });
});
