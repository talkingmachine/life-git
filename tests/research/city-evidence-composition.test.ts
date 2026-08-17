import { describe, expect, test } from "vitest";

import {
  createCitySafetyEvaluator,
  type CitySafetyQuantity,
} from "../../src/decision/city-safety";
import type {
  Claim,
  LiveCapturedArtifact,
  ParserEntry,
} from "../../src/research/contracts";
import {
  citySafetyTerminalEntry,
  reconstructCityFixedAttemptLedger,
  reconstructCityFixedSourcePlan,
  runCityFixedSourcePlan,
  SLOVENIA_CITY_FACT_SOURCE_IDS,
  SLOVENIA_CITY_FIXED_CRITERION_BY_SOURCE,
  SLOVENIA_CITY_SAFETY_FACT_CONTRACT,
  type CityEvidenceClaim,
  type CityFixedAttempt,
  type CityFixedAttemptRejectionReason,
  type CityFixedAttemptLedger,
  type CityFixedAttemptLedgerExpectations,
  type CityFixedDeadlineScheduler,
  type CityFixedEvidenceClaim,
  type CityFixedRoute,
  type CityFixedRoutePort,
  type CityFixedSourcePlan,
  type CityFixedSourceRunInput,
  type CitySafetyTerminalEntryInput,
  type SloveniaCityFactSourceId,
  type SloveniaCityFixedSourceId,
} from "../../src/research/city-evidence";
import type {
  CitySafetyAttemptLedger,
  CitySafetyArtifactReference,
  CitySafetyCandidateAttempt,
} from "../../src/research/city-safety-evidence";
import type {
  CitySafetySourcePlan,
  OfficialAuthorityDirectory,
} from "../../src/research/city-safety-source-plan";
import {
  composeTerminalEvidenceEntries,
  sealEvidencePlan,
  type EvidenceIntegrity,
  type TerminalEvidenceEntry,
  type UnavailableEvidenceEntry,
  type VerifiedEvidenceEntry,
} from "../../src/research/research-plan";

const RUN_ID = "city-check:si:ljubljana:1";
const CITY_ID = "si:061011";
const ASSESSMENT_AT = "2026-08-16T10:00:00.000Z";
const DEADLINE_AT = "2026-08-16T10:00:01.000Z";

type Mutable<T> = T extends Uint8Array
  ? Uint8Array
  : T extends (...args: never[]) => unknown
    ? T
    : T extends readonly (infer U)[]
      ? Mutable<U>[]
      : T extends object
        ? { -readonly [K in keyof T]: Mutable<T[K]> }
        : T;

type MutableRentRunInput = {
  -readonly [K in keyof CityFixedSourceRunInput<"si-city-long-term-rent">]:
  CityFixedSourceRunInput<"si-city-long-term-rent">[K];
};

function artifact<S extends string>(
  sourceId: S,
  artifactId: string,
  byte: number,
  options: { readonly runId?: string; readonly role?: string; readonly url?: string } = {},
): LiveCapturedArtifact<S> {
  const url = options.url ?? `https://official.example/${artifactId}`;
  return {
    artifactId,
    runId: options.runId ?? RUN_ID,
    sourceId,
    role: options.role ?? "source",
    origin: "live",
    capturedAt: "2026-08-16T10:00:00.050Z",
    responseStatus: 200,
    responseUrl: url,
    request: { method: "GET", url },
    url,
    mediaType: "application/json",
    sha256: `${byte}`.padStart(64, "0"),
    bytes: new Uint8Array([byte]),
  };
}

function parserEntry<S extends string>(
  sourceId: S,
  route: CityFixedRoute,
  artifacts: readonly LiveCapturedArtifact<S>[],
  versionHint = "parser@1",
  resolvedEvidenceUrl = route.navigationUrl,
): ParserEntry<S> {
  return {
    sourceId,
    navigationUrl: route.navigationUrl,
    resolvedEvidenceUrl,
    artifacts,
    versionHint,
  };
}

function genericVerifiedEntry<S extends SloveniaCityFactSourceId>(
  sourceId: S,
  artifactValue: LiveCapturedArtifact<S>,
): VerifiedEvidenceEntry<S, CityEvidenceClaim<S>> {
  return {
    sourceId,
    coverage: "verified",
    parserEntry: {
      sourceId,
      navigationUrl: `https://official.example/${sourceId}`,
      resolvedEvidenceUrl: `https://official.example/${sourceId}/facts`,
      artifacts: [artifactValue],
      versionHint: `${sourceId}@1`,
    },
    claims: [{
      claimId: `${sourceId}:claim`,
      sourceId,
      value: sourceId === "si-city-safety"
        ? {
            kind: "municipal_safety" as const,
            quantity: {
              offenceCount: "1",
              population: "1000",
              rateBasis: "offences_per_100000_residents" as const,
            },
          }
        : { kind: "canonical_scalar" as const, value: "1" },
      scope: `municipality:${CITY_ID}`,
      sourcePeriod: "2025",
      anchor: {
        artifactId: artifactValue.artifactId,
        locator: artifactValue.url,
        excerptSha256: artifactValue.sha256,
      },
      status: "verified",
      criterionId: sourceId === "si-city-safety"
        ? "safety"
        : sourceId === "si-city-long-term-rent"
          ? "long_term_rent"
          : sourceId === "si-city-urban-transit"
            ? "urban_transit"
            : "fixed_broadband",
      definitionId: `${sourceId}-definition@1`,
      officialAreaId: "061",
      geoScope: "municipality",
      unit: "canonical_unit",
      denominator: "canonical_denominator",
      freshnessPolicyVersion: "annual@1",
    }] as readonly CityEvidenceClaim<S>[],
  };
}

function genericUnavailableEntry<S extends SloveniaCityFactSourceId>(
  sourceId: S,
  artifactValue: LiveCapturedArtifact<S>,
): UnavailableEvidenceEntry<S> {
  return {
    sourceId,
    coverage: "unavailable",
    parserEntry: {
      sourceId,
      navigationUrl: `https://official.example/${sourceId}`,
      resolvedEvidenceUrl: `https://official.example/${sourceId}/facts`,
      artifacts: [artifactValue],
      versionHint: `${sourceId}@1`,
    },
    blocker: {
      sourceId,
      kind: "not_found",
      navigationUrl: `https://official.example/${sourceId}`,
      resolvedUrl: `https://official.example/${sourceId}/facts`,
      artifactIds: [artifactValue.artifactId],
    },
  };
}

function integrityCounters(): EvidenceIntegrity & {
  readonly calls: { canonical: number; hash: number; sign: number };
} {
  const calls = { canonical: 0, hash: 0, sign: 0 };
  return {
    calls,
    canonical(value: unknown): string {
      calls.canonical += 1;
      return JSON.stringify(value);
    },
    hash(value: string): string {
      calls.hash += 1;
      return `hash:${value.length}`;
    },
    sign(value: string): string {
      calls.sign += 1;
      return `signature:${value.length}`;
    },
  };
}

function fixedPlan<S extends SloveniaCityFixedSourceId>(
  sourceId: S,
  routes: readonly CityFixedRoute[] = [
    { routeId: "primary", navigationUrl: "https://official.example/rent/primary" },
    { routeId: "secondary", navigationUrl: "https://official.example/rent/secondary" },
  ],
): CityFixedSourcePlan<S> {
  const criterionId = sourceId === "si-city-long-term-rent"
    ? "long_term_rent"
    : sourceId === "si-city-urban-transit"
      ? "urban_transit"
      : "fixed_broadband";
  return {
    planId: `${sourceId}-plan@1`,
    sourceId,
    cityId: CITY_ID,
    criterionId,
    definitionId: `${sourceId}-definition@1`,
    claimContract: {
      sourceId,
      criterionId,
      definitionId: `${sourceId}-definition@1`,
      scope: `municipality:${CITY_ID}`,
      officialAreaId: "061",
      geoScope: "municipality",
      unit: "EUR_per_square_metre_per_month",
      denominator: "qualifying_lease_contracts",
      freshnessPolicyVersion: "annual-calendar@1",
      valueKind: "canonical_scalar",
      valuePolicyVersion: "canonical-decimal@1",
      sourcePeriodPolicyVersion: "annual-period@1",
    },
    routes,
    parserVersion: "parser@1",
    rulesVersion: "rules@1",
  } as CityFixedSourcePlan<S>;
}

describe("fixed City source-plan reconstruction", () => {
  test.each([
    "si-city-long-term-rent",
    "si-city-urban-transit",
    "si-city-fixed-broadband",
  ] as const)("returns a fresh deeply frozen exact %s plan", (sourceId) => {
    // Break caught: retaining caller aliases or returning a merely shape-compatible cross-source plan.
    const borrowed = fixedPlan(sourceId);
    const reconstructed = reconstructCityFixedSourcePlan(borrowed, sourceId);

    expect(reconstructed).toEqual(borrowed);
    expect(reconstructed).not.toBe(borrowed);
    expect(reconstructed.routes).not.toBe(borrowed.routes);
    expect(Object.isFrozen(reconstructed)).toBe(true);
    expect(Object.isFrozen(reconstructed.claimContract)).toBe(true);
    expect(Object.isFrozen(reconstructed.routes)).toBe(true);
  });

  test("rejects a valid plan paired with a different expected source and every open plan surface", () => {
    // Break caught: allowing the caller's generic parameter to launder an unchecked runtime source ID.
    const rent = fixedPlan("si-city-long-term-rent");
    expect(() => reconstructCityFixedSourcePlan(rent, "si-city-urban-transit"))
      .toThrow("invalid_city_fixed_plan");
    expect(() => reconstructCityFixedSourcePlan({ ...rent, extra: true }, rent.sourceId))
      .toThrow("invalid_city_fixed_plan");
    expect(() => reconstructCityFixedSourcePlan({
      ...rent,
      routes: [rent.routes[0]!, rent.routes[0]!],
    }, rent.sourceId)).toThrow("invalid_city_fixed_plan");
    expect(() => reconstructCityFixedSourcePlan({
      ...rent,
      claimContract: { ...rent.claimContract, valueKind: "free_text" },
    }, rent.sourceId)).toThrow("invalid_city_fixed_plan");
  });

  test("preserves literal-source return narrowing at compile time", () => {
    // Break caught: widening the return type so fixed-source callers lose their tuple proof.
    const rent: CityFixedSourcePlan<"si-city-long-term-rent"> =
      reconstructCityFixedSourcePlan(fixedPlan("si-city-long-term-rent"), "si-city-long-term-rent");
    expect(rent.sourceId).toBe("si-city-long-term-rent");
  });

  test("rejects descriptor-open source plans without invoking borrowed accessors", () => {
    // Break caught: Object.entries/Array.map dropping hidden data or invoking a borrowed accessor before validation.
    const base = fixedPlan("si-city-long-term-rent");
    const cases: readonly [
      string,
      (value: CityFixedSourcePlan<"si-city-long-term-rent">, accessorRead: () => void) => void,
    ][] = [
      ["symbol key", (value) => {
        Object.defineProperty(value, Symbol("hidden"), { value: true, enumerable: true });
      }],
      ["nested symbol key", (value) => {
        Object.defineProperty(value.routes[0]!, Symbol("hidden"), {
          value: true,
          enumerable: true,
        });
      }],
      ["non-enumerable key", (value) => {
        Object.defineProperty(value, "hidden", { value: true, enumerable: false });
      }],
      ["accessor", (value, accessorRead) => {
        Object.defineProperty(value, "cityId", {
          configurable: true,
          enumerable: true,
          get() {
            accessorRead();
            return CITY_ID;
          },
        });
      }],
      ["custom prototype", (value) => {
        Object.setPrototypeOf(value, { inherited: true });
      }],
      ["sparse routes", (value) => {
        const routes = [...value.routes];
        delete routes[0];
        (value as unknown as { routes: typeof routes }).routes = routes;
      }],
      ["extra array property", (value) => {
        const routes = value.routes as unknown as Record<string, unknown>;
        Object.defineProperty(routes, "extra", { value: true, enumerable: true });
      }],
      ["cycle", (value) => {
        (value.claimContract as unknown as { scope: unknown }).scope = value.claimContract;
      }],
    ];

    for (const [name, mutate] of cases) {
      const borrowed = structuredClone(base);
      let accessorReads = 0;
      mutate(borrowed, () => { accessorReads += 1; });

      expect(
        () => reconstructCityFixedSourcePlan(borrowed, "si-city-long-term-rent"),
        name,
      ).toThrow("invalid_city_fixed_plan");
      expect(accessorReads, name).toBe(0);
    }
  });
});

class ManualDeadlineScheduler implements CityFixedDeadlineScheduler {
  callback: (() => void) | undefined;
  scheduledAt: string | undefined;
  cancelled = 0;

  schedule(deadlineAt: string, onDeadline: () => void): { cancel(): void } {
    this.scheduledAt = deadlineAt;
    this.callback = onDeadline;
    return { cancel: () => { this.cancelled += 1; } };
  }

  expire(): void {
    this.callback?.();
  }
}

function clock(...values: string[]): () => string {
  let index = 0;
  return () => {
    const value = values[index];
    if (value === undefined) throw new Error("unexpected_clock_read");
    index += 1;
    return value;
  };
}

