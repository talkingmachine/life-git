import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import { replayEvidenceByRules } from "../../src/application/replay-evidence";
import { createEvidenceIntegrity } from "../../src/infrastructure/integrity";
import { createInstalledCountrySourceIndex } from "../../src/infrastructure/sources/country-source-index";
import {
  createSloveniaResearch,
  createSloveniaResearchV2,
  type SloveniaResearchV2,
} from "../../src/infrastructure/sources/slovenia-source-adapter";
import type {
  ColdStartEvidenceClaim,
  SloveniaSourceId,
} from "../../src/research/cold-start-contracts";
import {
  SLOVENIA_V2_EVIDENCE_RULES_VERSION,
  SLOVENIA_V2_PARSER_VERSIONS,
  SLOVENIA_V2_RESEARCH_SCOPE,
  SLOVENIA_V2_SOURCE_ORDER,
  type ColdStartEvidenceClaimV2,
} from "../../src/research/cold-start-contracts-v2";
import type {
  Claim,
  HttpStepRequest,
  LiveCapturedArtifact,
  OfficialSourcePort,
  ParserEntry,
  RequestStep,
} from "../../src/research/contracts";
import { validateSloveniaEntry } from "../../src/research/parsers/slovenia";
import { validateSloveniaV2Entry } from "../../src/research/parsers/slovenia-v2";
import {
  sealEvidencePlan,
  type SealedEvidence,
  type TerminalEvidenceEntry,
} from "../../src/research/research-plan";
import {
  createSloveniaPlanV2,
  SLOVENIA_V2_EVIDENCE_RULES_VERSION as PLAN_RULES_VERSION,
  SLOVENIA_V2_PARSER_VERSIONS as PLAN_PARSER_VERSIONS,
  SLOVENIA_V2_RESEARCH_SCOPE as PLAN_RESEARCH_SCOPE,
  SLOVENIA_V2_SOURCE_ORDER as PLAN_SOURCE_ORDER,
} from "../../src/research/slovenia-plan-v2";

const ASSESSMENT_DATE = "2026-08-11";
const KEY = "country-v2-task-2-test-key-at-least-32-bytes";
const RUN_ID = "country-v2-task-2";
const CBR_XML = `<?xml version="1.0" encoding="windows-1251"?>
<ValCurs Date="10.08.2026">
  <Valute ID="R01239">
    <NumCode>978</NumCode><CharCode>EUR</CharCode><Nominal>1</Nominal>
    <Name>Euro</Name><Value>90,0000</Value><VunitRate>90,0000</VunitRate>
  </Valute>
</ValCurs>`;

const FIXTURES = {
  "gov-route-page": "route-gov.html",
  "ztuj2-registry": "ztuj2-registry.json",
  "ztuj2-details": "ztuj2-details.json",
  "salary-registry": "salary-registry.json",
  "salary-details": "salary-details.json",
  "sistat-metadata": "sistat-metadata.json",
  "sistat-series": "sistat-series.json",
  "ess-companion-page": "companion-ess.html",
  "zzsdt-registry": "zzsdt-registry.json",
  "zzsdt-details": "zzsdt-details.json",
} as const;

const installed = createInstalledCountrySourceIndex().lookup("SI");
if (!installed.ok) throw new Error("Slovenia source package must be installed");
const CANDIDATES = installed.candidates;

type ExactType<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? (<Value>() => Value extends Right ? 1 : 2) extends
      (<Value>() => Value extends Left ? 1 : 2)
      ? true
      : false
    : false;

const SOURCE_PORT_CONTRACT: ExactType<
  SloveniaResearchV2["source"],
  OfficialSourcePort<SloveniaSourceId>
> = true;

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function fixtureBytes(request: HttpStepRequest<SloveniaSourceId>): Uint8Array {
  if (request.sourceId === "cbr-eur") return new TextEncoder().encode(CBR_XML);
  const fixture = FIXTURES[request.role as keyof typeof FIXTURES];
  if (fixture === undefined) throw new Error(`Unexpected Slovenia role: ${request.role}`);
  return new Uint8Array(readFileSync(
    new URL(`fixtures/slovenia/${fixture}`, import.meta.url),
  ));
}

function capturedArtifact(
  request: HttpStepRequest<SloveniaSourceId>,
): LiveCapturedArtifact<SloveniaSourceId> {
  const bytes = fixtureBytes(request);
  const digest = sha256(bytes);
  return {
    artifactId: `${request.sourceId}:${request.role}:${digest}`,
    runId: request.runId,
    sourceId: request.sourceId,
    role: request.role,
    request: {
      method: request.method,
      url: request.url,
      ...(request.bodyMediaType === undefined
        ? {}
        : { bodyMediaType: request.bodyMediaType }),
      ...(request.bodyBytes === undefined
        ? {}
        : { bodySha256: sha256(request.bodyBytes) }),
    },
    url: request.url,
    responseUrl: request.url,
    capturedAt: "2026-08-11T10:00:00.000Z",
    responseStatus: 200,
    mediaType: request.allowedMediaTypes[0]!,
    origin: "live",
    sha256: digest,
    bytes,
  };
}

async function captureEntries(): Promise<readonly ParserEntry<SloveniaSourceId>[]> {
  const research = createSloveniaResearchV2({ candidates: CANDIDATES });
  const requestStep: RequestStep<SloveniaSourceId> = async (request) =>
    capturedArtifact(request);
  const entries: ParserEntry<SloveniaSourceId>[] = [];
  for (const sourceId of SLOVENIA_V2_SOURCE_ORDER) {
    const result = await research.source.capture({
      runId: RUN_ID,
      sourceId,
      assessmentDate: ASSESSMENT_DATE,
      deadlineAt: "2026-08-11T10:01:00.000Z",
      signal: new AbortController().signal,
    }, requestStep);
    if (!result.ok) throw new Error(`${sourceId} fixture capture must succeed`);
    entries.push(result.entry);
  }
  return entries;
}

