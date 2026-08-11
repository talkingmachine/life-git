import { load } from "cheerio";
import Decimal from "decimal.js";
import { z } from "zod";

import type {
  ArtifactBytes,
  Claim,
  LiveCapturedArtifact,
  ParserEntry,
} from "../contracts";
import type {
  ColdStartEvidenceClaim,
  CountryEvidenceRef,
  ClaimKind,
  ClaimValueByKind,
  SloveniaSourceId,
  VerifiedCountryClaim,
} from "../cold-start-contracts";
import { parseCbrEur } from "./cbr-eur";
import {
  anchor,
  artifactByRole,
  entryHasValidIntegrity,
  normalizedText,
} from "./parser-support";

type SloveniaValidationResult =
  | { readonly ok: true; readonly claims: readonly ColdStartEvidenceClaim[] }
  | {
      readonly ok: false;
      readonly kind: "integrity_mismatch" | "semantic_mismatch" | "stale" | "conflict";
    };

const metadataVariableSchema = z.object({
  code: z.string().min(1),
  text: z.string().min(1),
  time: z.boolean().optional(),
  values: z.array(z.string().min(1)).min(1),
  valueTexts: z.array(z.string().min(1)).min(1),
}).strict();

const sistatMetadataSchema = z.object({
  datasetId: z.literal("H285S.px"),
  anchorExcerpt: z.string().min(1),
  title: z.string().min(1),
  complete: z.literal(true),
  pagination: z.object({ hasMore: z.literal(false) }).strict(),
  variables: z.array(metadataVariableSchema).min(1),
}).strict();

const categorySchema = z.object({
  index: z.record(z.string(), z.number().int().nonnegative()),
  label: z.record(z.string(), z.string()),
}).strict();

const sistatSeriesSchema = z.object({
  version: z.literal("2.0"),
  class: z.literal("dataset"),
  anchorExcerpt: z.string().min(1),
  id: z.array(z.string().min(1)).min(1),
  size: z.array(z.number().int().positive()).min(1),
  dimension: z.record(z.string(), z.object({
    label: z.string().min(1),
    category: categorySchema,
  }).strict()),
  value: z.array(z.number().finite().nullable()).min(1),
}).strict();

function htmlLines(artifact: ArtifactBytes): readonly string[] | null {
  if (artifact.mediaType !== "text/html") return null;
  const $ = load(new TextDecoder().decode(artifact.bytes));
  $("script,style,noscript").remove();
  return $("body").find("h1,h2,h3,p,li,time")
    .map((_, element) => normalizedText($(element).text()))
    .get()
    .filter((line) => line.length > 0);
}

function uniqueLine(lines: readonly string[], expected: string): string | null {
  const matches = lines.filter((line) => line === expected);
  return matches.length === 1 ? matches[0]! : null;
}

function prefixedLine(lines: readonly string[], prefix: string): string | null {
  const matches = lines.filter((line) => line.startsWith(prefix));
  return matches.length === 1 ? matches[0]!.slice(prefix.length).trim() : null;
}

function boundedSection(
  lines: readonly string[],
  begin: string,
  end: string,
): readonly string[] | null {
  const beginIndexes = lines.flatMap((line, index) => line === begin ? [index] : []);
  const endIndexes = lines.flatMap((line, index) => line === end ? [index] : []);
  if (
    beginIndexes.length !== 1 ||
    endIndexes.length !== 1 ||
    beginIndexes[0]! >= endIndexes[0]!
  ) return null;
  return lines.slice(beginIndexes[0]! + 1, endIndexes[0]);
}

function markersAreStrictlyOrdered(
  lines: readonly string[],
  markers: readonly string[],
): boolean {
  const indexes = markers.map((marker) =>
    lines.flatMap((line, index) => line === marker ? [index] : []),
  );
  return indexes.every(
    (matches, index) =>
      matches.length === 1 &&
      (index === 0 || indexes[index - 1]![0]! < matches[0]!),
  );
}

function containsExact(lines: readonly string[] | null, expected: string): boolean {
  return lines !== null && lines.filter((line) => line === expected).length === 1;
}

