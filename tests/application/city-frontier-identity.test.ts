import { createHash } from "node:crypto";

import { describe, expect, expectTypeOf, test } from "vitest";

import {
  cityCriteriaPayloadHash,
  cityFrontierRunId,
  type CityCriteriaCommandPayload,
  type CityFrontierRunIdentity,
} from "../../src/application/city-data-contracts";
import {
  type CityBranchReadPort,
  type CityCommandResult,
  type CityCriteriaReadPort,
  type CityFrontierAppendInput,
  type CityFrontierAppendPort,
  type CityFrontierReadModel,
  type CityFrontierReadPort,
  type CityFrontierRevision,
  type CityFrontierStartIntent,
  type CityFrontierStartPublication,
  type CityFrontierStartPublicationResult,
  type CityFrontierStartWriterPort,
  type CityFrontierStorePort,
  type CityRankingReadPort,
  type CityRankingSnapshot,
  type CitySelectionHistoryReadPort,
  type CitySelectionWithBranch,
} from "../../src/application/city-frontier-contracts";
import type {
  PreCityBranchCommit,
  PreCityBranchSourceProjection,
} from "../../src/branch/city";
import type {
  CityCatalogRevision,
  CityRegistryRevision,
} from "../../src/decision/city-catalog";
import type {
  CityCriteriaSnapshot,
  CityCriterionDraft,
} from "../../src/decision/city-criteria";
import type { CityDecisionIntegrity } from "../../src/decision/city-integrity";
import type { CityFrontierVerificationBudget } from
  "../../src/decision/city-frontier-policy";
import type { InstalledCityPackageExactKey } from "../../src/research/city-package";

type MutableRecord = Record<PropertyKey, unknown>;

const CRITERIA = [
  {
    criterionId: "safety",
    definitionId: "safety@1",
    mode: "required",
    importance: 5,
    target: "2",
  },
  {
    criterionId: "long_term_rent",
    definitionId: "long-term-rent@1",
    mode: "weighted",
    importance: 4,
    target: "900",
  },
  {
    criterionId: "urban_transit",
    definitionId: "urban-transit@1",
    mode: "weighted",
    importance: 3,
    target: "0.7",
  },
  {
    criterionId: "fixed_broadband",
    definitionId: "fixed-broadband@1",
    mode: "weighted",
    importance: 2,
    target: "100",
  },
] as const satisfies readonly [
  CityCriterionDraft,
  CityCriterionDraft,
  CityCriterionDraft,
  CityCriterionDraft,
];

const CRITERIA_PAYLOAD: CityCriteriaCommandPayload = {
  schemaVersion: "city-criteria-command@1",
  profileSnapshotId: "profile:confirmed",
  preferenceProfileSnapshotId: "preference-profile:confirmed",
  criteria: CRITERIA,
  rulesVersion: "city-criteria@1",
};

const INSTALLED_CONTEXT: InstalledCityPackageExactKey = {
  countryCode: "SI",
  packageId: "si-cities",
  packageSchemaVersion: "si-cities@1",
  catalogRevisionId: "city-catalog:verified",
  evidenceRulesVersion: "si-city-evidence@1",
};

const BUDGET: CityFrontierVerificationBudget = {
  liveCityCandidateLimit: 10,
  targetSelectableCities: 3,
  rulesVersion: "city-frontier-budget@1",
};

const RUN_IDENTITY: CityFrontierRunIdentity = {
  schemaVersion: "city-frontier-run@1",
  resolvedCountryShortlistRevisionId: "country-resolution:resolved",
  countryCode: "SI",
  registryRevisionId: "city-registry:verified",
  installedPackageContext: INSTALLED_CONTEXT,
  criteriaPayloadHash: "a".repeat(64),
  catalogRulesVersion: "city-catalog@2",
  rankingRulesVersion: "city-ranker@1",
  verificationBudget: BUDGET,
};

function canonical(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(normalize);
    if (input !== null && typeof input === "object") {
      return Object.fromEntries(Object.keys(input).sort().map((key) => [
        key,
        normalize((input as Record<string, unknown>)[key]),
      ]));
    }
    return input;
  };
  return JSON.stringify(normalize(value));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const INTEGRITY: CityDecisionIntegrity = { canonical, hash: sha256 };