function entryBySource(
  entries: readonly ParserEntry<SloveniaSourceId>[],
  sourceId: SloveniaSourceId,
): ParserEntry<SloveniaSourceId> {
  const entry = entries.find((candidate) => candidate.sourceId === sourceId);
  if (entry === undefined) throw new Error(`Missing ${sourceId} fixture`);
  return entry;
}

function mutableEntry(entry: ParserEntry<SloveniaSourceId>): ParserEntry<SloveniaSourceId> {
  return structuredClone(entry);
}

function replaceArtifactBytes(
  entry: ParserEntry<SloveniaSourceId>,
  index: number,
  rewrite: (text: string) => string,
): void {
  const artifact = entry.artifacts[index] as LiveCapturedArtifact<SloveniaSourceId>;
  const bytes = new TextEncoder().encode(rewrite(new TextDecoder().decode(artifact.bytes)));
  const digest = sha256(bytes);
  (artifact as unknown as { bytes: Uint8Array }).bytes = bytes;
  (artifact as unknown as { sha256: string }).sha256 = digest;
  (artifact as unknown as { artifactId: string }).artifactId =
    `${artifact.sourceId}:${artifact.role}:${digest}`;
}

async function terminalEntriesV2(
  entries: readonly ParserEntry<SloveniaSourceId>[],
): Promise<readonly TerminalEvidenceEntry<SloveniaSourceId, ColdStartEvidenceClaimV2>[]> {
  const terminal = [];
  for (const entry of entries) {
    const result = validateSloveniaV2Entry(entry, ASSESSMENT_DATE);
    terminal.push(result.ok
      ? {
          sourceId: entry.sourceId,
          parserEntry: entry,
          coverage: "verified" as const,
          claims: result.claims,
        }
      : {
          sourceId: entry.sourceId,
          parserEntry: entry,
          coverage: "unavailable" as const,
          blocker: {
            sourceId: entry.sourceId,
            kind: result.kind,
            navigationUrl: entry.navigationUrl,
            resolvedUrl: entry.resolvedEvidenceUrl,
            artifactIds: entry.artifacts.map(({ artifactId }) => artifactId),
          },
        });
  }
  return terminal;
}

async function terminalEntriesV1(
  entries: readonly ParserEntry<SloveniaSourceId>[],
): Promise<readonly TerminalEvidenceEntry<SloveniaSourceId, ColdStartEvidenceClaim>[]> {
  const terminal = [];
  for (const entry of entries) {
    const result = validateSloveniaEntry(entry, ASSESSMENT_DATE);
    if (!result.ok) throw new Error(`${entry.sourceId} V1 fixture must validate`);
    terminal.push({
      sourceId: entry.sourceId,
      parserEntry: entry,
      coverage: "verified" as const,
      claims: result.claims,
    });
  }
  return terminal;
}

function replayPorts<C extends Claim<unknown, SloveniaSourceId>>(
  sealed: SealedEvidence<SloveniaSourceId, C>,
  entries: readonly ParserEntry<SloveniaSourceId>[],
) {
  return {
    store: {
      async loadVerifiedBundle() {
        return { snapshot: sealed.snapshot, entries };
      },
    },
    integrityFactory: { create: createEvidenceIntegrity },
  };
}