function fixedRunInput<S extends SloveniaCityFixedSourceId>(
  plan: CityFixedSourcePlan<S>,
  now: () => string,
  scheduler = new ManualDeadlineScheduler(),
  signal = new AbortController().signal,
): CityFixedSourceRunInput<S> {
  return {
    cityCheckRunId: RUN_ID,
    cityId: plan.cityId,
    sourceId: plan.sourceId,
    criterionId: plan.criterionId,
    planId: plan.planId,
    definitionId: plan.definitionId,
    assessmentAt: ASSESSMENT_AT,
    deadlineAt: DEADLINE_AT,
    signal,
    now,
    deadlineScheduler: scheduler,
    validateValue: ({ value }) => value,
    validateSourcePeriod: () => "fresh",
  };
}

function fixedClaim<S extends SloveniaCityFixedSourceId>(
  plan: CityFixedSourcePlan<S>,
  artifactValue: LiveCapturedArtifact<S>,
  claimId = `${plan.sourceId}:claim`,
  sourcePeriod = "2025",
): CityFixedEvidenceClaim<S> {
  return {
    claimId,
    sourceId: plan.sourceId,
    value: { kind: "canonical_scalar", value: "9.5" },
    scope: plan.claimContract.scope,
    sourcePeriod,
    anchor: {
      artifactId: artifactValue.artifactId,
      locator: artifactValue.url,
      excerptSha256: artifactValue.sha256,
    },
    status: "verified",
    criterionId: plan.criterionId,
    definitionId: plan.definitionId,
    officialAreaId: plan.claimContract.officialAreaId,
    geoScope: plan.claimContract.geoScope,
    unit: plan.claimContract.unit,
    denominator: plan.claimContract.denominator,
    freshnessPolicyVersion: plan.claimContract.freshnessPolicyVersion,
  };
}

function rejectedInspection<S extends SloveniaCityFixedSourceId>(
  input: Parameters<CityFixedRoutePort<S, CityFixedEvidenceClaim<S>>["inspect"]>[0],
  plan: CityFixedSourcePlan<S>,
  artifactValue: LiveCapturedArtifact<S>,
  reason: Extract<CityFixedAttempt<S>, { disposition: "rejected" }>["reason"],
) {
  return {
    kind: "rejected" as const,
    attempt: {
      cityCheckRunId: input.cityCheckRunId,
      sourceId: input.sourceId,
      index: input.routeIndex,
      routeId: input.route.routeId,
      navigationUrl: input.route.navigationUrl,
      resolvedEvidenceUrl: `${input.route.navigationUrl}/resolved`,
      attemptedAt: input.attemptedAt,
      disposition: "rejected" as const,
      reason,
      artifactIds: [artifactValue.artifactId],
    },
    parserEntry: parserEntry(
      plan.sourceId,
      input.route,
      [artifactValue],
      plan.parserVersion,
      `${input.route.navigationUrl}/resolved`,
    ),
  };
}

function verifiedInspection<S extends SloveniaCityFixedSourceId>(
  input: Parameters<CityFixedRoutePort<S, CityFixedEvidenceClaim<S>>["inspect"]>[0],
  plan: CityFixedSourcePlan<S>,
  artifactValue: LiveCapturedArtifact<S>,
) {
  const claim = fixedClaim(plan, artifactValue);
  return {
    kind: "verified" as const,
    attempt: {
      cityCheckRunId: input.cityCheckRunId,
      sourceId: input.sourceId,
      index: input.routeIndex,
      routeId: input.route.routeId,
      navigationUrl: input.route.navigationUrl,
      resolvedEvidenceUrl: `${input.route.navigationUrl}/resolved`,
      attemptedAt: input.attemptedAt,
      disposition: "accepted" as const,
      artifactIds: [artifactValue.artifactId],
      claimIds: [claim.claimId],
    },
    parserEntry: parserEntry(
      plan.sourceId,
      input.route,
      [artifactValue],
      plan.parserVersion,
      `${input.route.navigationUrl}/resolved`,
    ),
    claims: [claim] as const,
  };
}

function ledgerExpectations<S extends SloveniaCityFixedSourceId>(
  plan: CityFixedSourcePlan<S>,
): CityFixedAttemptLedgerExpectations<S> {
  return {
    cityCheckRunId: RUN_ID,
    cityId: plan.cityId,
    sourceId: plan.sourceId,
    criterionId: plan.criterionId,
    planId: plan.planId,
    definitionId: plan.definitionId,
    valuePolicyVersion: plan.claimContract.valuePolicyVersion,
    sourcePeriodPolicyVersion: plan.claimContract.sourcePeriodPolicyVersion,
    routes: plan.routes,
    parserVersion: plan.parserVersion,
    rulesVersion: plan.rulesVersion,
    assessmentAt: ASSESSMENT_AT,
    notAfterAt: DEADLINE_AT,
  };
}

describe("terminal City Evidence composition", () => {
  test("orders heterogeneous batches, signs only at the following seal, and returns owned frozen copies", async () => {
    // Break caught: composition seals/signs early, leaks aliases, or preserves batch order.
    const inputs = SLOVENIA_CITY_FACT_SOURCE_IDS.map((sourceId, index) => {
      const captured = artifact(sourceId, `artifact-${index}`, index + 1);
      return sourceId === "si-city-urban-transit"
        ? genericUnavailableEntry(sourceId, captured)
        : genericVerifiedEntry(sourceId, captured);
    });
    const sourceBytes = inputs[0]!.parserEntry.artifacts[0]!.bytes;
    const integrity = integrityCounters();

    const composed = composeTerminalEvidenceEntries(
      SLOVENIA_CITY_FACT_SOURCE_IDS,
      [[inputs[3]!], [inputs[2]!, inputs[1]!], [inputs[0]!]],
    );

    expect(composed.map(({ sourceId }) => sourceId)).toEqual(SLOVENIA_CITY_FACT_SOURCE_IDS);
    expect(integrity.calls).toEqual({ canonical: 0, hash: 0, sign: 0 });
    expect(composed).not.toBe(inputs);
    expect(composed[0]).not.toBe(inputs[0]);
    expect(composed[0]!.parserEntry.artifacts[0]!.bytes).not.toBe(sourceBytes);
    expect(composed[0]!.parserEntry.artifacts[0]!.bytes).toEqual(sourceBytes);
    expect(Object.isFrozen(composed)).toBe(true);
    expect(Object.isFrozen(composed[0])).toBe(true);
    expect(Object.isFrozen(composed[0]!.parserEntry)).toBe(true);
    expect(Object.isFrozen(composed[0]!.parserEntry.artifacts)).toBe(true);
    expect(Object.isFrozen(composed[0]!.parserEntry.artifacts[0]!.bytes)).toBe(false);
    expect(Object.isFrozen(inputs[0])).toBe(false);
    expect(Object.isFrozen(sourceBytes)).toBe(false);

    const sealed = await sealEvidencePlan({
      id: "city-evidence:1",
      assessmentDate: "2026-08-16",
      entries: composed,
      sourceIds: SLOVENIA_CITY_FACT_SOURCE_IDS,
      parserVersions: {
        "si-city-safety": "si-city-safety-terminal@1",
        "si-city-long-term-rent": "si-city-long-term-rent-feasibility@1",
        "si-city-urban-transit": "si-city-urban-transit-feasibility@1",
        "si-city-fixed-broadband": "si-city-fixed-broadband-feasibility@1",
      },
      rulesVersion: "si-city-evidence@1",
    }, integrity);
    expect(integrity.calls.sign).toBe(1);
    expect(sealed.manifest.entries.map(({ sourceId }) => sourceId))
      .toEqual(SLOVENIA_CITY_FACT_SOURCE_IDS);
  });

  test("rejects nonterminal ownership, foreign entries, and cross-entry artifact collisions", () => {
    // Break caught: missing/foreign/duplicate ownership is accepted before the single seal.
    const safetyArtifact = artifact("si-city-safety", "shared", 1);
    const rentArtifact = artifact("si-city-long-term-rent", "rent", 2);
    const safety = genericVerifiedEntry("si-city-safety", safetyArtifact);
    const rent = genericUnavailableEntry("si-city-long-term-rent", rentArtifact);

    expect(() => composeTerminalEvidenceEntries([], [])).toThrow();
    expect(() => composeTerminalEvidenceEntries(
      ["si-city-safety", "si-city-safety"] as const,
      [[safety, safety]],
    )).toThrow();
    expect(() => composeTerminalEvidenceEntries(
      ["si-city-safety", "si-city-long-term-rent"] as const,
      [[safety]],
    )).toThrow();
    expect(() => composeTerminalEvidenceEntries(
      ["si-city-safety", "si-city-long-term-rent"] as const,
      [[safety, safety]],
    )).toThrow();
    expect(() => composeTerminalEvidenceEntries(
      ["si-city-safety"] as const,
      [[safety, rent] as readonly TerminalEvidenceEntry<
        SloveniaCityFactSourceId,
        CityEvidenceClaim
      >[]],
    )).toThrow();

    const foreignParser = structuredClone(safety) as unknown as Mutable<typeof safety>;
    foreignParser.parserEntry.sourceId = "si-city-long-term-rent" as typeof foreignParser.parserEntry.sourceId;
    expect(() => composeTerminalEvidenceEntries(["si-city-safety"], [[foreignParser]])).toThrow();

    const foreignAnchor = structuredClone(safety) as unknown as Mutable<typeof safety>;
    foreignAnchor.claims[0]!.anchor.artifactId = "foreign";
    expect(() => composeTerminalEvidenceEntries(["si-city-safety"], [[foreignAnchor]])).toThrow();

    const foreignBlocker = structuredClone(rent) as unknown as Mutable<typeof rent>;
    foreignBlocker.blocker.artifactIds = ["foreign"];
    expect(() => composeTerminalEvidenceEntries(["si-city-long-term-rent"], [[foreignBlocker]]))
      .toThrow();

    const collision = structuredClone(rent) as unknown as Mutable<typeof rent>;
    collision.parserEntry.artifacts[0]!.artifactId = "shared";
    collision.blocker.artifactIds = ["shared"];
    expect(() => composeTerminalEvidenceEntries(
      ["si-city-safety", "si-city-long-term-rent"],
      [[safety, collision] as readonly TerminalEvidenceEntry<
        SloveniaCityFactSourceId,
        CityEvidenceClaim
      >[]],
    )).toThrow();
  });

  test("snapshots accessor-backed source IDs before composition validation", () => {
    // Break caught: a source ID is valid during validation, then changes during output ordering.
    const sourceIds = ["si-city-safety"] as SloveniaCityFactSourceId[];
    const safety = genericVerifiedEntry(
      "si-city-safety",
      artifact("si-city-safety", "source-id-accessor", 44),
    );
    let sourceIdReads = 0;
    Object.defineProperty(sourceIds, 0, {
      configurable: true,
      enumerable: true,
      get: () => {
        sourceIdReads += 1;
        return sourceIdReads <= 3 ? "si-city-safety" : "si-city-forged";
      },
    });

    const composed = composeTerminalEvidenceEntries(sourceIds, [[safety]]);

    expect(composed[0]!.sourceId).toBe("si-city-safety");
    expect(sourceIdReads).toBe(1);
    expect(Object.isFrozen(sourceIds)).toBe(false);
  });

  test("snapshots accessor-backed batches before composition validation", () => {
    // Break caught: an entry is valid through validation and changes only during result cloning.
    const safety = genericVerifiedEntry(
      "si-city-safety",
      artifact("si-city-safety", "batch-accessor", 45),
    );
    let sourceIdReads = 0;
    Object.defineProperty(safety, "sourceId", {
      configurable: true,
      enumerable: true,
      get: () => {
        sourceIdReads += 1;
        return sourceIdReads <= 5 ? "si-city-safety" : "si-city-forged";
      },
    });
    const batches = [[safety]];

    const composed = composeTerminalEvidenceEntries(["si-city-safety"], batches);

    expect(composed[0]!.sourceId).toBe("si-city-safety");
    expect(sourceIdReads).toBe(1);
    expect(Object.isFrozen(batches)).toBe(false);
    expect(Object.isFrozen(safety.parserEntry.artifacts[0]!.bytes)).toBe(false);
  });

  test.each([
    ["claims", () => {
      const safety = genericVerifiedEntry(
        "si-city-safety",
        artifact("si-city-safety", "sparse-claims", 31),
      );
      const sparse = structuredClone(safety) as unknown as Mutable<typeof safety>;
      sparse.claims = new Array(1) as Mutable<typeof safety.claims>;
      expect(() => composeTerminalEvidenceEntries(["si-city-safety"], [[sparse]])).toThrow();
    }],
    ["parser artifacts", () => {
      const rent = genericUnavailableEntry(
        "si-city-long-term-rent",
        artifact("si-city-long-term-rent", "sparse-parser-artifacts", 32),
      );
      const sparse = structuredClone(rent) as unknown as Mutable<typeof rent>;
      sparse.parserEntry.artifacts = new Array(1) as Mutable<
        typeof rent.parserEntry.artifacts
      >;
      sparse.blocker.artifactIds = [];
      expect(() => composeTerminalEvidenceEntries(
        ["si-city-long-term-rent"],
        [[sparse]],
      )).toThrow();
    }],
    ["blocker artifact IDs", () => {
      const rent = genericUnavailableEntry(
        "si-city-long-term-rent",
        artifact("si-city-long-term-rent", "sparse-blocker-artifacts", 33),
      );
      const sparse = structuredClone(rent) as unknown as Mutable<typeof rent>;
      sparse.blocker.artifactIds = new Array(1) as string[];
      expect(() => composeTerminalEvidenceEntries(
        ["si-city-long-term-rent"],
        [[sparse]],
      )).toThrow();
    }],
    ["nested values", () => {
      type NestedClaim = Claim<{ readonly rows: readonly string[] }, "si-city-safety">;
      const captured = artifact("si-city-safety", "sparse-nested", 34);
      const entry: TerminalEvidenceEntry<"si-city-safety", NestedClaim> = {
        sourceId: "si-city-safety",
        coverage: "verified",
        parserEntry: {
          sourceId: "si-city-safety",
          navigationUrl: "https://official.example/sparse-nested",
          resolvedEvidenceUrl: "https://official.example/sparse-nested",
          artifacts: [captured],
          versionHint: "sparse-nested@1",
        },
        claims: [{
          claimId: "sparse-nested-claim",
          sourceId: "si-city-safety",
          value: { rows: new Array(1) as string[] },
          scope: "synthetic",
          sourcePeriod: "2025",
          anchor: {
            artifactId: captured.artifactId,
            locator: captured.url,
            excerptSha256: captured.sha256,
          },
          status: "verified",
        }],
      };
      expect(() => composeTerminalEvidenceEntries(["si-city-safety"], [[entry]])).toThrow();
    }],
  ] as const)("rejects sparse terminal %s arrays", (_name, assertion) => {
    // Break caught: Array iteration skips holes and seals an incomplete terminal value.
    assertion();
  });
});