function selectedEffectiveState(lines: readonly string[], assessmentAt: string): string | null {
  if (uniqueLine(lines, "EFFECTIVE STATE LIST: COMPLETE.") === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(assessmentAt)) return null;
  const states = lines.flatMap((line) => {
    const match = /^STATE (EFFECTIVE|FUTURE): (\d{4}-\d{2}-\d{2}); ID=([^.;]+)\.$/.exec(line);
    return match === null ? [] : [{ kind: match[1]!, date: match[2]!, id: match[3]! }];
  });
  if (states.length === 0 || new Set(states.map(({ id }) => id)).size !== states.length) return null;
  if (states.some(({ kind, date }) => kind === "FUTURE" && date <= assessmentAt)) return null;
  const applicable = states.filter(({ kind, date }) => kind === "EFFECTIVE" && date <= assessmentAt);
  if (applicable.length === 0) return null;
  const latestDate = applicable.map(({ date }) => date).sort().at(-1)!;
  return applicable.filter(({ date }) => date === latestDate).length === 1 ? latestDate : null;
}

function evidenceRef(
  sourceId: SloveniaSourceId,
  artifact: ArtifactBytes,
  sourcePeriod: string,
  locator: string,
  excerpt: string,
): CountryEvidenceRef {
  const captured = artifact as Partial<LiveCapturedArtifact<SloveniaSourceId>>;
  const claimAnchor = anchor(artifact, locator, excerpt);
  return {
    sourceId,
    artifactId: artifact.artifactId,
    navigationUrl: captured.request?.url ?? artifact.url,
    resolvedEvidenceUrl: captured.responseUrl ?? artifact.url,
    sourcePeriod,
    anchor: claimAnchor,
  };
}

function verifiedClaim<K extends ClaimKind>(
  sourceId: SloveniaSourceId,
  claimKind: K,
  value: ClaimValueByKind[K],
  sourcePeriod: string,
  evidence: readonly CountryEvidenceRef[],
  validatorVersion: string,
): VerifiedCountryClaim<K> {
  return {
    claimId: `${sourceId}:${claimKind}:${validatorVersion}`,
    claimKind,
    sourceId,
    value,
    scope: "VS-2 Slovenia cold start",
    sourcePeriod,
    anchor: evidence.at(-1)!.anchor,
    evidence,
    validatorVersion,
    status: "verified",
  };
}

function jsonValue(artifact: ArtifactBytes): unknown | null {
  if (artifact.mediaType !== "application/json") return null;
  try {
    return JSON.parse(new TextDecoder().decode(artifact.bytes));
  } catch {
    return null;
  }
}