describe("Slovenia V2 installed research boundary", () => {
  test("re-exports the one Task 1 identity policy and installs plan @3", () => {
    const research = createSloveniaResearchV2({ candidates: CANDIDATES });
    const plan = createSloveniaPlanV2(research.plan.sourceLineage);

    expect({
      sourceOrder: PLAN_SOURCE_ORDER,
      parserVersions: PLAN_PARSER_VERSIONS,
      researchScope: PLAN_RESEARCH_SCOPE,
      rulesVersion: PLAN_RULES_VERSION,
    }).toEqual({
      sourceOrder: SLOVENIA_V2_SOURCE_ORDER,
      parserVersions: SLOVENIA_V2_PARSER_VERSIONS,
      researchScope: SLOVENIA_V2_RESEARCH_SCOPE,
      rulesVersion: SLOVENIA_V2_EVIDENCE_RULES_VERSION,
    });
    expect(plan).toMatchObject({
      id: "vs2-slovenia@3",
      scope: "VS-2 Slovenia cold start",
      sourceIds: [...SLOVENIA_V2_SOURCE_ORDER],
      parserVersions: SLOVENIA_V2_PARSER_VERSIONS,
      rulesVersion: "vs2-si-evidence@3",
      limits: { concurrency: 3, maxCaptures: 11, deadlineMs: 60_000 },
    });
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.sourceIds)).toBe(true);
    expect(Object.isFrozen(plan.sourceLineage)).toBe(true);
    expect(Object.isFrozen(plan.parserVersions)).toBe(true);
    expect(SOURCE_PORT_CONTRACT).toBe(true);
    expect(typeof research.source.capture).toBe("function");
  });

  test("reuses the existing source navigation and exact eleven capture steps", async () => {
    const research = createSloveniaResearchV2({ candidates: CANDIDATES });
    const requests: HttpStepRequest<SloveniaSourceId>[] = [];
    for (const sourceId of SLOVENIA_V2_SOURCE_ORDER) {
      const result = await research.source.capture({
        runId: RUN_ID,
        sourceId,
        assessmentDate: ASSESSMENT_DATE,
        deadlineAt: "2026-08-11T10:01:00.000Z",
        signal: new AbortController().signal,
      }, async (request) => {
        requests.push(request);
        return capturedArtifact(request);
      });
      expect(result.ok).toBe(true);
    }

    expect(requests.map(({ sourceId, role, method }) => ({ sourceId, role, method }))).toEqual([
      { sourceId: "si-digital-nomad-route", role: "gov-route-page", method: "GET" },
      { sourceId: "si-digital-nomad-route", role: "ztuj2-registry", method: "GET" },
      { sourceId: "si-digital-nomad-route", role: "ztuj2-details", method: "GET" },
      { sourceId: "si-income-threshold", role: "salary-registry", method: "GET" },
      { sourceId: "si-income-threshold", role: "salary-details", method: "GET" },
      { sourceId: "si-income-threshold", role: "sistat-metadata", method: "GET" },
      { sourceId: "si-income-threshold", role: "sistat-series", method: "POST" },
      { sourceId: "si-companion-employment", role: "ess-companion-page", method: "GET" },
      { sourceId: "si-companion-employment", role: "zzsdt-registry", method: "GET" },
      { sourceId: "si-companion-employment", role: "zzsdt-details", method: "GET" },
      { sourceId: "cbr-eur", role: "official-document", method: "GET" },
    ]);
  });

  test("rejects borrowed candidate Proxies without invoking traps", () => {
    let traps = 0;
    const trap = (): never => {
      traps += 1;
      throw new Error("proxy trap must not run");
    };
    const candidates = new Proxy(CANDIDATES, {
      get: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      ownKeys: trap,
    });

    expect(() => createSloveniaResearchV2({ candidates })).toThrow("integrity_mismatch");
    expect(traps).toBe(0);
  });

  test("rejects proxied construction envelopes and lineage without invoking traps", () => {
    let traps = 0;
    const trap = (): never => {
      traps += 1;
      throw new Error("proxy trap must not run");
    };
    const input = new Proxy({ candidates: CANDIDATES }, {
      get: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      ownKeys: trap,
    });
    const lineage = new Proxy(
      createSloveniaResearchV2({ candidates: CANDIDATES }).plan.sourceLineage,
      { get: trap, getOwnPropertyDescriptor: trap, getPrototypeOf: trap, ownKeys: trap },
    );

    expect(() => createSloveniaResearchV2(input)).toThrow("integrity_mismatch");
    expect(() => createSloveniaPlanV2(lineage)).toThrow("integrity_mismatch");
    expect(traps).toBe(0);
  });
});