describe("strict fixed-source City Evidence runner", () => {
  test("rejects a descriptor-open plan before scheduler or route-port effects", async () => {
    const plan = structuredClone(fixedPlan("si-city-long-term-rent", [
      { routeId: "only", navigationUrl: "https://official.example/rent/only" },
    ]));
    Object.defineProperty(plan, Symbol("hidden"), {
      value: true,
      enumerable: true,
    });
    const scheduler = new ManualDeadlineScheduler();
    let portCalls = 0;

    await expect(runCityFixedSourcePlan(
      fixedRunInput(
        plan,
        clock("2026-08-16T10:00:00.100Z"),
        scheduler,
      ),
      plan,
      {
        inspect: async () => {
          portCalls += 1;
          throw new Error("route_port_called");
        },
      },
    )).rejects.toThrow("invalid_city_fixed_plan");
    expect(scheduler.scheduledAt).toBeUndefined();
    expect(portCalls).toBe(0);
  });

  test("rejects a port claim forged from plan fields mutated during inspection", async () => {
    // Break caught: post-validation caller-plan mutation retargets the accepted claim contract.
    const plan = fixedPlan("si-city-long-term-rent", [
      { routeId: "only", navigationUrl: "https://official.example/rent/only" },
    ]) as Mutable<CityFixedSourcePlan<"si-city-long-term-rent">>;
    const captured = artifact(plan.sourceId, "plan-toctou", 35);
    const promise = runCityFixedSourcePlan(
      fixedRunInput(
        plan,
        clock("2026-08-16T10:00:00.100Z", "2026-08-16T10:00:00.200Z"),
      ),
      plan,
      {
        inspect: async (routeInput) => {
          plan.claimContract.scope = "municipality:forged";
          plan.claimContract.officialAreaId = "999";
          return verifiedInspection(routeInput, plan, captured);
        },
      },
    );

    await expect(promise).rejects.toThrow();
    expect(Object.isFrozen(plan)).toBe(false);
    expect(Object.isFrozen(plan.claimContract)).toBe(false);
  });

  test("uses owned input bindings and routes after caller mutation during inspection", async () => {
    // Break caught: the ledger and terminal URL reread mutable invocation objects after validation.
    const originalNavigationUrl = "https://official.example/rent/only";
    const plan = fixedPlan("si-city-long-term-rent", [
      { routeId: "only", navigationUrl: originalNavigationUrl },
    ]) as Mutable<CityFixedSourcePlan<"si-city-long-term-rent">>;
    const input = fixedRunInput(
      plan,
      clock("2026-08-16T10:00:00.100Z", "2026-08-16T10:00:00.200Z"),
    ) as MutableRentRunInput;
    const captured = artifact(plan.sourceId, "input-route-toctou", 36);
    const result = await runCityFixedSourcePlan(input, plan, {
      inspect: async (routeInput) => {
        input.cityId = "si:forged";
        input.assessmentAt = "2026-08-15T10:00:00.000Z";
        plan.routes[0]!.navigationUrl = "https://official.example/forged";
        return verifiedInspection(routeInput, plan, captured);
      },
    });

    expect(result.ledger.cityId).toBe(CITY_ID);
    expect(result.ledger.assessmentAt).toBe(ASSESSMENT_AT);
    expect(result.ledger.attempts[0]!.navigationUrl).toBe(originalNavigationUrl);
    expect(result.entry.parserEntry.navigationUrl).toBe(originalNavigationUrl);
    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(plan.routes[0])).toBe(false);
  });

  test("rejects output rebound to a port-mutated inspection input", async () => {
    // Break caught: the port rewrites the runner's validation baseline and forges matching output.
    const plan = fixedPlan("si-city-long-term-rent", [
      { routeId: "only", navigationUrl: "https://official.example/rent/only" },
    ]) as Mutable<CityFixedSourcePlan<"si-city-long-term-rent">>;
    const input = fixedRunInput(
      plan,
      clock("2026-08-16T10:00:00.100Z", "2026-08-16T10:00:00.200Z"),
    ) as MutableRentRunInput;
    const forgedRunId = "city-check:si:ljubljana:forged";

    await expect(runCityFixedSourcePlan(input, plan, {
      inspect: async (routeInput) => {
        const mutableRouteInput = routeInput as Mutable<typeof routeInput>;
        Object.assign(mutableRouteInput, {
          cityCheckRunId: forgedRunId,
          routeIndex: 7,
          attemptedAt: "2026-08-16T10:00:00.150Z",
        });
        const captured = artifact(plan.sourceId, "inspection-input-forgery", 40, {
          runId: forgedRunId,
        });
        return verifiedInspection(routeInput, plan, captured);
      },
    })).rejects.toThrow();

    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(plan)).toBe(false);
    expect(Object.isFrozen(plan.routes[0])).toBe(false);
  });

  test("stops policy validation when the caller aborts inside validateValue", async () => {
    // Break caught: source-period policy runs after the operation has already been aborted.
    const plan = fixedPlan("si-city-long-term-rent", [
      { routeId: "only", navigationUrl: "https://official.example/rent/only" },
    ]);
    const caller = new AbortController();
    const captured = artifact(plan.sourceId, "validator-abort", 37);
    let periodCalls = 0;
    await expect(runCityFixedSourcePlan(
      {
        ...fixedRunInput(
          plan,
          clock("2026-08-16T10:00:00.100Z", "2026-08-16T10:00:00.200Z"),
          new ManualDeadlineScheduler(),
          caller.signal,
        ),
        validateValue: ({ value }) => {
          caller.abort();
          return value;
        },
        validateSourcePeriod: () => {
          periodCalls += 1;
          return "fresh";
        },
      },
      plan,
      { inspect: async (routeInput) => verifiedInspection(routeInput, plan, captured) },
    )).rejects.toThrow("city_fixed_operation_aborted");
    expect(periodCalls).toBe(0);
  });

  test.each([
    ["validateValue invalid return", (
      input: MutableRentRunInput,
      caller: AbortController,
    ) => {
      input.validateValue = () => {
        caller.abort();
        return "forged";
      };
    }],
    ["validateValue throw", (
      input: MutableRentRunInput,
      caller: AbortController,
    ) => {
      input.validateValue = () => {
        caller.abort();
        throw new Error("synthetic_value_failure_after_abort");
      };
    }],
    ["validateSourcePeriod invalid return", (
      input: MutableRentRunInput,
      caller: AbortController,
    ) => {
      input.validateSourcePeriod = () => {
        caller.abort();
        return "fresh " as "fresh";
      };
    }],
    ["validateSourcePeriod throw", (
      input: MutableRentRunInput,
      caller: AbortController,
    ) => {
      input.validateSourcePeriod = () => {
        caller.abort();
        throw new Error("synthetic_period_failure_after_abort");
      };
    }],
  ] as const)("prefers caller abort over %s policy output", async (_name, configure) => {
    // Break caught: a validator's invalid return or throw masks an abort raised by that callback.
    const plan = fixedPlan("si-city-long-term-rent", [
      { routeId: "only", navigationUrl: "https://official.example/rent/only" },
    ]);
    const caller = new AbortController();
    const input = fixedRunInput(
      plan,
      clock("2026-08-16T10:00:00.100Z", "2026-08-16T10:00:00.200Z"),
      new ManualDeadlineScheduler(),
      caller.signal,
    ) as MutableRentRunInput;
    configure(input, caller);
    const captured = artifact(plan.sourceId, "validator-abort-precedence", 41);

    await expect(runCityFixedSourcePlan(
      input,
      plan,
      { inspect: async (routeInput) => verifiedInspection(routeInput, plan, captured) },
    )).rejects.toThrow("city_fixed_operation_aborted");
  });

  test("owns an earlier validated route before a later port call mutates its output", async () => {
    // Break caught: the complete union and ledger retain aliases to an earlier port result.
    const plan = fixedPlan("si-city-long-term-rent");
    const prefixArtifact = artifact(plan.sourceId, "owned-prefix", 36);
    const acceptedArtifact = artifact(plan.sourceId, "owned-accepted", 37);
    let prefixOutput: Mutable<ReturnType<
      typeof rejectedInspection<"si-city-long-term-rent">
    >> | undefined;
    const result = await runCityFixedSourcePlan(
      fixedRunInput(
        plan,
        clock(
          "2026-08-16T10:00:00.100Z",
          "2026-08-16T10:00:00.200Z",
          "2026-08-16T10:00:00.300Z",
          "2026-08-16T10:00:00.400Z",
        ),
      ),
      plan,
      {
        inspect: async (routeInput) => {
          if (routeInput.routeIndex === 0) {
            prefixOutput = rejectedInspection(
              routeInput,
              plan,
              prefixArtifact,
              "http_not_found",
            ) as Mutable<ReturnType<typeof rejectedInspection<"si-city-long-term-rent">>>;
            return prefixOutput;
          }
          prefixOutput!.attempt.artifactIds[0] = "mutated-prefix";
          prefixArtifact.bytes[0] = 99;
          return verifiedInspection(routeInput, plan, acceptedArtifact);
        },
      },
    );

    expect(result.kind).toBe("verified");
    expect(result.ledger.attempts[0]!.artifactIds).toEqual(["owned-prefix"]);
    expect([...result.artifacts[0]!.bytes]).toEqual([36]);
    expect(Object.isFrozen(prefixOutput)).toBe(false);
    expect(Object.isFrozen(prefixArtifact)).toBe(false);
  });

  test("validates one owned snapshot of accessor-backed port output", async () => {
    // Break caught: raw getters return valid data during validation and forged data during cloning.
    const plan = fixedPlan("si-city-long-term-rent", [
      { routeId: "only", navigationUrl: "https://official.example/rent/only" },
    ]);
    const captured = artifact(plan.sourceId, "accessor-snapshot", 42);
    let runIdReads = 0;
    const result = await runCityFixedSourcePlan(
      fixedRunInput(
        plan,
        clock("2026-08-16T10:00:00.100Z", "2026-08-16T10:00:00.200Z"),
      ),
      plan,
      {
        inspect: async (routeInput) => {
          const output = verifiedInspection(routeInput, plan, captured);
          Object.defineProperty(output.attempt, "cityCheckRunId", {
            configurable: true,
            enumerable: true,
            get: () => {
              runIdReads += 1;
              return runIdReads === 1 ? RUN_ID : "city-check:si:ljubljana:forged";
            },
          });
          return output;
        },
      },
    );

    expect(result.ledger.attempts[0]!.cityCheckRunId).toBe(RUN_ID);
    expect(runIdReads).toBe(1);
  });

  test("keeps the exported source-to-criterion policy immutable for later plan validation", async () => {
    // Break caught: one importer rewrites the runtime policy used to validate every later plan.
    const mutablePolicy = SLOVENIA_CITY_FIXED_CRITERION_BY_SOURCE as unknown as Record<
      "si-city-long-term-rent",
      string
    >;
    const originalCriterion = mutablePolicy["si-city-long-term-rent"];
    let mutationRejected = false;
    let result: Awaited<ReturnType<typeof runCityFixedSourcePlan>> | undefined;
    try {
      try {
        mutablePolicy["si-city-long-term-rent"] = "urban_transit";
      } catch {
        mutationRejected = true;
      }
      const plan = fixedPlan("si-city-long-term-rent", [
        { routeId: "only", navigationUrl: "https://official.example/rent/only" },
      ]);
      const captured = artifact(plan.sourceId, "frozen-criterion-policy", 43);
      result = await runCityFixedSourcePlan(
        fixedRunInput(
          plan,
          clock("2026-08-16T10:00:00.100Z", "2026-08-16T10:00:00.200Z"),
        ),
        plan,
        { inspect: async (routeInput) => verifiedInspection(routeInput, plan, captured) },
      );
    } finally {
      if (!Object.isFrozen(mutablePolicy)) {
        mutablePolicy["si-city-long-term-rent"] = originalCriterion;
      }
    }

    expect(mutationRejected).toBe(true);
    expect(Object.isFrozen(SLOVENIA_CITY_FIXED_CRITERION_BY_SOURCE)).toBe(true);
    expect(result?.kind).toBe("verified");
    expect(result?.ledger.criterionId).toBe("long_term_rent");
  });

  test("rejects cross-route artifact collision before invoking policy validators", async () => {
    // Break caught: stateful installed validators observe an integrity-invalid capture union.
    const plan = fixedPlan("si-city-long-term-rent");
    const first = artifact(plan.sourceId, "policy-order-duplicate", 38);
    const second = artifact(plan.sourceId, "policy-order-duplicate", 39);
    let valueCalls = 0;
    let periodCalls = 0;
    await expect(runCityFixedSourcePlan(
      {
        ...fixedRunInput(
          plan,
          clock(
            "2026-08-16T10:00:00.100Z",
            "2026-08-16T10:00:00.200Z",
            "2026-08-16T10:00:00.300Z",
            "2026-08-16T10:00:00.400Z",
          ),
        ),
        validateValue: ({ value }) => {
          valueCalls += 1;
          return value;
        },
        validateSourcePeriod: () => {
          periodCalls += 1;
          return "fresh";
        },
      },
      plan,
      {
        inspect: async (routeInput) => routeInput.routeIndex === 0
          ? rejectedInspection(routeInput, plan, first, "http_not_found")
          : verifiedInspection(routeInput, plan, second),
      },
    )).rejects.toThrow();
    expect(valueCalls).toBe(0);
    expect(periodCalls).toBe(0);
  });

  test("retains rejected-prefix artifacts in separate owned views and the generic sealed manifest", async () => {
    // Break caught: success drops previously checked official routes or aliases port-owned artifacts.
    const plan = fixedPlan("si-city-long-term-rent");
    const prefixArtifact = artifact(plan.sourceId, "rent-prefix", 11);
    const acceptedArtifact = artifact(plan.sourceId, "rent-accepted", 12);
    const valueInputs: unknown[] = [];
    const periodInputs: unknown[] = [];
    const scheduler = new ManualDeadlineScheduler();
    const input = {
      ...fixedRunInput(
        plan,
        clock(
          "2026-08-16T10:00:00.100Z",
          "2026-08-16T10:00:00.200Z",
          "2026-08-16T10:00:00.300Z",
          "2026-08-16T10:00:00.400Z",
        ),
        scheduler,
      ),
      validateValue: (value: Parameters<CityFixedSourceRunInput<typeof plan.sourceId>["validateValue"]>[0]) => {
        valueInputs.push(value);
        return value.value;
      },
      validateSourcePeriod: (
        value: Parameters<CityFixedSourceRunInput<typeof plan.sourceId>["validateSourcePeriod"]>[0],
      ) => {
        periodInputs.push(value);
        return "fresh" as const;
      },
    };
    const port: CityFixedRoutePort<typeof plan.sourceId, CityFixedEvidenceClaim<typeof plan.sourceId>> = {
      async inspect(routeInput) {
        return routeInput.routeIndex === 0
          ? rejectedInspection(routeInput, plan, prefixArtifact, "http_not_found")
          : verifiedInspection(routeInput, plan, acceptedArtifact);
      },
    };

    const result = await runCityFixedSourcePlan(input, plan, port);

    expect(result.kind).toBe("verified");
    if (result.kind !== "verified") throw new Error("expected_verified");
    expect(result.ledger.attempts.map(({ disposition }) => disposition)).toEqual([
      "rejected", "accepted",
    ]);
    expect(result.ledger.attempts.map(({ navigationUrl }) => navigationUrl))
      .toEqual(plan.routes.map(({ navigationUrl }) => navigationUrl));
    expect(result.ledger.attempts[1]).toEqual(expect.objectContaining({
      resolvedEvidenceUrl: "https://official.example/rent/secondary/resolved",
    }));
    expect(result.entry.parserEntry.navigationUrl).toBe(plan.routes[1]!.navigationUrl);
    expect(result.entry.parserEntry.resolvedEvidenceUrl)
      .toBe("https://official.example/rent/secondary/resolved");
    expect(result.entry.parserEntry.artifacts.map(({ artifactId }) => artifactId))
      .toEqual(["rent-prefix", "rent-accepted"]);
    expect(result.artifacts.map(({ artifactId }) => artifactId))
      .toEqual(["rent-prefix", "rent-accepted"]);
    expect(result.entry.parserEntry.artifacts).not.toBe(result.artifacts);
    expect(result.entry.parserEntry.artifacts[0]).not.toBe(result.artifacts[0]);
    expect(result.entry.parserEntry.artifacts[0]!.bytes).not.toBe(result.artifacts[0]!.bytes);
    expect(result.artifacts[0]!.bytes).not.toBe(prefixArtifact.bytes);
    expect(result.artifacts[0]!.bytes).toEqual(prefixArtifact.bytes);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.ledger)).toBe(true);
    expect(Object.isFrozen(result.entry.parserEntry.artifacts)).toBe(true);
    expect(Object.isFrozen(result.artifacts)).toBe(true);
    expect(Object.isFrozen(result.artifacts[0]!.bytes)).toBe(false);
    expect(Object.isFrozen(prefixArtifact)).toBe(false);
    expect(Object.isFrozen(prefixArtifact.bytes)).toBe(false);
    expect(scheduler.scheduledAt).toBe(DEADLINE_AT);
    expect(scheduler.cancelled).toBe(1);
    expect(valueInputs).toEqual([{
      sourceId: plan.sourceId,
      criterionId: plan.criterionId,
      definitionId: plan.definitionId,
      policyVersion: plan.claimContract.valuePolicyVersion,
      value: "9.5",
      unit: plan.claimContract.unit,
      denominator: plan.claimContract.denominator,
    }]);
    expect(periodInputs).toEqual([{
      sourceId: plan.sourceId,
      policyVersion: plan.claimContract.sourcePeriodPolicyVersion,
      sourcePeriod: "2025",
      assessmentAt: ASSESSMENT_AT,
    }]);

    const integrity = integrityCounters();
    const sealed = await sealEvidencePlan({
      id: "fixed-evidence:1",
      assessmentDate: "2026-08-16",
      entries: [result.entry],
      sourceIds: [plan.sourceId],
      parserVersions: { [plan.sourceId]: plan.parserVersion } as Record<
        typeof plan.sourceId,
        string
      >,
      rulesVersion: plan.rulesVersion,
    }, integrity);
    expect(sealed.manifest.entries[0]!.artifactIds).toEqual(["rent-prefix", "rent-accepted"]);
    expect(sealed.snapshot.artifactIds).toEqual(["rent-prefix", "rent-accepted"]);
  });

  test.each([
    ["conflict", "conflict"],
    ["transport_failure", "source_unavailable"],
    ["stale", "stale"],
    ["universe_incomplete", "not_comparable"],
    ["http_not_found", "not_found"],
  ] as const)("maps exhausted %s attempts to closed unknown %s", async (reason, expected) => {
    // Break caught: terminal reason precedence drifts or a complete rejection becomes an operation error.
    const plan = fixedPlan("si-city-long-term-rent", [
      { routeId: "only", navigationUrl: "https://official.example/rent/only" },
    ]);
    const captured = artifact(plan.sourceId, `artifact-${reason}`, 13);
    const result = await runCityFixedSourcePlan(
      fixedRunInput(
        plan,
        clock("2026-08-16T10:00:00.100Z", "2026-08-16T10:00:00.200Z"),
      ),
      plan,
      { inspect: async (routeInput) => rejectedInspection(routeInput, plan, captured, reason) },
    );

    expect(result.kind).toBe("unknown");
    if (result.kind !== "unknown") throw new Error("expected_unknown");
    expect(result.ledger.result).toEqual({ kind: "unknown", reason: expected });
    expect(result.entry.blocker.kind).toBe(expected);
    expect(result.entry.blocker.artifactIds).toEqual([captured.artifactId]);
    expect(result.ledger.attempts).toHaveLength(1);
  });

  test.each([
    ["stale", "stale"],
    ["not_comparable", "reference_period_unproved"],
  ] as const)(
    "normalizes a %s period decision into %s and continues to a later route",
    async (periodDecision, expectedReason) => {
      // Break caught: a nonfresh accepted claim escapes or prematurely exhausts later official routes.
      const plan = fixedPlan("si-city-long-term-rent");
      const firstArtifact = artifact(plan.sourceId, `period-${periodDecision}`, 14);
      const secondArtifact = artifact(plan.sourceId, "fresh-later", 15);
      let periodCall = 0;
      const input = {
        ...fixedRunInput(
          plan,
          clock(
            "2026-08-16T10:00:00.100Z",
            "2026-08-16T10:00:00.200Z",
            "2026-08-16T10:00:00.300Z",
            "2026-08-16T10:00:00.400Z",
          ),
        ),
        validateSourcePeriod: () => {
          periodCall += 1;
          return periodCall === 1 ? periodDecision : "fresh" as const;
        },
      };
      const result = await runCityFixedSourcePlan(input, plan, {
        inspect: async (routeInput) => verifiedInspection(
          routeInput,
          plan,
          routeInput.routeIndex === 0 ? firstArtifact : secondArtifact,
        ),
      });

      expect(result.kind).toBe("verified");
      expect(result.ledger.attempts).toEqual([
        expect.objectContaining({ disposition: "rejected", reason: expectedReason }),
        expect.objectContaining({ disposition: "accepted" }),
      ]);
      expect(result.ledger.attempts[0]).not.toHaveProperty("claimIds");
      expect(result.artifacts.map(({ artifactId }) => artifactId))
        .toEqual([firstArtifact.artifactId, secondArtifact.artifactId]);
    },
  );

  test.each([
    ["run", (value: Mutable<ReturnType<typeof verifiedInspection<"si-city-long-term-rent">>>) => {
      value.attempt.cityCheckRunId = "forged-run";
    }],
    ["source", (value: Mutable<ReturnType<typeof verifiedInspection<"si-city-long-term-rent">>>) => {
      value.attempt.sourceId = "si-city-urban-transit" as typeof value.attempt.sourceId;
    }],
    ["index", (value: Mutable<ReturnType<typeof verifiedInspection<"si-city-long-term-rent">>>) => {
      value.attempt.index = 1;
    }],
    ["route ID", (value: Mutable<ReturnType<typeof verifiedInspection<"si-city-long-term-rent">>>) => {
      value.attempt.routeId = "forged-route";
    }],
    ["navigation URL", (value: Mutable<ReturnType<typeof verifiedInspection<"si-city-long-term-rent">>>) => {
      value.attempt.navigationUrl = "https://official.example/forged";
    }],
    ["attempt time", (value: Mutable<ReturnType<typeof verifiedInspection<"si-city-long-term-rent">>>) => {
      value.attempt.attemptedAt = "2026-08-16T10:00:00.101Z";
    }],
    ["zero claims", (value: Mutable<ReturnType<typeof verifiedInspection<"si-city-long-term-rent">>>) => {
      value.claims = [];
    }],
    ["two claims", (value: Mutable<ReturnType<typeof verifiedInspection<"si-city-long-term-rent">>>) => {
      value.claims.push(structuredClone(value.claims[0]!));
    }],
    ["claim IDs", (value: Mutable<ReturnType<typeof verifiedInspection<"si-city-long-term-rent">>>) => {
      value.attempt.claimIds = ["forged-claim"];
    }],
    ["attempt artifacts", (value: Mutable<ReturnType<typeof verifiedInspection<"si-city-long-term-rent">>>) => {
      value.attempt.artifactIds = ["forged-artifact"];
    }],
    ["parser source", (value: Mutable<ReturnType<typeof verifiedInspection<"si-city-long-term-rent">>>) => {
      value.parserEntry.sourceId = "si-city-urban-transit" as typeof value.parserEntry.sourceId;
    }],
    ["parser navigation", (value: Mutable<ReturnType<typeof verifiedInspection<"si-city-long-term-rent">>>) => {
      value.parserEntry.navigationUrl = "https://official.example/forged";
    }],
    ["parser resolution", (value: Mutable<ReturnType<typeof verifiedInspection<"si-city-long-term-rent">>>) => {
      value.parserEntry.resolvedEvidenceUrl = "https://official.example/forged";
    }],
    ["parser version", (value: Mutable<ReturnType<typeof verifiedInspection<"si-city-long-term-rent">>>) => {
      value.parserEntry.versionHint = "forged@1";
    }],
    ["parser indexed lineage", (value: Mutable<ReturnType<typeof verifiedInspection<"si-city-long-term-rent">>>) => {
      value.parserEntry.indexedSourceUrl = "https://official.example/index";
    }],
    ["artifact run", (value: Mutable<ReturnType<typeof verifiedInspection<"si-city-long-term-rent">>>) => {
      const captured = value.parserEntry.artifacts[0] as unknown as Mutable<
        LiveCapturedArtifact<"si-city-long-term-rent">
      >;
      captured.runId = "forged-run";
    }],
    ["artifact source", (value: Mutable<ReturnType<typeof verifiedInspection<"si-city-long-term-rent">>>) => {
      const captured = value.parserEntry.artifacts[0] as unknown as Mutable<
        LiveCapturedArtifact<"si-city-long-term-rent">
      >;
      captured.sourceId = "si-city-urban-transit" as typeof captured.sourceId;
    }],
    ["claim scope", (value: Mutable<ReturnType<typeof verifiedInspection<"si-city-long-term-rent">>>) => {
      value.claims[0]!.scope = "municipality:forged";
    }],
    ["claim official area", (value: Mutable<ReturnType<typeof verifiedInspection<"si-city-long-term-rent">>>) => {
      value.claims[0]!.officialAreaId = "999";
    }],
    ["claim value kind", (value: Mutable<ReturnType<typeof verifiedInspection<"si-city-long-term-rent">>>) => {
      value.claims[0]!.value.kind = "forged" as typeof value.claims[0]["value"]["kind"];
    }],
    ["claim unit", (value: Mutable<ReturnType<typeof verifiedInspection<"si-city-long-term-rent">>>) => {
      value.claims[0]!.unit = "forged_unit";
    }],
    ["claim denominator", (value: Mutable<ReturnType<typeof verifiedInspection<"si-city-long-term-rent">>>) => {
      value.claims[0]!.denominator = "forged_denominator";
    }],
    ["claim freshness", (value: Mutable<ReturnType<typeof verifiedInspection<"si-city-long-term-rent">>>) => {
      value.claims[0]!.freshnessPolicyVersion = "forged@1";
    }],
    ["claim anchor", (value: Mutable<ReturnType<typeof verifiedInspection<"si-city-long-term-rent">>>) => {
      value.claims[0]!.anchor.artifactId = "forged-artifact";
    }],
  ] as const)("rejects malformed verified port output: %s", async (_name, mutate) => {
    // Break caught: a re-bound or non-contract claim becomes a terminal result.
    const plan = fixedPlan("si-city-long-term-rent", [
      { routeId: "only", navigationUrl: "https://official.example/rent/only" },
    ]);
    const captured = artifact(plan.sourceId, "malformed-output", 16);
    await expect(runCityFixedSourcePlan(
      fixedRunInput(
        plan,
        clock("2026-08-16T10:00:00.100Z", "2026-08-16T10:00:00.200Z"),
      ),
      plan,
      {
        inspect: async (routeInput) => {
          const output = structuredClone(
            verifiedInspection(routeInput, plan, captured),
          ) as unknown as Mutable<ReturnType<
            typeof verifiedInspection<"si-city-long-term-rent">
          >>;
          mutate(output);
          return output as unknown as ReturnType<
            typeof verifiedInspection<"si-city-long-term-rent">
          >;
        },
      },
    )).rejects.toThrow();
  });

  test("rejects duplicate artifact ownership across sequential routes", async () => {
    // Break caught: equal-looking cross-route captures are silently deduplicated.
    const plan = fixedPlan("si-city-long-term-rent");
    const first = artifact(plan.sourceId, "cross-route-duplicate", 16);
    const second = artifact(plan.sourceId, "cross-route-duplicate", 16);
    await expect(runCityFixedSourcePlan(
      fixedRunInput(
        plan,
        clock(
          "2026-08-16T10:00:00.100Z",
          "2026-08-16T10:00:00.200Z",
          "2026-08-16T10:00:00.300Z",
          "2026-08-16T10:00:00.400Z",
        ),
      ),
      plan,
      {
        inspect: async (routeInput) => routeInput.routeIndex === 0
          ? rejectedInspection(routeInput, plan, first, "http_not_found")
          : verifiedInspection(routeInput, plan, second),
      },
    )).rejects.toThrow();
  });

  test("rejects value-validator drift or throw without returning any terminal output", async () => {
    // Break caught: a noncanonical scalar or validator exception is converted to unknown.
    const plan = fixedPlan("si-city-long-term-rent", [
      { routeId: "only", navigationUrl: "https://official.example/rent/only" },
    ]);
    const captured = artifact(plan.sourceId, "value-drift", 16);
    const port = {
      inspect: async (routeInput: Parameters<CityFixedRoutePort<
        typeof plan.sourceId,
        CityFixedEvidenceClaim<typeof plan.sourceId>
      >["inspect"]>[0]) => verifiedInspection(routeInput, plan, captured),
    };
    await expect(runCityFixedSourcePlan({
      ...fixedRunInput(
        plan,
        clock("2026-08-16T10:00:00.100Z", "2026-08-16T10:00:00.200Z"),
      ),
      validateValue: () => "9.50",
    }, plan, port)).rejects.toThrow();
    await expect(runCityFixedSourcePlan({
      ...fixedRunInput(
        plan,
        clock("2026-08-16T10:00:00.100Z", "2026-08-16T10:00:00.200Z"),
      ),
      validateValue: () => { throw new Error("synthetic_validator_failure"); },
    }, plan, port)).rejects.toThrow("synthetic_validator_failure");
  });

  test("rejects a throwing or out-of-contract source-period validator", async () => {
    // Break caught: a malformed policy result is treated as fresh or converted into unknown.
    const plan = fixedPlan("si-city-long-term-rent", [
      { routeId: "only", navigationUrl: "https://official.example/rent/only" },
    ]);
    const captured = artifact(plan.sourceId, "period-validator-failure", 17);
    const port = {
      inspect: async (routeInput: Parameters<CityFixedRoutePort<
        typeof plan.sourceId,
        CityFixedEvidenceClaim<typeof plan.sourceId>
      >["inspect"]>[0]) => verifiedInspection(routeInput, plan, captured),
    };
    await expect(runCityFixedSourcePlan({
      ...fixedRunInput(
        plan,
        clock("2026-08-16T10:00:00.100Z", "2026-08-16T10:00:00.200Z"),
      ),
      validateSourcePeriod: () => { throw new Error("synthetic_period_failure"); },
    }, plan, port)).rejects.toThrow("synthetic_period_failure");
    await expect(runCityFixedSourcePlan({
      ...fixedRunInput(
        plan,
        clock("2026-08-16T10:00:00.100Z", "2026-08-16T10:00:00.200Z"),
      ),
      validateSourcePeriod: () => "fresh " as "fresh",
    }, plan, port)).rejects.toThrow();
  });

  test("bounds a signal-ignoring port by the absolute deadline and ignores late settlement", async () => {
    // Break caught: Promise.race is omitted, timer/listener leaks, or a late port mutates terminal state.
    const plan = fixedPlan("si-city-long-term-rent", [
      { routeId: "only", navigationUrl: "https://official.example/rent/only" },
    ]);
    const scheduler = new ManualDeadlineScheduler();
    let portSignal: AbortSignal | undefined;
    let resolveInspection: ((value: ReturnType<typeof verifiedInspection<typeof plan.sourceId>>) => void)
      | undefined;
    const neverSettled = new Promise<ReturnType<typeof verifiedInspection<typeof plan.sourceId>>>(
      (resolve) => { resolveInspection = resolve; },
    );
    const promise = runCityFixedSourcePlan(
      fixedRunInput(
        plan,
        clock("2026-08-16T10:00:00.100Z"),
        scheduler,
      ),
      plan,
      {
        inspect: async (routeInput) => {
          portSignal = routeInput.signal;
          return neverSettled;
        },
      },
    );
    await Promise.resolve();
    scheduler.expire();

    await expect(promise).rejects.toThrow();
    expect(portSignal?.aborted).toBe(true);
    expect(scheduler.cancelled).toBe(1);
    const captured = artifact(plan.sourceId, "late", 17);
    resolveInspection?.(verifiedInspection({
      cityCheckRunId: RUN_ID,
      cityId: CITY_ID,
      sourceId: plan.sourceId,
      criterionId: plan.criterionId,
      planId: plan.planId,
      definitionId: plan.definitionId,
      assessmentAt: ASSESSMENT_AT,
      deadlineAt: DEADLINE_AT,
      attemptedAt: "2026-08-16T10:00:00.100Z",
      routeIndex: 0,
      route: plan.routes[0]!,
      signal: portSignal!,
    }, plan, captured));
    await Promise.resolve();
  });

  test("ignores a separate late port rejection after the deadline", async () => {
    // Break caught: a detached source rejection becomes an unhandled failure after timeout cleanup.
    const plan = fixedPlan("si-city-long-term-rent", [
      { routeId: "only", navigationUrl: "https://official.example/rent/only" },
    ]);
    const scheduler = new ManualDeadlineScheduler();
    let rejectInspection: ((reason: Error) => void) | undefined;
    const late = new Promise<never>((_resolve, reject) => { rejectInspection = reject; });
    const promise = runCityFixedSourcePlan(
      fixedRunInput(plan, clock("2026-08-16T10:00:00.100Z"), scheduler),
      plan,
      { inspect: async () => late },
    );
    await Promise.resolve();
    scheduler.expire();

    await expect(promise).rejects.toThrow("city_fixed_deadline");
    rejectInspection?.(new Error("late-source-rejection"));
    await Promise.resolve();
    await Promise.resolve();
    expect(scheduler.cancelled).toBe(1);
  });

  test("rejects a deadline reached during the post-call clock before committing port state", async () => {
    // Break caught: a deadline raised by the post-call boundary is noticed only after a result exists.
    const plan = fixedPlan("si-city-long-term-rent", [
      { routeId: "only", navigationUrl: "https://official.example/rent/only" },
    ]);
    const scheduler = new ManualDeadlineScheduler();
    let clockReads = 0;
    const input = fixedRunInput(plan, () => {
      clockReads += 1;
      if (clockReads === 2) scheduler.expire();
      return clockReads === 1
        ? "2026-08-16T10:00:00.100Z"
        : "2026-08-16T10:00:00.200Z";
    }, scheduler);
    const captured = artifact(plan.sourceId, "deadline-during-post-clock", 18);

    await expect(runCityFixedSourcePlan(input, plan, {
      inspect: async (routeInput) => verifiedInspection(routeInput, plan, captured),
    })).rejects.toThrow("city_fixed_deadline");
    expect(scheduler.cancelled).toBe(1);
  });

  test("mirrors an already-aborted caller before any clock or port call", async () => {
    // Break caught: abort is observed only after starting source I/O.
    const plan = fixedPlan("si-city-long-term-rent", [
      { routeId: "only", navigationUrl: "https://official.example/rent/only" },
    ]);
    const caller = new AbortController();
    caller.abort("cancelled-before-start");
    let clockReads = 0;
    let portCalls = 0;
    await expect(runCityFixedSourcePlan(
      fixedRunInput(plan, () => {
        clockReads += 1;
        return ASSESSMENT_AT;
      }, new ManualDeadlineScheduler(), caller.signal),
      plan,
      {
        inspect: async () => {
          portCalls += 1;
          throw new Error("must_not_run");
        },
      },
    )).rejects.toThrow();
    expect(clockReads).toBe(0);
    expect(portCalls).toBe(0);
  });

  test.each([
    ["city", (input: MutableRentRunInput) => { input.cityId = "si:forged"; }],
    ["source", (input: MutableRentRunInput) => {
      input.sourceId = "si-city-urban-transit" as typeof input.sourceId;
    }],
    ["criterion", (input: MutableRentRunInput) => {
      input.criterionId = "urban_transit" as typeof input.criterionId;
    }],
    ["plan", (input: MutableRentRunInput) => { input.planId = "forged-plan@1"; }],
    ["definition", (input: MutableRentRunInput) => {
      input.definitionId = "forged-definition@1";
    }],
    ["assessment syntax", (input: MutableRentRunInput) => {
      input.assessmentAt = "2026-08-16T10:00:00Z";
    }],
    ["nonpositive deadline", (input: MutableRentRunInput) => {
      input.deadlineAt = input.assessmentAt;
    }],
  ] as const)("rejects mismatched run binding before clock/port: %s", async (_name, mutate) => {
    // Break caught: an invocation can silently retarget a validated plan.
    const plan = fixedPlan("si-city-long-term-rent");
    let clockReads = 0;
    let portCalls = 0;
    const input = fixedRunInput(plan, () => {
      clockReads += 1;
      return "2026-08-16T10:00:00.100Z";
    }) as MutableRentRunInput;
    mutate(input);
    await expect(runCityFixedSourcePlan(input, plan, {
      inspect: async () => {
        portCalls += 1;
        throw new Error("must_not_run");
      },
    })).rejects.toThrow();
    expect(clockReads).toBe(0);
    expect(portCalls).toBe(0);
  });

  test.each([
    ["attempt before assessment", ["2026-08-16T09:59:59.999Z"]],
    ["attempt at deadline", [DEADLINE_AT]],
    ["noncanonical attempt", ["2026-08-16T10:00:00Z"]],
    ["regressing completion", ["2026-08-16T10:00:00.100Z", "2026-08-16T10:00:00.099Z"]],
    ["completion at deadline", ["2026-08-16T10:00:00.100Z", DEADLINE_AT]],
    ["noncanonical completion", ["2026-08-16T10:00:00.100Z", "2026-08-16T10:00:00Z"]],
  ] as const)("rejects invalid clock boundary: %s", async (_name, values) => {
    // Break caught: an invalid attempt/completion instant is normalized into a ledger time.
    const plan = fixedPlan("si-city-long-term-rent", [
      { routeId: "only", navigationUrl: "https://official.example/rent/only" },
    ]);
    const captured = artifact(plan.sourceId, "clock-boundary", 19);
    await expect(runCityFixedSourcePlan(
      fixedRunInput(plan, clock(...values)),
      plan,
      { inspect: async (routeInput) => verifiedInspection(routeInput, plan, captured) },
    )).rejects.toThrow();
  });

  test("accepts equal assessment/attempt/completion instants below the deadline", async () => {
    // Break caught: semantic replay accidentally requires strictly increasing local clock reads.
    const plan = fixedPlan("si-city-long-term-rent", [
      { routeId: "only", navigationUrl: "https://official.example/rent/only" },
    ]);
    const captured = artifact(plan.sourceId, "clock-inclusive-boundary", 20);
    const result = await runCityFixedSourcePlan(
      fixedRunInput(plan, clock(ASSESSMENT_AT, ASSESSMENT_AT)),
      plan,
      { inspect: async (routeInput) => verifiedInspection(routeInput, plan, captured) },
    );
    expect(result.ledger.attempts[0]!.attemptedAt).toBe(ASSESSMENT_AT);
    expect(result.ledger.completedAt).toBe(ASSESSMENT_AT);
  });

  test.each([
    ["empty routes", (plan: Mutable<CityFixedSourcePlan<"si-city-long-term-rent">>) => { plan.routes = []; }],
    ["sparse routes", (plan: Mutable<CityFixedSourcePlan<"si-city-long-term-rent">>) => {
      plan.routes = new Array(1) as CityFixedRoute[];
    }],
    ["duplicate route IDs", (plan: Mutable<CityFixedSourcePlan<"si-city-long-term-rent">>) => {
      plan.routes[1]!.routeId = plan.routes[0]!.routeId;
    }],
    ["duplicate route URLs", (plan: Mutable<CityFixedSourcePlan<"si-city-long-term-rent">>) => {
      plan.routes[1]!.navigationUrl = plan.routes[0]!.navigationUrl;
    }],
    ["noncanonical URL", (plan: Mutable<CityFixedSourcePlan<"si-city-long-term-rent">>) => {
      plan.routes[0]!.navigationUrl = "https://OFFICIAL.example:443/rent/primary#fragment";
    }],
    ["empty plan ID", (plan: Mutable<CityFixedSourcePlan<"si-city-long-term-rent">>) => {
      plan.planId = "";
    }],
    ["empty parser version", (plan: Mutable<CityFixedSourcePlan<"si-city-long-term-rent">>) => {
      plan.parserVersion = "";
    }],
    ["criterion mapping", (plan: Mutable<CityFixedSourcePlan<"si-city-long-term-rent">>) => {
      plan.criterionId = "urban_transit" as typeof plan.criterionId;
    }],
  ] as const)("rejects invalid plan before the first port call: %s", async (_name, mutate) => {
    // Break caught: malformed fixed configuration reaches an external source boundary.
    const plan = structuredClone(fixedPlan("si-city-long-term-rent")) as Mutable<
      CityFixedSourcePlan<"si-city-long-term-rent">
    >;
    mutate(plan);
    let portCalls = 0;
    await expect(runCityFixedSourcePlan(
      fixedRunInput(plan, clock("2026-08-16T10:00:00.100Z")),
      plan,
      { inspect: async () => { portCalls += 1; throw new Error("must_not_run"); } },
    )).rejects.toThrow();
    expect(portCalls).toBe(0);
  });
});