function parseRoute(entry: ParserEntry<SloveniaSourceId>, assessmentAt: string): SloveniaValidationResult {
  const gov = artifactByRole(entry, "gov-route-page");
  const law = artifactByRole(entry, "ztuj2-consolidated");
  if (gov === undefined || law === undefined) return { ok: false, kind: "semantic_mismatch" };
  const govLines = htmlLines(gov);
  const lawLines = htmlLines(law);
  if (govLines === null || lawLines === null) return { ok: false, kind: "semantic_mismatch" };
  const sourcePeriod = selectedEffectiveState(lawLines, assessmentAt);
  const article51 = boundedSection(lawLines, "BEGIN 51.a člen", "END 51.a člen");
  const article55 = boundedSection(lawLines, "BEGIN 55. člen", "END 55. člen");
  const govExcerpt = prefixedLine(govLines, "ANCHOR EXCERPT:");
  const lawExcerpt = prefixedLine(lawLines, "ANCHOR EXCERPT:");
  const eligibility = prefixedLine(govLines, "Explicit nationality exclusions:");
  const govText = govLines.join(" ");
  const lawText = article51?.join(" ") ?? "";
  const routeSemantics = [
    "Temporary residence permit for digital nomads",
    "21 November 2025",
    "ELIGIBILITY SCOPE COMPLETE.",
    "Eligible category: third-country national.",
    "No nationality-specific or consular admission guarantee is stated.",
    "REMOTE WORK RELATIONS COMPLETE: foreign employer; own foreign business; foreign clients.",
    "Work in the Slovenian labour market is not included.",
    "Immediate family reunification is allowed without a waiting period.",
    "Maximum duration is 12 months; not extendable; reapplication is possible after 6 months.",
  ];
  const article51Semantics = [
    "Temporary residence permit for a digital nomad under Article 51a.",
    "The route applies to a third-country national working for a foreign employer, own foreign business, or foreign clients and excludes Slovenian labour-market work.",
    "Immediate family reunification applies without a waiting period.",
    "The permit lasts no more than 12 months, cannot be extended, and a new application may be made after 6 months.",
    "REQUIREMENTS LIST: COMPLETE.",
    "Passport validity must exceed the permit by 3 months.",
    "Health insurance is required.",
    "Article 55 refusal grounds apply.",
    "QUALIFICATION RULE: ABSENT FROM COMPLETE REQUIREMENTS.",
  ];
  if (
    sourcePeriod !== "2025-11-21" ||
    govExcerpt !== "Temporary residence permit for digital nomads | 21 November 2025" ||
    lawExcerpt !== "ZAKO5761 | 51.a člen | effective 2025-11-21" ||
    eligibility !== "EU citizens; EEA citizens; Swiss citizens." ||
    routeSemantics.some((semantic) => uniqueLine(govLines, semantic) === null) ||
    !markersAreStrictlyOrdered(govLines, routeSemantics) ||
    uniqueLine(lawLines, "LAW ID: ZAKO5761.") === null ||
    !markersAreStrictlyOrdered(lawLines, [
      "BEGIN 51.a člen",
      "END 51.a člen",
      "BEGIN 55. člen",
      "END 55. člen",
    ]) ||
    article51Semantics.some((semantic) => !containsExact(article51, semantic)) ||
    !markersAreStrictlyOrdered(article51 ?? [], article51Semantics) ||
    !containsExact(
      article55,
      "General statutory refusal grounds applicable to temporary residence permits.",
    ) ||
    /Guaranteed admission for|consular admission guarantee is available/i.test(govText) ||
    /diploma|degree required|qualification required/i.test(lawText)
  ) {
    return { ok: false, kind: "semantic_mismatch" };
  }
  if (article51 === null || article55 === null) return { ok: false, kind: "semantic_mismatch" };
  const [
    govTitle,
    govPublicationDate,
    govEligibilityComplete,
    govEligibleCategory,
    govNoGuarantee,
    govRemoteComplete,
    govNoSlovenianMarket,
    govFamilyEntry,
    govDuration,
  ] = routeSemantics.map((semantic) => uniqueLine(govLines, semantic)!);
  const govExclusions = uniqueLine(
    govLines,
    "Explicit nationality exclusions: EU citizens; EEA citizens; Swiss citizens.",
  )!;
  const [
    lawRouteBasis,
    lawWorkScope,
    lawFamilyEntry,
    lawDuration,
    lawRequirementsComplete,
    lawPassport,
    lawInsurance,
    lawArticle55Applies,
    lawQualificationAbsent,
  ] = article51Semantics.map((semantic) => uniqueLine(article51, semantic)!);
  const lawArticle55Grounds = uniqueLine(
    article55,
    "General statutory refusal grounds applicable to temporary residence permits.",
  )!;
  const govRef = (locator: string, lines: readonly string[]) =>
    evidenceRef(entry.sourceId, gov, sourcePeriod, locator, lines.join(" "));
  const lawRef = (locator: string, lines: readonly string[]) =>
    evidenceRef(entry.sourceId, law, sourcePeriod, locator, lines.join(" "));
  const claimInputs: readonly [
    ClaimKind,
    ClaimValueByKind[ClaimKind],
    readonly CountryEvidenceRef[],
  ][] = [
    ["route_basis", {
      route: "temporary_residence_digital_nomad",
      legalBasis: "ZTuj-2 Article 51a",
      effectiveFrom: "2025-11-21",
    }, [
      govRef("GOV.SI route title and publication date", [
        govTitle,
        govPublicationDate,
      ]),
      lawRef("ZAKO5761 51.a člen route basis", [lawRouteBasis]),
    ]],
    ["citizenship_applicability", {
      eligibleCategory: "third_country_national",
      explicitNationalityExclusions: ["EU", "EEA", "Switzerland"],
    }, [
      lawRef("ZAKO5761 51.a člen third-country scope", [lawWorkScope]),
      govRef("GOV.SI complete national eligibility scope", [
        govEligibilityComplete,
        govEligibleCategory,
        govExclusions,
        govNoGuarantee,
      ]),
    ]],
    ["remote_work_relations", {
      allowedRelations: ["foreign_employer", "own_foreign_business", "foreign_clients"],
      slovenianLabourMarketWorkIncluded: false,
    }, [
      lawRef("ZAKO5761 51.a člen foreign work relations", [lawWorkScope]),
      govRef("GOV.SI complete remote-work relations", [govRemoteComplete, govNoSlovenianMarket]),
    ]],
    ["qualification", { rule: "not_listed_in_authoritative_requirements" }, [
      lawRef("ZAKO5761 51.a člen complete requirements", [
        lawRouteBasis,
        lawWorkScope,
        lawFamilyEntry,
        lawDuration,
        lawRequirementsComplete,
        lawPassport,
        lawInsurance,
        lawArticle55Applies,
        lawQualificationAbsent,
      ]),
    ]],
    ["companion_entry", { rule: "immediate_family_reunification_without_waiting_period" }, [
      govRef("GOV.SI immediate family entry", [govFamilyEntry]),
      lawRef("ZAKO5761 51.a člen immediate family entry", [lawFamilyEntry]),
    ]],
    ["duration", { maximumMonths: 12, extendable: false, reapplyAfterMonths: 6 }, [
      govRef("GOV.SI route duration", [govDuration]),
      lawRef("ZAKO5761 51.a člen route duration", [lawDuration]),
    ]],
    ["general_statutory_prerequisites", {
      passportBeyondPermitMonths: 3,
      healthInsurance: true,
      article55GroundsApply: true,
    }, [
      lawRef("ZAKO5761 51.a člen complete statutory prerequisites", [
        lawRequirementsComplete,
        lawPassport,
        lawInsurance,
        lawArticle55Applies,
        lawQualificationAbsent,
      ]),
      lawRef("ZAKO5761 55. člen applicable refusal grounds", [lawArticle55Grounds]),
    ]],
  ];
  return {
    ok: true,
    claims: claimInputs.map(([kind, value, claimEvidence]) =>
      verifiedClaim(
        entry.sourceId,
        kind,
        value,
        sourcePeriod,
        claimEvidence,
        "si-route@2",
      )
    ) as readonly VerifiedCountryClaim[],
  };
}