function recursivelyFrozen(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    expect(descriptor).toBeDefined();
    expect(descriptor !== undefined && "value" in descriptor).toBe(true);
    if (descriptor !== undefined && "value" in descriptor) {
      recursivelyFrozen(descriptor.value, seen);
    }
  }
}

function expectIntegrityMismatch(action: () => unknown): void {
  expect(action).toThrowError("integrity_mismatch");
}

describe("city frontier exact contracts", () => {
  test("pins the exact identity, start, persistence and history interfaces", () => {
    // Break caught: persistence gaining caller semantic authority or dropping identity inputs.
    type ExpectedCriteriaPayload = {
      readonly schemaVersion: "city-criteria-command@1";
      readonly profileSnapshotId: string;
      readonly preferenceProfileSnapshotId: string;
      readonly criteria: readonly [
        CityCriterionDraft,
        CityCriterionDraft,
        CityCriterionDraft,
        CityCriterionDraft,
      ];
      readonly rulesVersion: "city-criteria@1";
    };
    type ExpectedRunIdentity = {
      readonly schemaVersion: "city-frontier-run@1";
      readonly resolvedCountryShortlistRevisionId: string;
      readonly countryCode: string;
      readonly registryRevisionId: string;
      readonly installedPackageContext: InstalledCityPackageExactKey;
      readonly criteriaPayloadHash: string;
      readonly catalogRulesVersion: CityCatalogRevision["rulesVersion"];
      readonly rankingRulesVersion: "city-ranker@1";
      readonly verificationBudget: CityFrontierVerificationBudget;
    };
    type ExpectedStartIntent = {
      readonly schemaVersion: "city-frontier-start-intent@1";
      readonly runId: string;
      readonly resolvedCountryShortlistRevisionId: string;
      readonly countryCode: string;
      readonly criteriaPayloadHash: string;
    };
    type ExpectedAppendInput = { readonly revision: CityFrontierRevision };
    type ExpectedCommandResult = {
      readonly operation: import("../../src/application/city-frontier-contracts")
        .CityFrontierOperation;
      readonly revision: CityFrontierRevision;
    };
    type ExpectedPublication = {
      readonly intent: ExpectedStartIntent;
      readonly criteria: CityCriteriaSnapshot;
      readonly preCityBranch: PreCityBranchCommit;
      readonly preCitySource: PreCityBranchSourceProjection;
      readonly ranking: CityRankingSnapshot;
      readonly root: CityFrontierRevision;
    };
    type ExpectedPublicationResult = {
      readonly criteria: CityCriteriaSnapshot;
      readonly preCityBranch: PreCityBranchCommit;
      readonly ranking: CityRankingSnapshot;
      readonly root: CityFrontierRevision;
    };

    expectTypeOf<CityCriteriaCommandPayload>().toEqualTypeOf<ExpectedCriteriaPayload>();
    expectTypeOf<CityFrontierRunIdentity>().toEqualTypeOf<ExpectedRunIdentity>();
    expectTypeOf<CityFrontierStartIntent>().toEqualTypeOf<ExpectedStartIntent>();
    expectTypeOf<CityFrontierAppendInput>().toEqualTypeOf<ExpectedAppendInput>();
    expectTypeOf<CityCommandResult>().toEqualTypeOf<ExpectedCommandResult>();
    expectTypeOf<CityFrontierStartPublication>().toEqualTypeOf<ExpectedPublication>();
    expectTypeOf<CityFrontierStartPublicationResult>()
      .toEqualTypeOf<ExpectedPublicationResult>();
    expectTypeOf(cityCriteriaPayloadHash).toEqualTypeOf<(
      input: CityCriteriaCommandPayload,
      integrity: CityDecisionIntegrity,
    ) => string>();
    expectTypeOf(cityFrontierRunId).toEqualTypeOf<(
      input: CityFrontierRunIdentity,
      integrity: CityDecisionIntegrity,
    ) => string>();
  });

  test("pins inward read/write ports with no loader context or semantic proof DTO", () => {
    // Break caught: SQLite accepting Application projections/digests/evaluator context.
    expectTypeOf<CityCriteriaReadPort>().toEqualTypeOf<{
      loadCriteriaVerified(id: string): CityCriteriaSnapshot;
    }>();
    expectTypeOf<CityBranchReadPort>().toEqualTypeOf<{
      loadPreCityBranchVerified(id: string): PreCityBranchCommit;
      findPreCityBranchBySourceVerified(
        source: PreCityBranchSourceProjection,
      ): PreCityBranchCommit | undefined;
    }>();
    expectTypeOf<CityRankingReadPort>().toEqualTypeOf<{
      loadRankingVerified(id: string): CityRankingSnapshot;
    }>();
    expectTypeOf<CityFrontierReadPort>().toEqualTypeOf<{
      loadRevisionVerified(id: string): CityFrontierRevision;
      loadHeadVerified(runId: string): CityFrontierRevision;
      loadChainVerified(runId: string): readonly CityFrontierRevision[];
      findCommandVerified(
        runId: string,
        commandId: string,
      ): CityCommandResult | undefined;
    }>();
    expectTypeOf<CityFrontierAppendPort>().toEqualTypeOf<{
      appendRevision(input: CityFrontierAppendInput): CityFrontierRevision;
    }>();
    expectTypeOf<CityFrontierStorePort>()
      .toEqualTypeOf<CityFrontierReadPort & CityFrontierAppendPort>();
    expectTypeOf<CitySelectionHistoryReadPort>().toEqualTypeOf<{
      listSelectionsWithBranchesVerified(
        runId: string,
      ): Promise<readonly CitySelectionWithBranch[]>;
    }>();
    expectTypeOf<CityFrontierStartWriterPort>().toEqualTypeOf<{
      publishStart(
        input: CityFrontierStartPublication,
      ): CityFrontierStartPublicationResult;
    }>();
  });

  test("replaces the revision alias with the exact rich eleven-key read model", () => {
    // Break caught: Task 14 receiving only a revision or SQLite assembling the rich model.
    type ExpectedReadModel = {
      readonly runId: string;
      readonly assessmentAt: string;
      readonly resolvedCountryShortlistRevisionId: string;
      readonly countryCode: string;
      readonly preCityBranchCommitId: string;
      readonly registry: CityRegistryRevision;
      readonly catalog: CityCatalogRevision;
      readonly criteria: CityCriteriaSnapshot;
      readonly ranking: CityRankingSnapshot;
      readonly revision: CityFrontierRevision;
      readonly selections: readonly CitySelectionWithBranch[];
    };
    expectTypeOf<CityFrontierReadModel>().toEqualTypeOf<ExpectedReadModel>();
    expectTypeOf<CityFrontierReadModel>().not.toEqualTypeOf<CityFrontierRevision>();
  });
});