describe("fixed-source attempt-ledger reconstruction", () => {
  function verifiedLedger(
    plan = fixedPlan("si-city-long-term-rent"),
  ): CityFixedAttemptLedger<"si-city-long-term-rent"> {
    return {
      schemaVersion: "city-fixed-attempt-ledger@1",
      cityCheckRunId: RUN_ID,
      cityId: plan.cityId,
      sourceId: plan.sourceId,
      criterionId: plan.criterionId,
      planId: plan.planId,
      definitionId: plan.definitionId,
      valuePolicyVersion: plan.claimContract.valuePolicyVersion,
      sourcePeriodPolicyVersion: plan.claimContract.sourcePeriodPolicyVersion,
      parserVersion: plan.parserVersion,
      rulesVersion: plan.rulesVersion,
      assessmentAt: ASSESSMENT_AT,
      attempts: [
        {
          cityCheckRunId: RUN_ID,
          sourceId: plan.sourceId,
          index: 0,
          routeId: plan.routes[0]!.routeId,
          navigationUrl: plan.routes[0]!.navigationUrl,
          resolvedEvidenceUrl: `${plan.routes[0]!.navigationUrl}/resolved`,
          attemptedAt: "2026-08-16T10:00:00.100Z",
          disposition: "rejected",
          reason: "http_not_found",
          artifactIds: ["prefix"],
        },
        {
          cityCheckRunId: RUN_ID,
          sourceId: plan.sourceId,
          index: 1,
          routeId: plan.routes[1]!.routeId,
          navigationUrl: plan.routes[1]!.navigationUrl,
          resolvedEvidenceUrl: `${plan.routes[1]!.navigationUrl}/resolved`,
          attemptedAt: "2026-08-16T10:00:00.300Z",
          disposition: "accepted",
          artifactIds: ["accepted"],
          claimIds: [`${plan.sourceId}:claim`],
        },
      ],
      result: { kind: "verified", claimIds: [`${plan.sourceId}:claim`] },
      completedAt: "2026-08-16T10:00:00.400Z",
    };
  }

  test("reconstructs an exact verified route prefix as a fresh frozen value", () => {
    // Break caught: semantic replay trusts mirrored route/version/time fields or returns aliases.
    const plan = fixedPlan("si-city-long-term-rent");
    const ledger = verifiedLedger(plan);
    const reconstructed = reconstructCityFixedAttemptLedger(ledger, ledgerExpectations(plan));
    expect(reconstructed).toEqual(ledger);
    expect(reconstructed).not.toBe(ledger);
    expect(reconstructed.attempts).not.toBe(ledger.attempts);
    expect(Object.isFrozen(reconstructed)).toBe(true);
    expect(Object.isFrozen(reconstructed.attempts)).toBe(true);
    expect(Object.isFrozen(reconstructed.attempts[0])).toBe(true);
    expect(Object.isFrozen(ledger)).toBe(false);
  });

  test("rejects a verified ledger whose accepted attempt owns no artifact", () => {
    // Break caught: a terminal verified claim is replayed without any captured artifact ownership.
    const plan = fixedPlan("si-city-long-term-rent");
    const ledger = verifiedLedger(plan) as Mutable<
      CityFixedAttemptLedger<"si-city-long-term-rent">
    >;
    const accepted = ledger.attempts.at(-1)!;
    if (accepted.disposition !== "accepted") throw new Error("fixture_error");
    accepted.artifactIds = [];

    expect(() => reconstructCityFixedAttemptLedger(ledger, ledgerExpectations(plan)))
      .toThrow("integrity_mismatch");
  });

  test("returns the owned reconstruction snapshot instead of rereading raw accessors", () => {
    // Break caught: an input ledger passes validation, then forges a field during return cloning.
    const plan = fixedPlan("si-city-long-term-rent");
    const ledger = verifiedLedger(plan);
    let cityReads = 0;
    Object.defineProperty(ledger, "cityId", {
      configurable: true,
      enumerable: true,
      get: () => {
        cityReads += 1;
        return cityReads === 1 ? CITY_ID : "si:forged";
      },
    });

    const reconstructed = reconstructCityFixedAttemptLedger(
      ledger,
      ledgerExpectations(plan),
    );

    expect(reconstructed.cityId).toBe(CITY_ID);
    expect(cityReads).toBe(1);
    expect(Object.isFrozen(ledger)).toBe(false);
  });

  test("validates one owned snapshot of reconstruction expectations", () => {
    // Break caught: repeated reads of a borrowed expectation disagree within one reconstruction.
    const plan = fixedPlan("si-city-long-term-rent");
    const expected = ledgerExpectations(plan);
    let cityReads = 0;
    Object.defineProperty(expected, "cityId", {
      configurable: true,
      enumerable: true,
      get: () => {
        cityReads += 1;
        return cityReads === 1 ? CITY_ID : "si:forged";
      },
    });

    const reconstructed = reconstructCityFixedAttemptLedger(verifiedLedger(plan), expected);

    expect(reconstructed.cityId).toBe(CITY_ID);
    expect(cityReads).toBe(1);
    expect(Object.isFrozen(expected)).toBe(false);
  });

  test.each([
    ["run", (ledger: Mutable<CityFixedAttemptLedger<"si-city-long-term-rent">>) => {
      ledger.cityCheckRunId = "forged-run";
    }],
    ["city", (ledger: Mutable<CityFixedAttemptLedger<"si-city-long-term-rent">>) => {
      ledger.cityId = "si:forged";
    }],
    ["source", (ledger: Mutable<CityFixedAttemptLedger<"si-city-long-term-rent">>) => {
      ledger.sourceId = "si-city-urban-transit" as typeof ledger.sourceId;
    }],
    ["criterion", (ledger: Mutable<CityFixedAttemptLedger<"si-city-long-term-rent">>) => {
      ledger.criterionId = "urban_transit" as typeof ledger.criterionId;
    }],
    ["plan", (ledger: Mutable<CityFixedAttemptLedger<"si-city-long-term-rent">>) => {
      ledger.planId = "forged-plan@1";
    }],
    ["definition", (ledger: Mutable<CityFixedAttemptLedger<"si-city-long-term-rent">>) => {
      ledger.definitionId = "forged@1";
    }],
    ["value policy", (ledger: Mutable<CityFixedAttemptLedger<"si-city-long-term-rent">>) => {
      ledger.valuePolicyVersion = "forged@1";
    }],
    ["period policy", (ledger: Mutable<CityFixedAttemptLedger<"si-city-long-term-rent">>) => {
      ledger.sourcePeriodPolicyVersion = "forged@1";
    }],
    ["parser", (ledger: Mutable<CityFixedAttemptLedger<"si-city-long-term-rent">>) => {
      ledger.parserVersion = "forged@1";
    }],
    ["rules", (ledger: Mutable<CityFixedAttemptLedger<"si-city-long-term-rent">>) => {
      ledger.rulesVersion = "forged@1";
    }],
    ["assessment", (ledger: Mutable<CityFixedAttemptLedger<"si-city-long-term-rent">>) => {
      ledger.assessmentAt = "2026-08-15T10:00:00.000Z";
    }],
    ["route order", (ledger: Mutable<CityFixedAttemptLedger<"si-city-long-term-rent">>) => {
      ledger.attempts.reverse();
    }],
    ["route ID", (ledger: Mutable<CityFixedAttemptLedger<"si-city-long-term-rent">>) => {
      ledger.attempts[0]!.routeId = "forged";
    }],
    ["route URL", (ledger: Mutable<CityFixedAttemptLedger<"si-city-long-term-rent">>) => {
      ledger.attempts[0]!.navigationUrl = "https://official.example/forged";
    }],
    ["attempt source", (ledger: Mutable<CityFixedAttemptLedger<"si-city-long-term-rent">>) => {
      ledger.attempts[0]!.sourceId = "si-city-urban-transit" as typeof ledger.attempts[0]["sourceId"];
    }],
    ["attempt time", (ledger: Mutable<CityFixedAttemptLedger<"si-city-long-term-rent">>) => {
      ledger.attempts[0]!.attemptedAt = "2026-08-16T09:59:59.999Z";
    }],
    ["rejection reason", (ledger: Mutable<CityFixedAttemptLedger<"si-city-long-term-rent">>) => {
      const attempt = ledger.attempts[0]!;
      if (attempt.disposition !== "rejected") throw new Error("fixture_error");
      attempt.reason = "forged_reason" as CityFixedAttemptRejectionReason;
    }],
    ["artifact ownership", (ledger: Mutable<CityFixedAttemptLedger<"si-city-long-term-rent">>) => {
      ledger.attempts[1]!.artifactIds = ["prefix"];
    }],
    ["claim binding", (ledger: Mutable<CityFixedAttemptLedger<"si-city-long-term-rent">>) => {
      const attempt = ledger.attempts[1]!;
      if (attempt.disposition !== "accepted") throw new Error("fixture_error");
      attempt.claimIds = ["forged"];
    }],
    ["post-acceptance extension", (ledger: Mutable<CityFixedAttemptLedger<"si-city-long-term-rent">>) => {
      ledger.attempts.push({
        cityCheckRunId: RUN_ID,
        sourceId: ledger.sourceId,
        index: 2,
        routeId: "extra",
        navigationUrl: "https://official.example/extra",
        attemptedAt: "2026-08-16T10:00:00.350Z",
        disposition: "rejected",
        reason: "http_not_found",
        artifactIds: ["extra"],
      });
    }],
    ["regressing completion", (ledger: Mutable<CityFixedAttemptLedger<"si-city-long-term-rent">>) => {
      ledger.completedAt = "2026-08-16T10:00:00.200Z";
    }],
  ] as const)("rejects re-signed semantic mutation: %s", (_name, mutate) => {
    // Break caught: reconstruction relies on a future signature without replaying pinned semantics.
    const plan = fixedPlan("si-city-long-term-rent");
    const forged = structuredClone(verifiedLedger(plan)) as Mutable<
      CityFixedAttemptLedger<"si-city-long-term-rent">
    >;
    mutate(forged);
    expect(() => reconstructCityFixedAttemptLedger(forged, ledgerExpectations(plan)))
      .toThrow("integrity_mismatch");
  });

  test("requires a full all-rejected route list for unknown and enforces the notAfter bound", () => {
    // Break caught: an unknown truncates attempts or is replayed after the caller's signed upper bound.
    const plan = fixedPlan("si-city-long-term-rent");
    const verified = verifiedLedger(plan);
    const unknown: CityFixedAttemptLedger<"si-city-long-term-rent"> = {
      ...verified,
      attempts: verified.attempts.map((attempt) => ({
        cityCheckRunId: attempt.cityCheckRunId,
        sourceId: attempt.sourceId,
        index: attempt.index,
        routeId: attempt.routeId,
        navigationUrl: attempt.navigationUrl,
        ...(attempt.resolvedEvidenceUrl === undefined
          ? {}
          : { resolvedEvidenceUrl: attempt.resolvedEvidenceUrl }),
        attemptedAt: attempt.attemptedAt,
        disposition: "rejected" as const,
        reason: "http_not_found" as const,
        artifactIds: attempt.artifactIds,
      })),
      result: { kind: "unknown", reason: "not_found" },
    };
    expect(reconstructCityFixedAttemptLedger(unknown, ledgerExpectations(plan))).toEqual(unknown);

    expect(() => reconstructCityFixedAttemptLedger(
      { ...unknown, attempts: unknown.attempts.slice(0, 1) },
      ledgerExpectations(plan),
    )).toThrow("integrity_mismatch");
    expect(() => reconstructCityFixedAttemptLedger(unknown, {
      ...ledgerExpectations(plan),
      notAfterAt: "2026-08-16T10:00:00.399Z",
    })).toThrow("integrity_mismatch");
  });
});