function periodAtOrBefore(period: string, assessmentAt: string): boolean {
  const match = /^(\d{4})M(0[1-9]|1[0-2])$/.exec(period);
  if (match === null || !/^\d{4}-\d{2}-\d{2}$/.test(assessmentAt)) return false;
  return `${match[1]}-${match[2]}` <= assessmentAt.slice(0, 7);
}

function isIsoDateAtOrBefore(value: string, assessmentAt: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !/^\d{4}-\d{2}-\d{2}$/.test(assessmentAt)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value &&
    value <= assessmentAt;
}

function decimalOrNull(value: string | undefined): Decimal | null {
  if (value === undefined || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return null;
  try {
    const parsed = new Decimal(value);
    return parsed.isPositive() ? parsed : null;
  } catch {
    return null;
  }
}

function pisrsPublicationSop(urlValue: string | undefined): string | null {
  if (urlValue === undefined) return null;
  try {
    const url = new URL(urlValue);
    const values = url.searchParams.getAll("sop");
    if (
      url.protocol !== "https:" ||
      url.host !== "pisrs.si" ||
      url.pathname !== "/pregledPredpisa" ||
      values.length !== 1 ||
      !/^\d{4}-\d{2}-\d{4}$/.test(values[0]!)
    ) return null;
    return values[0]!;
  } catch {
    return null;
  }
}

function capturedPublicationSop(
  entry: ParserEntry<SloveniaSourceId>,
  artifact: ArtifactBytes,
): string | null {
  const captured = artifact as Partial<LiveCapturedArtifact<SloveniaSourceId>>;
  const candidateSop = pisrsPublicationSop(entry.navigationUrl);
  const requestSop = pisrsPublicationSop(captured.request?.url);
  return candidateSop !== null && candidateSop === requestSop ? candidateSop : null;
}

function parseIncome(
  entry: ParserEntry<SloveniaSourceId>,
  assessmentAt: string,
): SloveniaValidationResult {
  const publication = artifactByRole(entry, "salary-publication");
  const metadataArtifact = artifactByRole(entry, "sistat-metadata");
  const seriesArtifact = artifactByRole(entry, "sistat-series");
  if (publication === undefined || metadataArtifact === undefined || seriesArtifact === undefined) {
    return { ok: false, kind: "semantic_mismatch" };
  }
  const publicationLines = htmlLines(publication);
  const metadata = sistatMetadataSchema.safeParse(jsonValue(metadataArtifact));
  const series = sistatSeriesSchema.safeParse(jsonValue(seriesArtifact));
  if (publicationLines === null || !metadata.success || !series.success) {
    return { ok: false, kind: "semantic_mismatch" };
  }
  const metadataCodes = metadata.data.variables.map(({ code }) => code);
  const uniqueMetadataCodes = new Set(metadataCodes);
  const uniqueSeriesCodes = new Set(series.data.id);
  const dimensionCodes = Object.keys(series.data.dimension);
  if (
    uniqueMetadataCodes.size !== metadataCodes.length ||
    uniqueSeriesCodes.size !== series.data.id.length ||
    series.data.size.length !== series.data.id.length ||
    dimensionCodes.length !== series.data.id.length ||
    dimensionCodes.some((code) => !uniqueSeriesCodes.has(code)) ||
    metadataCodes.length !== series.data.id.length ||
    metadataCodes.some((code, index) => code !== series.data.id[index])
  ) {
    return { ok: false, kind: "semantic_mismatch" };
  }
  const timeVariables = metadata.data.variables.filter(({ time }) => time === true);
  const metricMatches = metadata.data.variables.flatMap((variable) =>
    variable.valueTexts.flatMap((label, index) =>
      /^average monthly net salary$/i.test(label)
        ? [{ variable, value: variable.values[index] }]
        : []
    )
  );
  if (timeVariables.length !== 1 || metricMatches.length !== 1) {
    return { ok: false, kind: "semantic_mismatch" };
  }
  const timeVariable = timeVariables[0]!;
  const metric = metricMatches[0]!;
  if (
    metric.variable.code === timeVariable.code ||
    metadata.data.variables.some(({ values, valueTexts }) =>
      values.length !== valueTexts.length || new Set(values).size !== values.length
    ) ||
    metric.value === undefined
  ) {
    return { ok: false, kind: "semantic_mismatch" };
  }
  for (let index = 0; index < series.data.id.length; index += 1) {
    const code = series.data.id[index]!;
    const dimension = series.data.dimension[code];
    const metadataVariable = metadata.data.variables[index]!;
    if (
      dimension === undefined ||
      series.data.size[index] !== metadataVariable.values.length ||
      Object.keys(dimension.category.index).length !== metadataVariable.values.length ||
      metadataVariable.values.some((value, valueIndex) =>
        dimension.category.index[value] !== valueIndex ||
        dimension.category.label[value] !== metadataVariable.valueTexts[valueIndex]
      )
    ) {
      return { ok: false, kind: "semantic_mismatch" };
    }
  }
  const expectedValueCount = series.data.size.reduce((product, size) => product * size, 1);
  if (series.data.value.length !== expectedValueCount) {
    return { ok: false, kind: "semantic_mismatch" };
  }
  const applicablePeriods = timeVariable.values.filter((period) => periodAtOrBefore(period, assessmentAt));
  if (applicablePeriods.length === 0) return { ok: false, kind: "semantic_mismatch" };
  const period = [...applicablePeriods].sort().at(-1)!;
  if (applicablePeriods.filter((value) => value === period).length !== 1) {
    return { ok: false, kind: "semantic_mismatch" };
  }
  const coordinates = series.data.id.map((code) => {
    if (code === metric.variable.code) return metric.variable.values.indexOf(metric.value!);
    if (code === timeVariable.code) return timeVariable.values.indexOf(period);
    const variable = metadata.data.variables.find(({ code: variableCode }) => variableCode === code);
    return variable?.values.length === 1 ? 0 : -1;
  });
  if (coordinates.some((coordinate) => coordinate < 0)) {
    return { ok: false, kind: "semantic_mismatch" };
  }
  let flatIndex = 0;
  for (let index = 0; index < coordinates.length; index += 1) {
    flatIndex = flatIndex * series.data.size[index]! + coordinates[index]!;
  }
  const rawNetSalary = series.data.value[flatIndex];
  if (rawNetSalary === null || rawNetSalary <= 0) {
    return { ok: false, kind: "semantic_mismatch" };
  }
  const salary = new Decimal(rawNetSalary).toFixed(2);
  const capturedSop = capturedPublicationSop(entry, publication);
  const publicationId = prefixedLine(publicationLines, "PUBLICATION ID:")?.replace(/\.$/, "");
  const publishedAt = prefixedLine(publicationLines, "PUBLISHED:")?.replace(/\.$/, "");
  const publicationPeriod = prefixedLine(publicationLines, "PERIOD:")?.replace(/\.$/, "");
  const publicationValue = prefixedLine(publicationLines, "VALUE EUR:")?.replace(/\.$/, "");
  const publicationSalary = decimalOrNull(publicationValue);
  const publicationExcerpt = prefixedLine(publicationLines, "ANCHOR EXCERPT:");
  if (
    capturedSop === null || publicationId !== capturedSop ||
    publishedAt === undefined || !isIsoDateAtOrBefore(publishedAt, assessmentAt) ||
    uniqueLine(publicationLines, "DATASET: H285S.px.") === null ||
    uniqueLine(publicationLines, "METRIC: average monthly net salary.") === null ||
    uniqueLine(publicationLines, "FORMULA: 2 × latest average monthly net salary.") === null ||
    publicationPeriod !== period ||
    publicationSalary === null || !publicationSalary.equals(salary) ||
    publicationExcerpt !== `PISRS ${capturedSop} | NET | ${period} | ${salary} EUR` ||
    metadata.data.anchorExcerpt !== "H285S.px | dimensions complete | no pagination" ||
    series.data.anchorExcerpt !== `H285S.px | NET | ${period} | ${salary}`
  ) {
    return { ok: false, kind: "semantic_mismatch" };
  }
  const evidence = [
    evidenceRef(
      entry.sourceId,
      publication,
      period,
      `PISRS salary publication ${capturedSop}`,
      publicationExcerpt,
    ),
    evidenceRef(
      entry.sourceId,
      metadataArtifact,
      period,
      "H285S.px complete dimensions",
      metadata.data.anchorExcerpt,
    ),
    evidenceRef(
      entry.sourceId,
      seriesArtifact,
      period,
      `H285S.px NET ${period}`,
      series.data.anchorExcerpt,
    ),
  ] as const;
  return {
    ok: true,
    claims: [verifiedClaim(
      entry.sourceId,
      "income",
      {
        metric: "latest_official_average_monthly_net_salary",
        multiplier: "2",
        thresholdEur: new Decimal(salary).times(2).toFixed(2),
        period,
      },
      period,
      evidence,
      "si-income@2",
    )],
  };
}

function parseCompanion(
  entry: ParserEntry<SloveniaSourceId>,
  assessmentAt: string,
): SloveniaValidationResult {
  const ess = artifactByRole(entry, "ess-companion-page");
  const law = artifactByRole(entry, "zzsdt-consolidated");
  if (ess === undefined || law === undefined) return { ok: false, kind: "semantic_mismatch" };
  const essLines = htmlLines(ess);
  const lawLines = htmlLines(law);
  if (essLines === null || lawLines === null) return { ok: false, kind: "semantic_mismatch" };
  const sourcePeriod = selectedEffectiveState(lawLines, assessmentAt);
  const article32 = boundedSection(lawLines, "BEGIN 32. člen", "END 32. člen");
  const article33 = boundedSection(lawLines, "BEGIN 33. člen", "END 33. člen");
  const essExcerpt = prefixedLine(essLines, "ANCHOR EXCERPT:");
  const lawExcerpt = prefixedLine(lawLines, "ANCHOR EXCERPT:");
  const essSemantics = [
    "CONDITIONAL LOCAL EMPLOYMENT SCOPE: COMPLETE.",
    "A family member holding the relevant residence permit may enter local employment conditionally.",
    "An informativni list (information sheet) is required.",
    "A kontrola trga dela (labour-market check) is required.",
    "Automatic labour-market access is not granted.",
    "No conclusion is made about remote work for a foreign company.",
  ];
  const essText = essLines.join(" ");
  if (
    sourcePeriod !== "2026-01-01" ||
    essExcerpt !== "ESS | conditional local employment | informativni list | kontrola trga dela" ||
    lawExcerpt !== "ZAKO6655 | 32. člen + 33. člen | effective 2026-01-01" ||
    essSemantics.some((semantic) => uniqueLine(essLines, semantic) === null) ||
    !markersAreStrictlyOrdered(essLines, essSemantics) ||
    uniqueLine(lawLines, "LAW ID: ZAKO6655.") === null ||
    !markersAreStrictlyOrdered(lawLines, [
      "BEGIN 32. člen",
      "END 32. člen",
      "BEGIN 33. člen",
      "END 33. člen",
    ]) ||
    !containsExact(
      article32,
      "For conditional employment under a residence permit, an informativni list (information sheet) is required.",
    ) ||
    !containsExact(
      article33,
      "A kontrola trga dela (labour-market check) is required before local employment.",
    ) ||
    !containsExact(article33, "The provision does not create automatic access.") ||
    !markersAreStrictlyOrdered(article33 ?? [], [
      "A kontrola trga dela (labour-market check) is required before local employment.",
      "The provision does not create automatic access.",
    ]) ||
    /Automatic labour-market access is granted/i.test(essText) ||
    /Remote work for a foreign company is automatically allowed/i.test(essText)
  ) {
    return { ok: false, kind: "semantic_mismatch" };
  }
  if (article32 === null || article33 === null) return { ok: false, kind: "semantic_mismatch" };
  const essEvidenceLines = essSemantics.map((semantic) => uniqueLine(essLines, semantic)!);
  const lawEvidenceLines = [
    uniqueLine(
      article32,
      "For conditional employment under a residence permit, an informativni list (information sheet) is required.",
    )!,
    uniqueLine(
      article33,
      "A kontrola trga dela (labour-market check) is required before local employment.",
    )!,
    uniqueLine(article33, "The provision does not create automatic access.")!,
  ];
  const evidence = [
    evidenceRef(
      entry.sourceId,
      ess,
      sourcePeriod,
      "ESS complete conditional local employment scope",
      essEvidenceLines.join(" "),
    ),
    evidenceRef(
      entry.sourceId,
      law,
      sourcePeriod,
      "ZAKO6655 complete 32. člen + 33. člen",
      lawEvidenceLines.join(" "),
    ),
  ] as const;
  return {
    ok: true,
    claims: [verifiedClaim(
      entry.sourceId,
      "companion_local_work_access",
      { access: "conditional", labourMarketCheck: true, informationSheet: true },
      sourcePeriod,
      evidence,
      "si-companion@2",
    )],
  };
}

function parseCbr(entry: ParserEntry<SloveniaSourceId>): SloveniaValidationResult {
  const parsed = parseCbrEur(entry as unknown as ParserEntry);
  if (!parsed.ok) return parsed;
  const claims: readonly Claim<unknown, "cbr-eur">[] = parsed.anchors.map((claimAnchor, index) => ({
    claimId: `cbr-eur-facts-${index + 1}`,
    sourceId: "cbr-eur",
    value: parsed.facts,
    scope: "VS-2 Slovenia cold start",
    sourcePeriod: parsed.sourcePeriod,
    anchor: claimAnchor,
    status: "verified",
  }));
  return { ok: true, claims: claims as readonly ColdStartEvidenceClaim[] };
}

export function validateSloveniaEntry(
  entry: ParserEntry<SloveniaSourceId>,
  assessmentAt: string,
): SloveniaValidationResult {
  if (!entryHasValidIntegrity(entry)) return { ok: false, kind: "integrity_mismatch" };
  switch (entry.sourceId) {
    case "si-digital-nomad-route":
      return parseRoute(entry, assessmentAt);
    case "cbr-eur":
      return parseCbr(entry);
    case "si-income-threshold":
      return parseIncome(entry, assessmentAt);
    case "si-companion-employment":
      return parseCompanion(entry, assessmentAt);
  }
}