describe("city frontier exact identity", () => {
  test("hashes the exact five-key timestamp-free Criteria command payload", () => {
    // Break caught: Criteria identity including an ID/time or omitting one semantic input.
    const canonicalCalls: unknown[] = [];
    const integrity: CityDecisionIntegrity = {
      canonical(value) {
        canonicalCalls.push(structuredClone(value));
        return canonical(value);
      },
      hash: sha256,
    };

    const result = cityCriteriaPayloadHash(CRITERIA_PAYLOAD, integrity);

    expect(result).toBe(sha256(canonical(CRITERIA_PAYLOAD)));
    expect(result).toMatch(/^[0-9a-f]{64}$/);
    expect(canonicalCalls).toEqual([CRITERIA_PAYLOAD]);
    expect(Object.keys(canonicalCalls[0] as object).sort()).toEqual([
      "criteria",
      "preferenceProfileSnapshotId",
      "profileSnapshotId",
      "rulesVersion",
      "schemaVersion",
    ]);
    expect(canonicalCalls[0]).not.toHaveProperty("id");
    expect(canonicalCalls[0]).not.toHaveProperty("confirmedAt");
    expect(canonicalCalls[0]).not.toHaveProperty("createdAt");
  });

  test("derives the prefixed run ID from all nine exact identity keys", () => {
    // Break caught: a clock/snapshot entering run identity or installed context/budget being partial.
    const canonicalCalls: unknown[] = [];
    const integrity: CityDecisionIntegrity = {
      canonical(value) {
        canonicalCalls.push(structuredClone(value));
        return canonical(value);
      },
      hash: sha256,
    };

    const result = cityFrontierRunId(RUN_IDENTITY, integrity);

    expect(result).toBe(`city-frontier:${sha256(canonical(RUN_IDENTITY))}`);
    expect(result.slice("city-frontier:".length)).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(canonicalCalls[0] as object).sort()).toEqual([
      "catalogRulesVersion",
      "countryCode",
      "criteriaPayloadHash",
      "installedPackageContext",
      "rankingRulesVersion",
      "registryRevisionId",
      "resolvedCountryShortlistRevisionId",
      "schemaVersion",
      "verificationBudget",
    ]);
    expect(Object.keys(
      (canonicalCalls[0] as { installedPackageContext: object }).installedPackageContext,
    ).sort()).toEqual([
      "catalogRevisionId",
      "countryCode",
      "evidenceRulesVersion",
      "packageId",
      "packageSchemaVersion",
    ]);
    expect(Object.keys(
      (canonicalCalls[0] as { verificationBudget: object }).verificationBudget,
    ).sort()).toEqual([
      "liveCityCandidateLimit",
      "rulesVersion",
      "targetSelectableCities",
    ]);
    expect(canonicalCalls[0]).not.toHaveProperty("assessmentAt");
    expect(canonicalCalls[0]).not.toHaveProperty("createdAt");
    expect(canonicalCalls[0]).not.toHaveProperty("criteriaSnapshotId");
    expect(canonicalCalls[0]).not.toHaveProperty("rankingSnapshotId");
  });

  test.each(["city-catalog@1", "city-catalog@2"] as const)(
    "keeps authenticated historical Catalog rule %s replayable",
    (catalogRulesVersion) => {
      // Break caught: rewriting historical Catalog rules to only the current literal.
      const identity = { ...RUN_IDENTITY, catalogRulesVersion };
      expect(cityFrontierRunId(identity, INTEGRITY)).toBe(
        `city-frontier:${sha256(canonical(identity))}`,
      );
    },
  );

  test("feeds the exact C result into H for both identity equations", () => {
    // Break caught: invoking C for show but hashing a private/default serialization instead.
    const hashedInputs: string[] = [];
    const sentinelIntegrity: CityDecisionIntegrity = {
      canonical: () => "canonical-sentinel",
      hash(value) {
        hashedInputs.push(value);
        return "b".repeat(64);
      },
    };

    expect(cityCriteriaPayloadHash(CRITERIA_PAYLOAD, sentinelIntegrity))
      .toBe("b".repeat(64));
    expect(cityFrontierRunId(RUN_IDENTITY, sentinelIntegrity))
      .toBe(`city-frontier:${"b".repeat(64)}`);
    expect(hashedInputs).toEqual(["canonical-sentinel", "canonical-sentinel"]);
  });

  test("changes identity for every single semantic field without Cartesian expansion", () => {
    // Break caught: one exact identity field silently omitted from its canonical preimage.
    const baselineCriteria = cityCriteriaPayloadHash(CRITERIA_PAYLOAD, INTEGRITY);
    const changedCriteria: readonly CityCriteriaCommandPayload[] = [
      { ...CRITERIA_PAYLOAD, profileSnapshotId: "profile:other" },
      { ...CRITERIA_PAYLOAD, preferenceProfileSnapshotId: "preference-profile:other" },
      {
        ...CRITERIA_PAYLOAD,
        criteria: CRITERIA.map((item, index) => index === 0
          ? { ...item, target: "3" }
          : item) as unknown as CityCriteriaCommandPayload["criteria"],
      },
    ];
    expect(changedCriteria.map((input) =>
      cityCriteriaPayloadHash(input, INTEGRITY))).not.toContain(baselineCriteria);

    const baselineRun = cityFrontierRunId(RUN_IDENTITY, INTEGRITY);
    const mutations: readonly CityFrontierRunIdentity[] = [
      { ...RUN_IDENTITY, resolvedCountryShortlistRevisionId: "country-resolution:other" },
      { ...RUN_IDENTITY, countryCode: "AT" },
      { ...RUN_IDENTITY, registryRevisionId: "city-registry:other" },
      {
        ...RUN_IDENTITY,
        installedPackageContext: { ...INSTALLED_CONTEXT, packageId: "other-package" },
      },
      {
        ...RUN_IDENTITY,
        installedPackageContext: { ...INSTALLED_CONTEXT, countryCode: "AT" },
      },
      {
        ...RUN_IDENTITY,
        installedPackageContext: {
          ...INSTALLED_CONTEXT,
          packageSchemaVersion: "si-cities@2",
        },
      },
      {
        ...RUN_IDENTITY,
        installedPackageContext: {
          ...INSTALLED_CONTEXT,
          catalogRevisionId: "city-catalog:other",
        },
      },
      {
        ...RUN_IDENTITY,
        installedPackageContext: {
          ...INSTALLED_CONTEXT,
          evidenceRulesVersion: "si-city-evidence@2",
        },
      },
      { ...RUN_IDENTITY, criteriaPayloadHash: "b".repeat(64) },
      { ...RUN_IDENTITY, catalogRulesVersion: "city-catalog@1" },
    ];
    expect(mutations.map((input) => cityFrontierRunId(input, INTEGRITY)))
      .not.toContain(baselineRun);
  });

  test("rejects every mutated fixed identity literal instead of hashing it", () => {
    // Break caught: a fixed schema/ranker/Criteria/budget literal becoming open identity input.
    const criteriaMutations: readonly unknown[] = [
      { ...CRITERIA_PAYLOAD, schemaVersion: "city-criteria-command@2" },
      { ...CRITERIA_PAYLOAD, rulesVersion: "city-criteria@2" },
    ];
    const runMutations: readonly unknown[] = [
      { ...RUN_IDENTITY, schemaVersion: "city-frontier-run@2" },
      { ...RUN_IDENTITY, rankingRulesVersion: "city-ranker@2" },
      { ...RUN_IDENTITY, catalogRulesVersion: "city-catalog@unknown" },
      {
        ...RUN_IDENTITY,
        verificationBudget: { ...BUDGET, liveCityCandidateLimit: 9 },
      },
      {
        ...RUN_IDENTITY,
        verificationBudget: { ...BUDGET, targetSelectableCities: 4 },
      },
      {
        ...RUN_IDENTITY,
        verificationBudget: { ...BUDGET, rulesVersion: "city-frontier-budget@2" },
      },
    ];

    for (const input of criteriaMutations) {
      expectIntegrityMismatch(() => cityCriteriaPayloadHash(
        input as CityCriteriaCommandPayload,
        INTEGRITY,
      ));
    }
    for (const input of runMutations) {
      expectIntegrityMismatch(() => cityFrontierRunId(
        input as CityFrontierRunIdentity,
        INTEGRITY,
      ));
    }
  });

  test("rejects representative invalid scalar inputs before C or H", () => {
    // Break caught: hashing loose identifiers, country codes, draft scalars or digest inputs.
    let callbackCalls = 0;
    const integrity: CityDecisionIntegrity = {
      canonical() {
        callbackCalls += 1;
        return "never";
      },
      hash() {
        callbackCalls += 1;
        return "0".repeat(64);
      },
    };
    const invalidCriteria = [
      { ...CRITERIA_PAYLOAD, profileSnapshotId: "" },
      {
        ...CRITERIA_PAYLOAD,
        criteria: CRITERIA.map((criterion, index) => index === 0
          ? { ...criterion, importance: 6 }
          : criterion),
      },
    ];
    const invalidRuns = [
      { ...RUN_IDENTITY, countryCode: "si" },
      { ...RUN_IDENTITY, criteriaPayloadHash: "g".repeat(64) },
    ];

    for (const input of invalidCriteria) {
      expectIntegrityMismatch(() => cityCriteriaPayloadHash(
        input as CityCriteriaCommandPayload,
        integrity,
      ));
    }
    for (const input of invalidRuns) {
      expectIntegrityMismatch(() => cityFrontierRunId(
        input as CityFrontierRunIdentity,
        integrity,
      ));
    }
    expect(callbackCalls).toBe(0);
  });

  test("owns and closes descriptors, prototypes, symbols, tuples and aliases", () => {
    // Break caught: canonical/hash observing borrowed mutable or executable input graphs.
    let accessorCalls = 0;
    const accessor = { ...CRITERIA_PAYLOAD } as MutableRecord;
    Object.defineProperty(accessor, "profileSnapshotId", {
      enumerable: true,
      get() {
        accessorCalls += 1;
        return "profile:accessor";
      },
    });
    const sparse = { ...CRITERIA_PAYLOAD, criteria: new Array(4) };
    const sharedCriterion = { ...CRITERIA_PAYLOAD.criteria[0] };
    const aliased = {
      ...CRITERIA_PAYLOAD,
      criteria: [sharedCriterion, sharedCriterion, CRITERIA[2], CRITERIA[3]],
    };
    const hostileInputs: readonly unknown[] = [
      Object.assign(Object.create({ inherited: true }), CRITERIA_PAYLOAD),
      Object.assign({ ...CRITERIA_PAYLOAD }, { [Symbol("extra")]: true }),
      accessor,
      new Proxy({ ...CRITERIA_PAYLOAD }, {
        ownKeys() {
          accessorCalls += 1;
          throw new Error("proxy_trap_invoked");
        },
      }),
      sparse,
      aliased,
      { ...CRITERIA_PAYLOAD, extra: undefined },
      {
        ...CRITERIA_PAYLOAD,
        criteria: CRITERIA.map((criterion, index) => index === 0
          ? { ...criterion, extra: undefined }
          : criterion),
      },
      { ...CRITERIA_PAYLOAD, criteria: CRITERIA.slice(0, 3) },
    ];

    for (const input of hostileInputs) {
      expectIntegrityMismatch(() => cityCriteriaPayloadHash(
        input as CityCriteriaCommandPayload,
        INTEGRITY,
      ));
    }
    expect(accessorCalls).toBe(0);
  });

  test("closes the complete RunIdentity graph before either integrity callback", () => {
    // Break caught: validating the root but borrowing executable/open installed context or budget.
    let hostileReads = 0;
    let callbackCalls = 0;
    const integrity: CityDecisionIntegrity = {
      canonical() {
        callbackCalls += 1;
        return "never";
      },
      hash() {
        callbackCalls += 1;
        return "0".repeat(64);
      },
    };
    const accessorContext = { ...INSTALLED_CONTEXT } as MutableRecord;
    Object.defineProperty(accessorContext, "packageId", {
      enumerable: true,
      get() {
        hostileReads += 1;
        return "attacker";
      },
    });
    const swapping = structuredClone(RUN_IDENTITY) as unknown as MutableRecord;
    Object.defineProperty(swapping, "installedPackageContext", {
      enumerable: true,
      get() {
        hostileReads += 1;
        swapping.verificationBudget = { ...BUDGET, liveCityCandidateLimit: 9 };
        return INSTALLED_CONTEXT;
      },
    });
    const sharedNested = { ...INSTALLED_CONTEXT };
    const hostileInputs: readonly unknown[] = [
      Object.assign(Object.create({ inherited: true }), RUN_IDENTITY),
      { ...RUN_IDENTITY, installedPackageContext: accessorContext },
      {
        ...RUN_IDENTITY,
        verificationBudget: new Proxy({ ...BUDGET }, {
          ownKeys() {
            hostileReads += 1;
            throw new Error("budget_proxy_trap");
          },
        }),
      },
      {
        ...RUN_IDENTITY,
        installedPackageContext: Object.assign(
          { ...INSTALLED_CONTEXT },
          { [Symbol("extra")]: true },
        ),
      },
      {
        ...RUN_IDENTITY,
        installedPackageContext: Object.assign(
          Object.create({ inherited: true }),
          INSTALLED_CONTEXT,
        ),
      },
      swapping,
      {
        ...RUN_IDENTITY,
        installedPackageContext: sharedNested,
        verificationBudget: sharedNested,
      },
      {
        ...RUN_IDENTITY,
        installedPackageContext: { ...INSTALLED_CONTEXT, extra: undefined },
      },
      { ...RUN_IDENTITY, extra: undefined },
      {
        ...RUN_IDENTITY,
        verificationBudget: {
          liveCityCandidateLimit: 10,
          targetSelectableCities: 3,
        },
      },
    ];

    for (const input of hostileInputs) {
      expectIntegrityMismatch(() => cityFrontierRunId(
        input as CityFrontierRunIdentity,
        integrity,
      ));
    }
    expect(hostileReads).toBe(0);
    expect(callbackCalls).toBe(0);
  });

  test("both helpers pre-capture neutral C/H and private frozen inputs", () => {
    // Break caught: either helper borrowing input, using an outward receiver, or late-reading H after C.
    const cases = [
      {
        name: "Criteria payload",
        input: structuredClone(CRITERIA_PAYLOAD),
        expected: sha256(canonical(CRITERIA_PAYLOAD)),
        invoke: (input: unknown, integrity: CityDecisionIntegrity) =>
          cityCriteriaPayloadHash(input as CityCriteriaCommandPayload, integrity),
      },
      {
        name: "Run identity",
        input: structuredClone(RUN_IDENTITY),
        expected: `city-frontier:${sha256(canonical(RUN_IDENTITY))}`,
        invoke: (input: unknown, integrity: CityDecisionIntegrity) =>
          cityFrontierRunId(input as CityFrontierRunIdentity, integrity),
      },
    ] as const;
    const allReceivers: unknown[] = [];

    for (const boundary of cases) {
      const calls: string[] = [];
      const captured: unknown[] = [];
      const originalHash = function originalHash(this: unknown, value: string): string {
        calls.push("hash");
        allReceivers.push(this);
        return sha256(value);
      };
      const integrity: CityDecisionIntegrity = {
        canonical(this: unknown, value: unknown) {
          calls.push("canonical");
          allReceivers.push(this);
          captured.push(value);
          (boundary.input as unknown as MutableRecord).attacker = true;
          (integrity as unknown as MutableRecord).hash = () => "f".repeat(64);
          return canonical(value);
        },
        hash: originalHash,
      };

      expect(boundary.invoke(boundary.input, integrity), boundary.name)
        .toBe(boundary.expected);
      expect(calls, boundary.name).toEqual(["canonical", "hash"]);
      expect((boundary.input as unknown as MutableRecord).attacker, boundary.name).toBe(true);
      expect(captured, boundary.name).toHaveLength(1);
      expect(captured[0], boundary.name).not.toBe(boundary.input);
      recursivelyFrozen(captured[0]);
    }

    expect(allReceivers).toHaveLength(4);
    expect(new Set(allReceivers).size).toBe(4);
    expect(allReceivers.map((receiver) =>
      (receiver as { capability: string }).capability)).toEqual([
      "canonical",
      "hash",
      "canonical",
      "hash",
    ]);
    for (const receiver of allReceivers) {
      expect(Object.isFrozen(receiver)).toBe(true);
      expect(Reflect.ownKeys(receiver as object)).toEqual(["capability"]);
    }
  });

  test("rejects hostile integrity roots and callable C/H proxies before traps", () => {
    // Break caught: inheriting C/H authority or reflecting/accessing executable capability objects.
    let accessorReads = 0;
    let callbackCalls = 0;
    let proxyTraps = 0;
    const plain = () => ({
      canonical() {
        callbackCalls += 1;
        return "never";
      },
      hash() {
        callbackCalls += 1;
        return "0".repeat(64);
      },
    });
    const accessor = { hash: plain().hash } as MutableRecord;
    Object.defineProperty(accessor, "canonical", {
      enumerable: true,
      get() {
        accessorReads += 1;
        return plain().canonical;
      },
    });
    const symbol = plain() as MutableRecord;
    symbol[Symbol("extra")] = true;
    const inherited = Object.assign(Object.create({ inherited: true }), plain());
    const rootProxy = new Proxy(plain(), {
      ownKeys() {
        proxyTraps += 1;
        throw new Error("root_proxy_trap");
      },
    });
    const callableProxy = <T extends (...arguments_: never[]) => unknown>(target: T): T =>
      new Proxy(target, {
        apply(callable, receiver, argumentsList) {
          proxyTraps += 1;
          return Reflect.apply(callable, receiver, argumentsList);
        },
        get(callable, key, receiver) {
          proxyTraps += 1;
          return Reflect.get(callable, key, receiver);
        },
      });
    const proxiedCanonical = {
      canonical: callableProxy((() => "never") as (...arguments_: never[]) => string),
      hash: plain().hash,
    };
    const proxiedHash = {
      canonical: plain().canonical,
      hash: callableProxy((() => "0".repeat(64)) as (...arguments_: never[]) => string),
    };
    const cases = [
      {
        invoke: (integrity: CityDecisionIntegrity) =>
          cityCriteriaPayloadHash(CRITERIA_PAYLOAD, integrity),
        integrity: accessor,
      },
      {
        invoke: (integrity: CityDecisionIntegrity) =>
          cityFrontierRunId(RUN_IDENTITY, integrity),
        integrity: symbol,
      },
      {
        invoke: (integrity: CityDecisionIntegrity) =>
          cityCriteriaPayloadHash(CRITERIA_PAYLOAD, integrity),
        integrity: inherited,
      },
      {
        invoke: (integrity: CityDecisionIntegrity) =>
          cityFrontierRunId(RUN_IDENTITY, integrity),
        integrity: rootProxy,
      },
      {
        invoke: (integrity: CityDecisionIntegrity) =>
          cityCriteriaPayloadHash(CRITERIA_PAYLOAD, integrity),
        integrity: proxiedCanonical,
      },
      {
        invoke: (integrity: CityDecisionIntegrity) =>
          cityFrontierRunId(RUN_IDENTITY, integrity),
        integrity: proxiedHash,
      },
    ];

    for (const boundary of cases) {
      expectIntegrityMismatch(() => boundary.invoke(
        boundary.integrity as CityDecisionIntegrity,
      ));
    }
    expect(accessorReads).toBe(0);
    expect(callbackCalls).toBe(0);
    expect(proxyTraps).toBe(0);
  });

  test("returns fresh normalized errors for one malformed input per helper", () => {
    // Break caught: caching a boundary Error for repeated malformed Criteria/run graphs.
    const cases = [
      () => cityCriteriaPayloadHash(
        { ...CRITERIA_PAYLOAD, extra: true } as CityCriteriaCommandPayload,
        INTEGRITY,
      ),
      () => cityFrontierRunId(
        { ...RUN_IDENTITY, extra: true } as CityFrontierRunIdentity,
        INTEGRITY,
      ),
    ];

    for (const invoke of cases) {
      let first: unknown;
      let second: unknown;
      try {
        invoke();
      } catch (error) {
        first = error;
      }
      try {
        invoke();
      } catch (error) {
        second = error;
      }
      expect(first).toBeInstanceOf(Error);
      expect(second).toBeInstanceOf(Error);
      expect(first).not.toBe(second);
      expect((first as Error).message).toBe("integrity_mismatch");
      expect((second as Error).message).toBe("integrity_mismatch");
    }
  });

  test("normalizes hostile capabilities and rejects every non-lowerhex digest", () => {
    // Break caught: leaking capability errors or accepting uppercase/non-hex/raw-prefixed hashes.
    const badDigests = [
      "A".repeat(64),
      "g".repeat(64),
      "a".repeat(63),
      `sha256:${"a".repeat(64)}`,
    ];
    for (const digest of badDigests) {
      expectIntegrityMismatch(() => cityCriteriaPayloadHash(CRITERIA_PAYLOAD, {
        canonical,
        hash: () => digest,
      }));
      expectIntegrityMismatch(() => cityFrontierRunId(RUN_IDENTITY, {
        canonical,
        hash: () => digest,
      }));
    }
    const hostileError = new Error("hostile_integrity_error");
    const hostileCapabilities: readonly CityDecisionIntegrity[] = [
      {
        canonical: () => { throw hostileError; },
        hash: sha256,
      },
      {
        canonical: () => 7 as unknown as string,
        hash: sha256,
      },
      {
        canonical,
        hash: () => { throw hostileError; },
      },
      {
        canonical,
        hash: () => Promise.resolve("a".repeat(64)) as unknown as string,
      },
    ];
    for (const integrity of hostileCapabilities) {
      let first: unknown;
      let second: unknown;
      try {
        cityFrontierRunId(RUN_IDENTITY, integrity);
      } catch (error) {
        first = error;
      }
      try {
        cityFrontierRunId(RUN_IDENTITY, integrity);
      } catch (error) {
        second = error;
      }
      expect(first).toBeInstanceOf(Error);
      expect(second).toBeInstanceOf(Error);
      expect(first).not.toBe(second);
      expect(first).not.toBe(hostileError);
      expect(second).not.toBe(hostileError);
      expect((first as Error).message).toBe("integrity_mismatch");
      expect((second as Error).message).toBe("integrity_mismatch");
    }
  });
});