function safetyContext(): {
  readonly sourcePlan: CitySafetySourcePlan;
  readonly authorityDirectory: OfficialAuthorityDirectory;
} {
  const authorityDirectory: OfficialAuthorityDirectory = {
    schemaVersion: "official-authority-directory@1",
    id: "authority-directory:si@1",
    countryCode: "SI",
    catalogRevisionId: "city-catalog:si@2",
    requiredPublisherIds: {
      police: "police-si",
      gov: "gov-si",
      opsi: "opsi-si",
      surs: "surs-si",
    },
    publishers: [
      {
        publisherId: "police-si",
        authorityKind: "police",
        navigationUrl: "https://www.policija.si/",
        allowedHosts: ["www.policija.si"],
        delegatedDocumentHosts: [],
        allowedMediaTypes: ["application/pdf"],
        maxBytes: 1_000_000,
        redirectPolicyVersion: "official-chain@1",
        documentLocatorPolicyId: "pdf-page@1",
        retentionPolicyId: "police-retention@1",
        retentionMode: "seal_raw_artifact",
      },
      {
        publisherId: "municipality-ljubljana",
        authorityKind: "municipality",
        navigationUrl: "https://www.ljubljana.si/",
        allowedHosts: ["www.ljubljana.si"],
        delegatedDocumentHosts: [],
        allowedMediaTypes: ["application/pdf"],
        maxBytes: 1_000_000,
        redirectPolicyVersion: "official-chain@1",
        documentLocatorPolicyId: "pdf-page@1",
        retentionPolicyId: "municipality-retention@1",
        retentionMode: "seal_hash_locator_then_delete_transient",
      },
      {
        publisherId: "gov-si",
        authorityKind: "government",
        navigationUrl: "https://www.gov.si/",
        allowedHosts: ["www.gov.si"],
        delegatedDocumentHosts: [],
        allowedMediaTypes: ["text/html"],
        maxBytes: 1_000_000,
        redirectPolicyVersion: "official-chain@1",
        documentLocatorPolicyId: "html-selector@1",
        retentionPolicyId: "gov-retention@1",
        retentionMode: "seal_raw_artifact",
      },
      {
        publisherId: "opsi-si",
        authorityKind: "open_data",
        navigationUrl: "https://podatki.gov.si/",
        allowedHosts: ["podatki.gov.si"],
        delegatedDocumentHosts: [],
        allowedMediaTypes: ["application/json"],
        maxBytes: 1_000_000,
        redirectPolicyVersion: "official-chain@1",
        documentLocatorPolicyId: "json-pointer@1",
        retentionPolicyId: "opsi-retention@1",
        retentionMode: "seal_raw_artifact",
      },
      {
        publisherId: "surs-si",
        authorityKind: "statistics",
        navigationUrl: "https://pxweb.stat.si/",
        allowedHosts: ["pxweb.stat.si"],
        delegatedDocumentHosts: [],
        allowedMediaTypes: ["application/json"],
        maxBytes: 1_000_000,
        redirectPolicyVersion: "official-chain@1",
        documentLocatorPolicyId: "json-pointer@1",
        retentionPolicyId: "surs-retention@1",
        retentionMode: "seal_hash_locator_then_delete_transient",
      },
    ],
    municipalities: [{
      cityId: CITY_ID,
      settlementCode: "061011",
      municipalityCode: "061",
      officialCityNames: ["Ljubljana"],
      officialMunicipalityNames: ["Ljubljana"],
      publisherId: "municipality-ljubljana",
      officialHost: "www.ljubljana.si",
    }],
    rulesVersion: "slovenia-official-authorities@1",
  };
  const sourcePlan: CitySafetySourcePlan = {
    schemaVersion: "city-safety-source-plan@1",
    id: "city-safety-source-plan:si@1",
    catalogRevisionId: authorityDirectory.catalogRevisionId,
    authorityDirectoryId: authorityDirectory.id,
    entries: [{
      cityId: CITY_ID,
      settlementCode: "061011",
      municipalityCode: "061",
      officialCityNames: ["Ljubljana"],
      officialMunicipalityNames: ["Ljubljana"],
      publisherIds: ["municipality-ljubljana", "police-si"],
      configuredRoutes: [{
        publisherId: "municipality-ljubljana",
        navigationUrl: "https://www.ljubljana.si/safety/",
        resolvedEvidenceUrl: "https://www.ljubljana.si/safety/report.pdf",
      }],
    }],
    queryTemplateVersion: "slovenia-municipal-safety-query@1",
    definitionId: "si-municipal-police-offences-per-100000@1",
    freshnessPolicyVersion: "municipal-annual-july-boundary@1",
    discoveryRulesVersion: "city-safety-discovery@1",
  };
  return { sourcePlan, authorityDirectory };
}