describe("Slovenia V2 retained-artifact validation", () => {
  test("emits only five exactly proved applicant route claims", async () => {
    const entries = await captureEntries();

    const result = validateSloveniaV2Entry(
      entryBySource(entries, "si-digital-nomad-route"),
      ASSESSMENT_DATE,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("route fixture must validate");
    expect(result.claims.map((claim) => "claimKind" in claim ? claim.claimKind : "fx"))
      .toEqual([
        "route_basis",
        "remote_work_relations",
        "qualification",
        "duration",
        "general_statutory_prerequisites",
      ]);
    expect(result.claims.map(({ claimId }) => claimId)).toEqual([
      "si-digital-nomad-route:route_basis:si-route@3",
      "si-digital-nomad-route:remote_work_relations:si-route@3",
      "si-digital-nomad-route:qualification:si-route@3",
      "si-digital-nomad-route:duration:applicant:si-route@3",
      "si-digital-nomad-route:general_statutory_prerequisites:applicant:si-route@3",
    ]);
    expect(result.claims.map(({ value }) => value)).toEqual([
      {
        route: "temporary_residence_digital_nomad",
        legalBasis: "ZTuj-2 Article 51a",
        effectiveFrom: "2025-11-21",
      },
      {
        allowedRelations: ["foreign_employer", "own_foreign_business", "foreign_clients"],
        slovenianLabourMarketWorkIncluded: false,
      },
      { rule: "not_listed_in_authoritative_requirements" },
      {
        maximumMonths: 12,
        extendable: false,
        reapplyAfterMonths: 6,
        scope: { kind: "applicant" },
      },
      {
        passportBeyondPermitMonths: 3,
        healthInsurance: true,
        article55GroundsApply: true,
        scope: { kind: "applicant" },
      },
    ]);
    expect(result.claims.every((claim) =>
      claim.scope === SLOVENIA_V2_RESEARCH_SCOPE &&
      "validatorVersion" in claim && claim.validatorVersion === "si-route@3" &&
      Object.isFrozen(claim)
    )).toBe(true);
    expect(JSON.stringify(result.claims)).not.toMatch(
      /citizenship_applicability|companion_entry|countryCode|relationshipClassifications/,
    );
  });

  test("does not synthesize the closed income or relationship classifiers", async () => {
    const entries = await captureEntries();
    const route = validateSloveniaV2Entry(
      entryBySource(entries, "si-digital-nomad-route"),
      ASSESSMENT_DATE,
    );
    const income = validateSloveniaV2Entry(
      entryBySource(entries, "si-income-threshold"),
      ASSESSMENT_DATE,
    );
    const companion = validateSloveniaV2Entry(
      entryBySource(entries, "si-companion-employment"),
      ASSESSMENT_DATE,
    );

    expect(income).toEqual({ ok: false, kind: "semantic_mismatch" });
    expect(companion.ok).toBe(true);
    if (!route.ok || !companion.ok) throw new Error("retained fixtures must validate");
    expect(companion.claims).toEqual([
      expect.objectContaining({
        claimId: "si-companion-employment:companion_local_work_access:si-companion@3",
        claimKind: "companion_local_work_access",
        sourceId: "si-companion-employment",
        value: { access: "conditional", labourMarketCheck: true, informationSheet: true },
        scope: SLOVENIA_V2_RESEARCH_SCOPE,
        sourcePeriod: "ZAKO6655:NPB 8",
        validatorVersion: "si-companion@3",
        status: "verified",
      }),
    ]);
    const allClaims = [...route.claims, ...companion.claims];
    expect(allClaims.some((claim) =>
      "claimKind" in claim && [
        "citizenship_applicability",
        "income",
        "companion_entry",
      ].includes(claim.claimKind)
    )).toBe(false);
  });

  test("keeps the CBR validation result byte-identical to V1", async () => {
    const entry = entryBySource(await captureEntries(), "cbr-eur");

    const v1 = validateSloveniaEntry(entry, ASSESSMENT_DATE);
    const v2 = validateSloveniaV2Entry(entry, ASSESSMENT_DATE);

    expect(JSON.stringify(v2)).toBe(JSON.stringify(v1));
    expect(v2).toEqual({
      ok: true,
      claims: [{
        claimId: "cbr-eur-facts-1",
        sourceId: "cbr-eur",
        value: {
          base: "EUR",
          quote: "RUB",
          nominal: "1",
          rate: "90.0000",
          effectiveDate: "2026-08-10",
        },
        scope: "VS-2 Slovenia cold start",
        sourcePeriod: "2026-08-10",
        anchor: expect.objectContaining({ locator: "Valute[CharCode=EUR]" }),
        status: "verified",
      }],
    });
  });

  test.each([
    ["missing role", (entry: ParserEntry<SloveniaSourceId>) => {
      (entry.artifacts as LiveCapturedArtifact<SloveniaSourceId>[]).splice(1, 1);
    }],
    ["duplicate role", (entry: ParserEntry<SloveniaSourceId>) => {
      (entry.artifacts as LiveCapturedArtifact<SloveniaSourceId>[]).push(entry.artifacts[0]! as LiveCapturedArtifact<SloveniaSourceId>);
    }],
    ["reordered roles", (entry: ParserEntry<SloveniaSourceId>) => {
      (entry.artifacts as LiveCapturedArtifact<SloveniaSourceId>[]).reverse();
    }],
    ["foreign source", (entry: ParserEntry<SloveniaSourceId>) => {
      (entry.artifacts[1] as unknown as {
        sourceId: SloveniaSourceId;
      }).sourceId = "si-income-threshold";
    }],
    ["foreign run", (entry: ParserEntry<SloveniaSourceId>) => {
      (entry.artifacts[1] as unknown as { runId: string }).runId = "foreign-run";
    }],
    ["foreign origin", (entry: ParserEntry<SloveniaSourceId>) => {
      (entry.artifacts[1] as unknown as { origin: string }).origin = "archive";
    }],
    ["response status", (entry: ParserEntry<SloveniaSourceId>) => {
      (entry.artifacts[1] as unknown as { responseStatus: number }).responseStatus = 201;
    }],
    ["request URL", (entry: ParserEntry<SloveniaSourceId>) => {
      (entry.artifacts[2] as unknown as {
        request: { url: string };
      }).request.url = "https://pisrs.si/api/rezultat/neuradno-precisceno-besedilo/270729002/details";
    }],
    ["response URL", (entry: ParserEntry<SloveniaSourceId>) => {
      (entry.artifacts[2] as unknown as { responseUrl: string }).responseUrl =
        "https://pisrs.si/api/rezultat/neuradno-precisceno-besedilo/270729002/details";
    }],
    ["request method", (entry: ParserEntry<SloveniaSourceId>) => {
      (entry.artifacts[1] as unknown as {
        request: { method: "GET" | "POST" };
      }).request.method = "POST";
    }],
    ["media type", (entry: ParserEntry<SloveniaSourceId>) => {
      (entry.artifacts[1] as { mediaType: string }).mediaType = "text/html";
    }],
    ["artifact ID", (entry: ParserEntry<SloveniaSourceId>) => {
      (entry.artifacts[1] as { artifactId: string }).artifactId = "foreign-artifact";
    }],
    ["extra artifact", (entry: ParserEntry<SloveniaSourceId>) => {
      const copy = structuredClone(entry.artifacts[0]!) as LiveCapturedArtifact<SloveniaSourceId>;
      const mutable = copy as unknown as { role: string; artifactId: string };
      mutable.role = "unapproved-role";
      mutable.artifactId = `${copy.sourceId}:${mutable.role}:${copy.sha256}`;
      (entry.artifacts as LiveCapturedArtifact<SloveniaSourceId>[]).push(copy);
    }],
  ] as const)("rejects exact route artifact topology drift: %s", async (_name, mutate) => {
    const route = mutableEntry(entryBySource(await captureEntries(), "si-digital-nomad-route"));
    mutate(route);

    expect(validateSloveniaV2Entry(route, ASSESSMENT_DATE)).toEqual({
      ok: false,
      kind: "semantic_mismatch",
    });
  });

  test("classifies retained-byte hash drift as integrity mismatch", async () => {
    const route = mutableEntry(entryBySource(await captureEntries(), "si-digital-nomad-route"));
    const bytes = route.artifacts[0]!.bytes;
    bytes[0] = bytes[0]! ^ 1;

    expect(validateSloveniaV2Entry(route, ASSESSMENT_DATE)).toEqual({
      ok: false,
      kind: "integrity_mismatch",
    });
  });

  test("rejects a re-hashed route source-period disagreement", async () => {
    const route = mutableEntry(entryBySource(await captureEntries(), "si-digital-nomad-route"));
    replaceArtifactBytes(route, 2, (text) =>
      text.replace("Datum začetka uporabe: 21.11.2025", "Datum začetka uporabe: 22.11.2025")
    );

    expect(validateSloveniaV2Entry(route, ASSESSMENT_DATE)).toEqual({
      ok: false,
      kind: "semantic_mismatch",
    });
  });

  test("does not turn unrelated RU or spouse prose into closed classifiers", async () => {
    const route = mutableEntry(entryBySource(await captureEntries(), "si-digital-nomad-route"));
    replaceArtifactBytes(route, 0, (text) =>
      text.replace("</main>", "<p>Unrelated note: RU spouse.</p></main>")
    );

    const result = validateSloveniaV2Entry(route, ASSESSMENT_DATE);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unrelated prose must not invalidate exact excerpts");
    expect(result.claims.map((claim) => "claimKind" in claim ? claim.claimKind : "fx"))
      .toEqual([
        "route_basis",
        "remote_work_relations",
        "qualification",
        "duration",
        "general_statutory_prerequisites",
      ]);
  });

  test.each([
    ["family", (text: string) => text.replace(
      /\s*<p>A notable feature of the temporary residence permit[\s\S]*?<\/p>/,
      "",
    )],
    ["citizenship classifier", (text: string) => text.replace(
      "who is not a citizen of an EU or EEA country",
      "whose citizenship class is not stated on this page",
    )],
    ["funds", (text: string) => text.replace(
      /\s*<p>To meet the requirement for sufficient means[\s\S]*?<\/p>/,
      "",
    )],
    ["application", (text: string) => text.replace(
      /\s*<p>Foreign nationals have to apply[\s\S]*?<\/p>/,
      "",
    )],
  ] as const)("retains independently proved route claims after unused GOV %s drift", async (
    _name,
    rewrite,
  ) => {
    const route = mutableEntry(entryBySource(await captureEntries(), "si-digital-nomad-route"));
    replaceArtifactBytes(route, 0, rewrite);

    expect(validateSloveniaEntry(route, ASSESSMENT_DATE)).toEqual({
      ok: false,
      kind: "semantic_mismatch",
    });
    const result = validateSloveniaV2Entry(route, ASSESSMENT_DATE);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("independently proved route facts must remain");
    expect(result.claims.map((claim) => "claimKind" in claim ? claim.claimKind : "fx"))
      .toEqual([
        "route_basis",
        "remote_work_relations",
        "qualification",
        "duration",
        "general_statutory_prerequisites",
      ]);
  });

  test.each([
    ["route_basis", (route: ParserEntry<SloveniaSourceId>) => {
      replaceArtifactBytes(route, 0, (text) => text.replace(
        "<h1>Temporary residence permit for digital nomads</h1>",
        "<h1>Updated digital nomad notice</h1>",
      ));
      replaceArtifactBytes(route, 2, (text) => text.replace(
        "(1) Tujcu se lahko izda dovoljenje",
        "(1) Tujcu se morebiti izda dovoljenje",
      ));
    }, [
      "remote_work_relations",
      "qualification",
      "duration",
      "general_statutory_prerequisites",
    ]],
    ["remote_work_relations", (route: ParserEntry<SloveniaSourceId>) => {
      replaceArtifactBytes(route, 0, (text) => text.replace(
        "who is either employed or performs work",
        "whose work relation is not specified",
      ));
      replaceArtifactBytes(route, 2, (text) => text.replace(
        "je zaposlen ali opravlja delo",
        "opravlja nedoločeno dejavnost",
      ));
    }, [
      "route_basis",
      "qualification",
      "duration",
      "general_statutory_prerequisites",
    ]],
    ["qualification", (route: ParserEntry<SloveniaSourceId>) => {
      replaceArtifactBytes(route, 2, (text) => text.replace(
        "ima zadostna sredstva",
        "ima qualification in zadostna sredstva",
      ));
    }, [
      "route_basis",
      "remote_work_relations",
      "duration",
      "general_statutory_prerequisites",
    ]],
    ["duration", (route: ParserEntry<SloveniaSourceId>) => {
      replaceArtifactBytes(route, 0, (text) => text.replace(
        "may be issued for up to one year",
        "has an unspecified maximum period",
      ));
      replaceArtifactBytes(route, 2, (text) => text.replace(
        "ne dlje kot za eno leto",
        "za nedoločeno najdaljše obdobje",
      ));
    }, [
      "route_basis",
      "remote_work_relations",
      "qualification",
      "general_statutory_prerequisites",
    ]],
    ["general_statutory_prerequisites", (route: ParserEntry<SloveniaSourceId>) => {
      replaceArtifactBytes(route, 2, (text) => text.replace(
        "veljavnost je najmanj tri mesece",
        "veljavnost je najmanj dva meseca",
      ));
    }, [
      "route_basis",
      "remote_work_relations",
      "qualification",
      "duration",
    ]],
  ] as const)("omits only the independently unproved %s claim", async (
    _name,
    mutate,
    expectedKinds,
  ) => {
    const route = mutableEntry(entryBySource(await captureEntries(), "si-digital-nomad-route"));
    mutate(route);

    const result = validateSloveniaV2Entry(route, ASSESSMENT_DATE);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("remaining route facts must stay verified");
    expect(result.claims.map((claim) => "claimKind" in claim ? claim.claimKind : "fx"))
      .toEqual(expectedKinds);
  });

  test("marks a structurally valid route unavailable when no supported claim remains", async () => {
    const route = mutableEntry(entryBySource(await captureEntries(), "si-digital-nomad-route"));
    replaceArtifactBytes(route, 0, (text) => text
      .replace(
        "<h1>Temporary residence permit for digital nomads</h1>",
        "<h1>Updated digital nomad notice</h1>",
      )
      .replace(
        "who is either employed or performs work",
        "whose work relation is not specified",
      )
      .replace(
        "may be issued for up to one year",
        "has an unspecified maximum period",
      ));
    replaceArtifactBytes(route, 2, (text) => text
      .replace(
        "(1) Tujcu se lahko izda dovoljenje",
        "(1) Tujcu se morebiti izda dovoljenje",
      )
      .replace("je zaposlen ali opravlja delo", "opravlja nedoločeno dejavnost")
      .replace("ima zadostna sredstva", "ima qualification in zadostna sredstva")
      .replace("ne dlje kot za eno leto", "za nedoločeno najdaljše obdobje")
      .replace(
        "veljavnost je najmanj tri mesece",
        "veljavnost je najmanj dva meseca",
      ));

    expect(validateSloveniaV2Entry(route, ASSESSMENT_DATE)).toEqual({
      ok: false,
      kind: "semantic_mismatch",
    });
  });

  test("keeps Article 51 claims when only the Article 55 heading and TOC binding drift", async () => {
    const route = mutableEntry(entryBySource(await captureEntries(), "si-digital-nomad-route"));
    replaceArtifactBytes(route, 2, (text) => text
      .replace('"vsebina": "55. člen"', '"vsebina": "55.a člen"')
      .replace(
        '"kazaloIme": "55. člen (zavrnitev izdaje dovoljenja za prebivanje)"',
        '"kazaloIme": "55.a člen (preimenovan naslov)"',
      ));

    expect(validateSloveniaEntry(route, ASSESSMENT_DATE)).toEqual({
      ok: false,
      kind: "semantic_mismatch",
    });
    const result = validateSloveniaV2Entry(route, ASSESSMENT_DATE);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Article 51 facts must remain independently verified");
    expect(result.claims.map((claim) => "claimKind" in claim ? claim.claimKind : "fx"))
      .toEqual([
        "route_basis",
        "remote_work_relations",
        "qualification",
        "duration",
      ]);
  });

  test("rejects SiStat request method, URL, and body-hash drift without creating income", async () => {
    const entries = await captureEntries();
    for (const mutate of [
      (artifact: LiveCapturedArtifact<SloveniaSourceId>) => {
        (artifact.request as { method: "GET" | "POST" }).method = "GET";
      },
      (artifact: LiveCapturedArtifact<SloveniaSourceId>) => {
        (artifact.request as { url: string }).url = `${artifact.request.url}?drift=1`;
      },
      (artifact: LiveCapturedArtifact<SloveniaSourceId>) => {
        (artifact.request as { bodySha256?: string }).bodySha256 = "f".repeat(64);
      },
    ]) {
      const income = mutableEntry(entryBySource(entries, "si-income-threshold"));
      mutate(income.artifacts[3] as LiveCapturedArtifact<SloveniaSourceId>);
      expect(validateSloveniaV2Entry(income, ASSESSMENT_DATE)).toEqual({
        ok: false,
        kind: "semantic_mismatch",
      });
    }
  });
});

describe("Slovenia V2 descriptor-safe borrowed inputs", () => {
  test.each([
    null,
    { sourceId: "unknown", artifacts: [] },
    {
      sourceId: "si-digital-nomad-route",
      navigationUrl: "https://example.invalid",
      resolvedEvidenceUrl: "https://example.invalid",
      artifacts: [null],
    },
  ])("fails closed for a malformed parser envelope %#", (malformed) => {
    expect(validateSloveniaV2Entry(
      malformed as unknown as ParserEntry<SloveniaSourceId>,
      ASSESSMENT_DATE,
    )).toEqual({ ok: false, kind: "integrity_mismatch" });
  });

  test("rejects Proxy and revoked Proxy without invoking a trap", async () => {
    const route = entryBySource(await captureEntries(), "si-digital-nomad-route");
    let traps = 0;
    const trap = () => {
      traps += 1;
      throw new Error("proxy trap must not run");
    };
    const proxy = new Proxy(route, {
      get: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      ownKeys: trap,
    });
    const revocable = Proxy.revocable(structuredClone(route), {});
    revocable.revoke();

    expect(validateSloveniaV2Entry(proxy, ASSESSMENT_DATE)).toEqual({
      ok: false,
      kind: "integrity_mismatch",
    });
    expect(validateSloveniaV2Entry(
      revocable.proxy as ParserEntry<SloveniaSourceId>,
      ASSESSMENT_DATE,
    )).toEqual({ ok: false, kind: "integrity_mismatch" });
    expect(traps).toBe(0);
  });

  test.each(["proxy prototype", "buffer getter", "byteLength getter"] as const)(
    "rejects Uint8Array %s without invoking borrowed behavior",
    async (poison) => {
      const route = mutableEntry(entryBySource(await captureEntries(), "si-digital-nomad-route"));
      const original = route.artifacts[0]!.bytes;
      const bytes = new Uint8Array(original);
      let traps = 0;
      const trap = (): never => {
        traps += 1;
        throw new Error("typed-array trap must not run");
      };
      if (poison === "proxy prototype") {
        Object.setPrototypeOf(bytes, new Proxy(Uint8Array.prototype, { getPrototypeOf: trap }));
      } else {
        Object.defineProperty(bytes, poison === "buffer getter" ? "buffer" : "byteLength", {
          configurable: true,
          get: trap,
        });
      }
      (route.artifacts[0] as { bytes: Uint8Array }).bytes = bytes;

      expect(validateSloveniaV2Entry(route, ASSESSMENT_DATE)).toEqual({
        ok: false,
        kind: "integrity_mismatch",
      });
      expect(traps).toBe(0);
    },
  );

  test.each([
    ["getter", (entry: ParserEntry<SloveniaSourceId>) => {
      Object.defineProperty(entry, "sourceId", { enumerable: true, get: () => entry.sourceId });
    }],
    ["symbol", (entry: ParserEntry<SloveniaSourceId>) => {
      Object.defineProperty(entry, Symbol("hidden"), { enumerable: true, value: true });
    }],
    ["non-enumerable data", (entry: ParserEntry<SloveniaSourceId>) => {
      Object.defineProperty(entry, "hidden", { enumerable: false, value: true });
    }],
    ["custom prototype", (entry: ParserEntry<SloveniaSourceId>) => {
      Object.setPrototypeOf(entry, { inherited: true });
    }],
    ["sparse array", (entry: ParserEntry<SloveniaSourceId>) => {
      delete (entry.artifacts as LiveCapturedArtifact<SloveniaSourceId>[])[1];
    }],
    ["decorated array", (entry: ParserEntry<SloveniaSourceId>) => {
      Object.defineProperty(entry.artifacts, "decorated", { enumerable: true, value: true });
    }],
    ["cycle", (entry: ParserEntry<SloveniaSourceId>) => {
      (entry as unknown as Record<string, unknown>).cycle = entry;
    }],
    ["enumerable __proto__", (entry: ParserEntry<SloveniaSourceId>) => {
      Object.defineProperty(entry, "__proto__", { enumerable: true, value: { polluted: true } });
    }],
    ["SharedArrayBuffer", (entry: ParserEntry<SloveniaSourceId>) => {
      if (typeof SharedArrayBuffer === "undefined") return;
      const original = entry.artifacts[0]!.bytes;
      const bytes = new Uint8Array(new SharedArrayBuffer(original.byteLength));
      bytes.set(original);
      (entry.artifacts[0] as { bytes: Uint8Array }).bytes = bytes;
    }],
  ] as const)("rejects hostile graph shape: %s", async (_name, mutate) => {
    const route = mutableEntry(entryBySource(await captureEntries(), "si-digital-nomad-route"));
    mutate(route);

    expect(validateSloveniaV2Entry(route, ASSESSMENT_DATE)).toEqual({
      ok: false,
      kind: "integrity_mismatch",
    });
  });
});

describe("Slovenia V2 partial Evidence and offline replay", () => {
  test("retains independently proved sources and canonical-sorts the present subset", async () => {
    const entries = await captureEntries();
    const terminal = await terminalEntriesV2(entries);
    const plan = createSloveniaResearchV2({ candidates: CANDIDATES }).plan;
    const route = terminal.find(({ sourceId }) => sourceId === "si-digital-nomad-route")!;
    if (route.coverage !== "verified") throw new Error("route fixture must validate");
    const reversed = terminal.map((entry) => entry.sourceId === route.sourceId
      ? { ...entry, claims: [...route.claims].reverse() }
      : entry);

    const ruled = plan.applyRules(reversed, ASSESSMENT_DATE);

    expect(ruled.map(({ sourceId, coverage }) => ({ sourceId, coverage }))).toEqual([
      { sourceId: "si-digital-nomad-route", coverage: "verified" },
      { sourceId: "si-income-threshold", coverage: "unavailable" },
      { sourceId: "si-companion-employment", coverage: "verified" },
      { sourceId: "cbr-eur", coverage: "verified" },
    ]);
    expect(ruled.flatMap((entry) => entry.coverage === "verified"
      ? entry.claims.flatMap((claim) => "claimKind" in claim ? [claim.claimKind] : [])
      : [])).toEqual([
        "route_basis",
        "remote_work_relations",
        "qualification",
        "duration",
        "general_statutory_prerequisites",
        "companion_local_work_access",
      ]);
  });

  test("dispatches @3 offline replay and preserves historical @2 replay bytes", async () => {
    const entries = await captureEntries();
    const integrity = createEvidenceIntegrity(KEY);
    const researchV2 = createSloveniaResearchV2({ candidates: CANDIDATES });
    const terminalV2 = researchV2.plan.applyRules(
      await terminalEntriesV2(entries),
      ASSESSMENT_DATE,
    );
    const sealedV2 = await sealEvidencePlan({
      id: "slovenia-v2-replay",
      assessmentDate: ASSESSMENT_DATE,
      entries: terminalV2,
      sourceIds: researchV2.plan.sourceIds,
      parserVersions: researchV2.plan.parserVersions,
      rulesVersion: researchV2.plan.rulesVersion,
    }, integrity);
    const researchV1 = createSloveniaResearch({ candidates: CANDIDATES });
    const terminalV1 = researchV1.plan.applyRules(
      await terminalEntriesV1(entries),
      ASSESSMENT_DATE,
    );
    const sealedV1 = await sealEvidencePlan({
      id: "slovenia-v1-replay",
      assessmentDate: ASSESSMENT_DATE,
      entries: terminalV1,
      sourceIds: researchV1.plan.sourceIds,
      parserVersions: researchV1.plan.parserVersions,
      rulesVersion: researchV1.plan.rulesVersion,
    }, integrity);

    const replayedV2 = await replayEvidenceByRules(
      { snapshotId: sealedV2.snapshot.id, hmacKey: KEY },
      replayPorts(sealedV2, entries),
    );
    const replayedV1 = await replayEvidenceByRules(
      { snapshotId: sealedV1.snapshot.id, hmacKey: KEY },
      replayPorts(sealedV1, entries),
    );

    expect(integrity.canonical(replayedV2)).toBe(integrity.canonical(sealedV2.snapshot));
    expect(integrity.canonical(replayedV1)).toBe(integrity.canonical(sealedV1.snapshot));
  });

  test("rejects relabeled V1 claims, parser drift, and reordered @3 entries", async () => {
    const entries = await captureEntries();
    const integrity = createEvidenceIntegrity(KEY);
    const terminalV1 = await terminalEntriesV1(entries);
    const relabeledV1 = await sealEvidencePlan<SloveniaSourceId, ColdStartEvidenceClaim>({
      id: "slovenia-v1-relabeled-as-v2",
      assessmentDate: ASSESSMENT_DATE,
      entries: terminalV1,
      sourceIds: SLOVENIA_V2_SOURCE_ORDER,
      parserVersions: SLOVENIA_V2_PARSER_VERSIONS,
      rulesVersion: SLOVENIA_V2_EVIDENCE_RULES_VERSION,
    }, integrity);
    const planV2 = createSloveniaResearchV2({ candidates: CANDIDATES }).plan;
    const terminalV2 = planV2.applyRules(await terminalEntriesV2(entries), ASSESSMENT_DATE);
    const parserDrift = await sealEvidencePlan({
      id: "slovenia-v2-parser-drift",
      assessmentDate: ASSESSMENT_DATE,
      entries: terminalV2,
      sourceIds: SLOVENIA_V2_SOURCE_ORDER,
      parserVersions: {
        ...SLOVENIA_V2_PARSER_VERSIONS,
        "si-digital-nomad-route": "drift",
      },
      rulesVersion: SLOVENIA_V2_EVIDENCE_RULES_VERSION,
    }, integrity);
    const validV2 = await sealEvidencePlan({
      id: "slovenia-v2-order-drift",
      assessmentDate: ASSESSMENT_DATE,
      entries: terminalV2,
      sourceIds: SLOVENIA_V2_SOURCE_ORDER,
      parserVersions: SLOVENIA_V2_PARSER_VERSIONS,
      rulesVersion: SLOVENIA_V2_EVIDENCE_RULES_VERSION,
    }, integrity);

    await expect(replayEvidenceByRules(
      { snapshotId: relabeledV1.snapshot.id, hmacKey: KEY },
      replayPorts(relabeledV1, entries),
    )).rejects.toThrow("integrity_mismatch");
    await expect(replayEvidenceByRules(
      { snapshotId: parserDrift.snapshot.id, hmacKey: KEY },
      replayPorts(parserDrift, entries),
    )).rejects.toThrow("integrity_mismatch");
    await expect(replayEvidenceByRules(
      { snapshotId: validV2.snapshot.id, hmacKey: KEY },
      replayPorts(validV2, [...entries].reverse()),
    )).rejects.toThrow("integrity_mismatch");
  });

  test("rejects fully re-signed @3 anchor drift and a V2 payload relabeled as @2", async () => {
    const entries = await captureEntries();
    const integrity = createEvidenceIntegrity(KEY);
    const planV2 = createSloveniaResearchV2({ candidates: CANDIDATES }).plan;
    const terminalV2 = planV2.applyRules(await terminalEntriesV2(entries), ASSESSMENT_DATE);
    const anchorDriftEntries = structuredClone(terminalV2);
    const route = anchorDriftEntries.find(
      ({ sourceId }) => sourceId === "si-digital-nomad-route",
    );
    if (route?.coverage !== "verified") throw new Error("route fixture must validate");
    const firstClaim = route.claims[0]!;
    (firstClaim.anchor as { locator: string }).locator = "forged retained locator";
    const anchorDrift = await sealEvidencePlan({
      id: "slovenia-v2-anchor-drift",
      assessmentDate: ASSESSMENT_DATE,
      entries: anchorDriftEntries,
      sourceIds: SLOVENIA_V2_SOURCE_ORDER,
      parserVersions: SLOVENIA_V2_PARSER_VERSIONS,
      rulesVersion: SLOVENIA_V2_EVIDENCE_RULES_VERSION,
    }, integrity);
    const relabeledAsV1 = await sealEvidencePlan({
      id: "slovenia-v2-relabeled-as-v1",
      assessmentDate: ASSESSMENT_DATE,
      entries: terminalV2,
      sourceIds: SLOVENIA_V2_SOURCE_ORDER,
      parserVersions: {
        "si-digital-nomad-route": "si-route@2",
        "si-income-threshold": "si-income@2",
        "si-companion-employment": "si-companion@2",
        "cbr-eur": "cbr-eur@1",
      },
      rulesVersion: "vs2-si-evidence@2",
    }, integrity);

    await expect(replayEvidenceByRules(
      { snapshotId: anchorDrift.snapshot.id, hmacKey: KEY },
      replayPorts(anchorDrift, entries),
    )).rejects.toThrow("integrity_mismatch");
    await expect(replayEvidenceByRules(
      { snapshotId: relabeledAsV1.snapshot.id, hmacKey: KEY },
      replayPorts(relabeledAsV1, entries),
    )).rejects.toThrow("integrity_mismatch");
  });
});