const MUNICIPAL_ARTIFACT_SHA = "a".repeat(64);
const MUNICIPAL_SOURCE_SHA = "b".repeat(64);
const DENOMINATOR_ARTIFACT_SHA = "c".repeat(64);
const DENOMINATOR_SOURCE_SHA = "d".repeat(64);

function safetyArtifactReferences(): readonly [CitySafetyArtifactReference, CitySafetyArtifactReference] {
  return [
    {
      role: "municipal_source",
      documentRole: "terminal_claim",
      artifactId: "municipal-terminal",
      artifactSha256: MUNICIPAL_ARTIFACT_SHA,
      sourceSha256: MUNICIPAL_SOURCE_SHA,
      locator: "https://www.ljubljana.si/safety/report.pdf#page=4",
    },
    {
      role: "surs_denominator",
      artifactId: "surs-denominator",
      artifactSha256: DENOMINATOR_ARTIFACT_SHA,
      sourceSha256: DENOMINATOR_SOURCE_SHA,
      locator: "https://pxweb.stat.si/SiStatData/api/v1/sl/Data/05C5003S.px#/061/2025",
    },
  ];
}

function safetyLiveArtifacts(): readonly LiveCapturedArtifact<"si-city-safety">[] {
  const municipal = artifact(
    "si-city-safety",
    "municipal-terminal",
    21,
    { role: "municipal_source", url: "https://www.ljubljana.si/safety/report.pdf" },
  );
  const denominator = artifact(
    "si-city-safety",
    "surs-denominator",
    22,
    { role: "surs_denominator", url: "https://pxweb.stat.si/SiStatData/api/v1/sl/Data/05C5003S.px" },
  );
  return [
    { ...municipal, sha256: MUNICIPAL_ARTIFACT_SHA },
    { ...denominator, sha256: DENOMINATOR_ARTIFACT_SHA },
  ];
}

function usableSafetyAttempt(): Extract<CitySafetyCandidateAttempt, { disposition: "usable" }> {
  return {
    index: 0,
    origin: { kind: "configured", configuredRouteIndex: 0 },
    canonicalUrl: "https://www.ljubljana.si/safety/report.pdf",
    publisherId: "municipality-ljubljana",
    dataAuthorityId: "police-si",
    publisherNavigationUrl: "https://www.ljubljana.si/safety/",
    resolvedEvidenceUrl: "https://www.ljubljana.si/safety/report.pdf",
    officialTrace: {
      initialUrl: "https://www.ljubljana.si/safety/",
      edges: [{
        kind: "confirmed_document_link",
        fromUrl: "https://www.ljubljana.si/safety/",
        toUrl: "https://www.ljubljana.si/safety/report.pdf",
      }],
      lastTrustedUrl: "https://www.ljubljana.si/safety/report.pdf",
      officialHops: 1,
    },
    mediaType: "application/pdf",
    retentionPolicyId: "municipality-retention@1",
    transientRawDeleted: true,
    artifactRefs: safetyArtifactReferences(),
    disposition: "usable",
    referenceYear: 2025,
    periodDisposition: "preferred",
    quantity: {
      offenceCount: "1234",
      population: "300000",
      rateBasis: "offences_per_100000_residents",
    },
    denominator: {
      publisherId: "surs-si",
      municipalityCode: "061",
      referenceDate: "2025-01-01",
      population: "300000",
      artifactId: "surs-denominator",
      mediaType: "application/json",
      retentionPolicyId: "surs-retention@1",
      transientRawDeleted: true,
    },
  };
}

function rejectedSafetyAttempt(options: {
  readonly reviewed?: boolean;
  readonly artifactRefs?: readonly CitySafetyArtifactReference[];
} = {}): Extract<CitySafetyCandidateAttempt, { disposition: "rejected" }> {
  return {
    index: 0,
    origin: { kind: "configured", configuredRouteIndex: 0 },
    canonicalUrl: "https://www.ljubljana.si/safety/report.pdf",
    officialTrace: {
      initialUrl: "https://www.ljubljana.si/safety/",
      edges: [],
      lastTrustedUrl: "https://www.ljubljana.si/safety/report.pdf",
      officialHops: 0,
    },
    ...(options.reviewed
      ? {
          reviewedOfficial: {
            publisherId: "municipality-ljubljana",
            dataAuthorityId: "police-si",
            publisherNavigationUrl: "https://www.ljubljana.si/reviewed/",
            resolvedEvidenceUrl: "https://www.ljubljana.si/reviewed/report.pdf",
            referenceYear: 2024,
          },
        }
      : {}),
    artifactRefs: options.artifactRefs ?? [],
    disposition: "rejected",
    reason: "stale",
  };
}

function safetyLedger(options: {
  readonly result?: "verified" | "unknown";
  readonly candidates?: readonly CitySafetyCandidateAttempt[];
} = {}): CitySafetyAttemptLedger {
  const candidates = options.candidates ?? [usableSafetyAttempt()];
  const result = options.result ?? "verified";
  const quantity: CitySafetyQuantity = {
    offenceCount: "1234",
    population: "300000",
    rateBasis: "offences_per_100000_residents",
  };
  return {
    schemaVersion: "city-safety-attempt-ledger@1",
    catalogRevisionId: "city-catalog:si@2",
    authorityDirectoryId: "authority-directory:si@1",
    sourcePlanId: "city-safety-source-plan:si@1",
    cityId: CITY_ID,
    municipalityCode: "061",
    assessmentAt: ASSESSMENT_AT,
    definitionId: "si-municipal-police-offences-per-100000@1",
    freshnessPolicyVersion: "municipal-annual-july-boundary@1",
    discoveryRulesVersion: "city-safety-discovery@1",
    queries: [],
    candidates,
    counters: { queries: 0, candidates: candidates.length, maxOfficialHops: 1 },
    result: result === "verified"
      ? { kind: "verified", quantity, referenceYear: 2025, acceptedCandidateIndex: 0 }
      : { kind: "unknown", reason: "stale" },
    completedAt: "2026-08-16T10:00:00.500Z",
  };
}

function safetyTerminalInput(
  ledger = safetyLedger(),
  artifacts = safetyLiveArtifacts(),
): CitySafetyTerminalEntryInput {
  const { sourcePlan, authorityDirectory } = safetyContext();
  return { cityCheckRunId: RUN_ID, ledger, artifacts, sourcePlan, authorityDirectory };
}

describe("safety-ledger terminal Evidence adapter", () => {
  test("keeps the exported safety fact contract immutable for later adaptation", () => {
    // Break caught: an importer retargets the safety definition used by every later adapter call.
    const mutableContract = SLOVENIA_CITY_SAFETY_FACT_CONTRACT as unknown as {
      definitionId: string;
    };
    const originalDefinitionId = mutableContract.definitionId;
    let mutationRejected = false;
    let terminal: ReturnType<typeof citySafetyTerminalEntry> | undefined;
    let terminalError: unknown;
    try {
      try {
        mutableContract.definitionId = "forged-safety-definition@1";
      } catch {
        mutationRejected = true;
      }
      try {
        terminal = citySafetyTerminalEntry(safetyTerminalInput());
      } catch (error) {
        terminalError = error;
      }
    } finally {
      if (!Object.isFrozen(mutableContract)) {
        mutableContract.definitionId = originalDefinitionId;
      }
    }

    expect(mutationRejected).toBe(true);
    expect(Object.isFrozen(SLOVENIA_CITY_SAFETY_FACT_CONTRACT)).toBe(true);
    expect(terminalError).toBeUndefined();
    expect(terminal?.coverage).toBe("verified");
    if (terminal?.coverage !== "verified") throw new Error("expected_verified");
    expect(terminal.claims[0]!.definitionId)
      .toBe("si-municipal-police-offences-per-100000@1");
  });

  test("adapts one owned snapshot of accessor-backed safety artifacts", () => {
    // Break caught: an artifact hash passes validation and changes only during result cloning.
    const input = safetyTerminalInput();
    const municipalArtifact = input.artifacts[0]!;
    const originalSha256 = municipalArtifact.sha256;
    const forgedSha256 = "e".repeat(64);
    let sha256Reads = 0;
    Object.defineProperty(municipalArtifact, "sha256", {
      configurable: true,
      enumerable: true,
      get: () => {
        sha256Reads += 1;
        return sha256Reads <= 2 ? originalSha256 : forgedSha256;
      },
    });

    const result = citySafetyTerminalEntry(input);

    expect(result.parserEntry.artifacts[0]!.sha256).toBe(originalSha256);
    expect(sha256Reads).toBe(1);
    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(municipalArtifact)).toBe(false);
    expect(Object.isFrozen(municipalArtifact.bytes)).toBe(false);
    expect(Object.isFrozen(result.parserEntry.artifacts[0]!.bytes)).toBe(false);
  });

  test("maps the accepted safety result to the exact claim and complete owned artifact union", () => {
    // Break caught: Research duplicates the safety ledger, loses denominator proof, or aliases artifacts.
    const input = safetyTerminalInput();
    const result = citySafetyTerminalEntry(input);
    const evaluatorDefinition = createCitySafetyEvaluator({ zeroScoreBoundary: "1000" }).definition;

    expect(result.coverage).toBe("verified");
    if (result.coverage !== "verified") throw new Error("expected_verified");
    expect(result.parserEntry).toEqual(expect.objectContaining({
      sourceId: "si-city-safety",
      navigationUrl: "https://www.ljubljana.si/safety/",
      resolvedEvidenceUrl: "https://www.ljubljana.si/safety/report.pdf",
      versionHint: "si-city-safety-terminal@1",
    }));
    expect(result.parserEntry.artifacts.map(({ artifactId }) => artifactId))
      .toEqual(["municipal-terminal", "surs-denominator"]);
    expect(result.claims).toEqual([{
      claimId: `si-city-safety:${CITY_ID}:2025`,
      sourceId: "si-city-safety",
      value: {
        kind: "municipal_safety",
        quantity: {
          offenceCount: "1234",
          population: "300000",
          rateBasis: "offences_per_100000_residents",
        },
      },
      scope: "municipality:061",
      sourcePeriod: "2025",
      anchor: {
        artifactId: "municipal-terminal",
        locator: "https://www.ljubljana.si/safety/report.pdf#page=4",
        excerptSha256: MUNICIPAL_SOURCE_SHA,
      },
      status: "verified",
      criterionId: "safety",
      definitionId: evaluatorDefinition.definitionId,
      officialAreaId: "061",
      geoScope: "municipality",
      unit: evaluatorDefinition.unit,
      denominator: evaluatorDefinition.denominator,
      freshnessPolicyVersion: evaluatorDefinition.freshnessPolicyVersion,
    }]);
    expect(result.parserEntry.artifacts).not.toBe(input.artifacts);
    expect(result.parserEntry.artifacts[0]).not.toBe(input.artifacts[0]);
    expect(result.parserEntry.artifacts[0]!.bytes).not.toBe(input.artifacts[0]!.bytes);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.parserEntry.artifacts[0]!.bytes)).toBe(false);
    expect(Object.isFrozen(input.ledger)).toBe(false);
    expect(Object.isFrozen(input.artifacts[0])).toBe(false);
  });

  test("chooses accepted, final-reviewed, configured, then publisher lineage in that order", () => {
    // Break caught: generic Evidence fabricates a URL or keeps a per-route list outside the signed ledger.
    const accepted = citySafetyTerminalEntry(safetyTerminalInput());
    expect(accepted.parserEntry.navigationUrl).toBe("https://www.ljubljana.si/safety/");

    const reviewed = citySafetyTerminalEntry(safetyTerminalInput(
      safetyLedger({ result: "unknown", candidates: [rejectedSafetyAttempt({ reviewed: true })] }),
      [],
    ));
    expect(reviewed.parserEntry.navigationUrl).toBe("https://www.ljubljana.si/reviewed/");
    expect(reviewed.parserEntry.resolvedEvidenceUrl)
      .toBe("https://www.ljubljana.si/reviewed/report.pdf");

    const configured = citySafetyTerminalEntry(safetyTerminalInput(
      safetyLedger({ result: "unknown", candidates: [rejectedSafetyAttempt()] }),
      [],
    ));
    expect(configured.parserEntry.navigationUrl).toBe("https://www.ljubljana.si/safety/");
    expect(configured.parserEntry.resolvedEvidenceUrl)
      .toBe("https://www.ljubljana.si/safety/report.pdf");

    const publisherInput = safetyTerminalInput(safetyLedger({ result: "unknown", candidates: [] }), []);
    const sourcePlan = structuredClone(publisherInput.sourcePlan) as Mutable<CitySafetySourcePlan>;
    sourcePlan.entries[0]!.configuredRoutes = [];
    const publisher = citySafetyTerminalEntry({ ...publisherInput, sourcePlan });
    expect(publisher.parserEntry.navigationUrl).toBe("https://www.ljubljana.si/");
    expect(publisher.parserEntry.resolvedEvidenceUrl).toBe("https://www.ljubljana.si/");
    expect(publisher.coverage).toBe("unavailable");
    if (publisher.coverage !== "unavailable") throw new Error("expected_unavailable");
    expect(publisher.blocker.artifactIds).toEqual([]);
  });

  test("uses an earlier accepted candidate index and never an unknown usable candidate as lineage", () => {
    // Break caught: the adapter assumes the final candidate is accepted or treats usable as accepted.
    const laterRejected = { ...rejectedSafetyAttempt({ reviewed: true }), index: 1 };
    const verified = citySafetyTerminalEntry(safetyTerminalInput(safetyLedger({
      candidates: [usableSafetyAttempt(), laterRejected],
    })));
    expect(verified.coverage).toBe("verified");
    expect(verified.parserEntry.navigationUrl).toBe("https://www.ljubljana.si/safety/");

    const unknown = citySafetyTerminalEntry(safetyTerminalInput(
      safetyLedger({ result: "unknown", candidates: [usableSafetyAttempt(), laterRejected] }),
    ));
    expect(unknown.coverage).toBe("unavailable");
    expect(unknown.parserEntry.navigationUrl).toBe("https://www.ljubljana.si/reviewed/");
  });

  test("matches stored bytes to artifactSha256 and never to sourceSha256", () => {
    // Break caught: transient projection storage is compared to the deleted source-byte hash.
    expect(() => citySafetyTerminalEntry(safetyTerminalInput())).not.toThrow();
    const sourceHashArtifacts = safetyLiveArtifacts().map((value, index) => index === 0
      ? { ...value, sha256: MUNICIPAL_SOURCE_SHA }
      : value);
    expect(() => citySafetyTerminalEntry(safetyTerminalInput(
      safetyLedger(),
      sourceHashArtifacts,
    ))).toThrow();
  });

  test("leaves the source-hash, locator, and retention bridge to the signed-overlay boundary", () => {
    // Break caught: Task 6 revalidates Task 7's raw/projection bridge against stored projection bytes.
    const input = structuredClone(safetyTerminalInput()) as unknown as Mutable<
      CitySafetyTerminalEntryInput
    >;
    const accepted = input.ledger.candidates[0];
    if (accepted?.disposition !== "usable") throw new Error("fixture_error");
    const terminal = accepted.artifactRefs[0]!;
    terminal.sourceSha256 = "f".repeat(64);
    terminal.locator = "synthetic-task-7-locator";
    accepted.retentionPolicyId = "synthetic-task-7-retention@1";
    accepted.transientRawDeleted = false;

    const result = citySafetyTerminalEntry(input as unknown as CitySafetyTerminalEntryInput);
    expect(result.coverage).toBe("verified");
    if (result.coverage !== "verified") throw new Error("expected_verified");
    expect(result.claims[0]!.anchor).toEqual(expect.objectContaining({
      locator: "synthetic-task-7-locator",
      excerptSha256: "f".repeat(64),
    }));
    expect(result.parserEntry.artifacts[0]!.sha256).toBe(MUNICIPAL_ARTIFACT_SHA);
  });

  test.each([
    ["artifact ID", (input: Mutable<CitySafetyTerminalEntryInput>) => {
      const candidate = input.ledger.candidates[0]!;
      if (candidate.disposition !== "usable") throw new Error("fixture_error");
      candidate.artifactRefs[0]!.artifactId = "forged";
    }],
    ["artifact sha", (input: Mutable<CitySafetyTerminalEntryInput>) => {
      input.artifacts[0]!.sha256 = "e".repeat(64);
    }],
    ["reference artifact sha", (input: Mutable<CitySafetyTerminalEntryInput>) => {
      const candidate = input.ledger.candidates[0]!;
      if (candidate.disposition !== "usable") throw new Error("fixture_error");
      candidate.artifactRefs[0]!.artifactSha256 = "e".repeat(64);
    }],
    ["run", (input: Mutable<CitySafetyTerminalEntryInput>) => {
      input.artifacts[0]!.runId = "forged-run";
    }],
    ["source", (input: Mutable<CitySafetyTerminalEntryInput>) => {
      input.artifacts[0]!.sourceId = "si-city-long-term-rent" as typeof input.artifacts[0]["sourceId"];
    }],
    ["role", (input: Mutable<CitySafetyTerminalEntryInput>) => {
      input.artifacts[0]!.role = "other";
    }],
    ["municipality mapping", (input: Mutable<CitySafetyTerminalEntryInput>) => {
      input.sourcePlan.entries[0]!.municipalityCode = "999";
    }],
    ["directory mapping", (input: Mutable<CitySafetyTerminalEntryInput>) => {
      input.authorityDirectory.municipalities[0]!.municipalityCode = "999";
    }],
    ["accepted index", (input: Mutable<CitySafetyTerminalEntryInput>) => {
      if (input.ledger.result.kind !== "verified") throw new Error("fixture_error");
      input.ledger.result.acceptedCandidateIndex = 1;
    }],
    ["terminal document role", (input: Mutable<CitySafetyTerminalEntryInput>) => {
      const candidate = input.ledger.candidates[0]!;
      if (candidate.disposition !== "usable") throw new Error("fixture_error");
      const terminal = candidate.artifactRefs[0]!;
      if (terminal.role !== "municipal_source") throw new Error("fixture_error");
      terminal.documentRole = "navigation";
    }],
    ["denominator artifact", (input: Mutable<CitySafetyTerminalEntryInput>) => {
      const candidate = input.ledger.candidates[0]!;
      if (candidate.disposition !== "usable") throw new Error("fixture_error");
      candidate.denominator.artifactId = "forged-denominator";
    }],
    ["denominator year", (input: Mutable<CitySafetyTerminalEntryInput>) => {
      const candidate = input.ledger.candidates[0]!;
      if (candidate.disposition !== "usable") throw new Error("fixture_error");
      candidate.denominator.referenceDate = "2024-01-01";
    }],
    ["denominator population", (input: Mutable<CitySafetyTerminalEntryInput>) => {
      const candidate = input.ledger.candidates[0]!;
      if (candidate.disposition !== "usable") throw new Error("fixture_error");
      candidate.denominator.population = "299999";
    }],
  ] as const)("rejects safety binding mutation: %s", (_name, mutate) => {
    // Break caught: a re-signed overlay could bind a different source artifact or municipality.
    const input = structuredClone(safetyTerminalInput()) as unknown as Mutable<
      CitySafetyTerminalEntryInput
    >;
    mutate(input);
    expect(() => citySafetyTerminalEntry(
      input as unknown as CitySafetyTerminalEntryInput,
    )).toThrow();
  });

  test("rejects an unbound zero-candidate fallback instead of fabricating a URL", () => {
    // Break caught: missing configured/publisher lineage receives a plausible placeholder URL.
    const input = safetyTerminalInput(safetyLedger({ result: "unknown", candidates: [] }), []);
    const sourcePlan = structuredClone(input.sourcePlan) as Mutable<CitySafetySourcePlan>;
    sourcePlan.entries[0]!.configuredRoutes = [];
    sourcePlan.entries[0]!.publisherIds = ["missing-publisher"];
    expect(() => citySafetyTerminalEntry({ ...input, sourcePlan })).toThrow();
  });

  test("rejects missing and extra supplied safety artifacts", () => {
    // Break caught: the generic artifact union can omit or append bytes absent from the signed ledger.
    const input = safetyTerminalInput();
    expect(() => citySafetyTerminalEntry({
      ...input,
      artifacts: input.artifacts.slice(0, 1),
    })).toThrow();
    expect(() => citySafetyTerminalEntry({
      ...input,
      artifacts: [
        ...input.artifacts,
        artifact("si-city-safety", "unbound-extra", 23, {
          role: "municipal_source",
          url: "https://www.ljubljana.si/safety/extra.pdf",
        }),
      ],
    })).toThrow();
  });
});
