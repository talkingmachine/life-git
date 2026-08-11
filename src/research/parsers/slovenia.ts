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
  sha256,
} from "./parser-support";

type SloveniaValidationResult =
  | { readonly ok: true; readonly claims: readonly ColdStartEvidenceClaim[] }
  | {
      readonly ok: false;
      readonly kind: "integrity_mismatch" | "semantic_mismatch" | "stale" | "conflict";
    };

export type PisrsRegistryIdentity =
  | { readonly kind: "record-id"; readonly value: "ZAKO5761" | "ZAKO6655" }
  | { readonly kind: "sop"; readonly value: string };

export interface PisrsSelectedNpb {
  readonly identity: string;
  readonly npbId: number;
  readonly ordinal: number;
  readonly label: "Osnovni" | `NPB ${number}`;
}

export interface SiStatMetadata {
  readonly dimensions: readonly {
    readonly code: string;
    readonly values: readonly string[];
    readonly labels: readonly string[];
    readonly isTime: boolean;
  }[];
}

const pisrsRegistrySchema = z.object({
  data: z.object({
    evidencniPodatki: z.object({
      semafor: z.object({
        id: z.number().int(),
        naziv: z.string(),
      }).passthrough(),
      naslov: z.string(),
      zunanjiID: z.string(),
      sop: z.string(),
      objavljeno: z.string(),
    }).passthrough(),
    besedilo: z.object({
      npbVerzije: z.array(z.object({
        id: z.number().int().positive(),
        naziv: z.string(),
      }).passthrough()).min(1),
    }).passthrough(),
  }).passthrough(),
  error: z.unknown().nullable(),
}).passthrough();

const pisrsDetailsSchema = z.object({
  data: z.object({
    besedilo: z.array(z.object({
      id: z.number().int().positive(),
      vsebina: z.string(),
      struktura: z.string(),
      navezavaNPB: z.object({ vsebina: z.string() }).passthrough().nullable(),
    }).passthrough()).min(1),
    kazalo: z.array(z.object({
      idStrukturniElement: z.number().int().positive(),
      idStrukturniElementPostavljeno: z.number().int().positive(),
      kazaloIme: z.string(),
      struktura: z.string(),
    }).passthrough()),
  }).passthrough(),
  error: z.unknown().nullable(),
}).passthrough();

type PisrsDetails = z.infer<typeof pisrsDetailsSchema>;
type PisrsTextItem = PisrsDetails["data"]["besedilo"][number];

interface PisrsDocument {
  readonly artifact: ArtifactBytes;
  readonly selected: PisrsSelectedNpb;
  readonly items: readonly PisrsTextItem[];
  readonly contents: PisrsDetails["data"]["kazalo"];
}

interface PisrsArticle {
  readonly startIndex: number;
  readonly contentsIndex: number;
  readonly items: readonly PisrsTextItem[];
}

const sistatWireMetadataSchema = z.object({
  title: z.string().min(1),
  variables: z.array(z.object({
    code: z.string().min(1),
    text: z.string().min(1),
    time: z.boolean().optional(),
    values: z.array(z.string().min(1)).min(1),
    valueTexts: z.array(z.string().min(1)).min(1),
  }).passthrough()).min(1),
}).passthrough();

interface LiveProvenanceExpectation {
  readonly sourceId: SloveniaSourceId;
  readonly role: string;
  readonly method: "GET" | "POST";
  readonly requestUrl: string;
  readonly bodySha256?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExpectedLiveProvenance(
  artifact: ArtifactBytes,
  expected: LiveProvenanceExpectation,
): artifact is LiveCapturedArtifact<SloveniaSourceId> {
  const candidate: unknown = artifact;
  if (!isRecord(candidate) || !isRecord(candidate.request)) return false;
  const request = candidate.request;
  const hasExpectedBody = expected.bodySha256 === undefined
    ? request.bodyMediaType === undefined && request.bodySha256 === undefined
    : request.bodyMediaType === "application/json" &&
      request.bodySha256 === expected.bodySha256;
  return candidate.origin === "live" &&
    typeof candidate.runId === "string" &&
    candidate.runId.length > 0 &&
    candidate.sourceId === expected.sourceId &&
    candidate.role === expected.role &&
    candidate.mediaType === "application/json" &&
    candidate.responseStatus === 200 &&
    candidate.url === expected.requestUrl &&
    candidate.responseUrl === expected.requestUrl &&
    typeof candidate.capturedAt === "string" &&
    request.method === expected.method &&
    request.url === expected.requestUrl &&
    hasExpectedBody;
}

const categorySchema = z.object({
  index: z.record(z.string(), z.number().int().nonnegative()),
  label: z.record(z.string(), z.string()),
}).passthrough();

const sistatSeriesSchema = z.object({
  version: z.literal("2.0"),
  class: z.literal("dataset"),
  source: z.string().optional(),
  id: z.array(z.string().min(1)).min(1),
  size: z.array(z.number().int().positive()).min(1),
  dimension: z.record(z.string(), z.object({
    label: z.string().min(1),
    category: categorySchema,
  }).passthrough()),
  value: z.array(z.number().finite().nullable()).min(1),
}).passthrough();

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

function pisrsRegistryProvenance(
  identity: PisrsRegistryIdentity,
  requestUrl: string,
): LiveProvenanceExpectation {
  if (identity.kind === "sop") {
    return {
      sourceId: "si-income-threshold",
      role: "salary-registry",
      method: "GET",
      requestUrl,
    };
  }
  return identity.value === "ZAKO5761"
    ? {
        sourceId: "si-digital-nomad-route",
        role: "ztuj2-registry",
        method: "GET",
        requestUrl,
      }
    : {
        sourceId: "si-companion-employment",
        role: "zzsdt-registry",
        method: "GET",
        requestUrl,
      };
}

function registryIdentityMatches(
  identity: PisrsRegistryIdentity,
  record: z.infer<typeof pisrsRegistrySchema>["data"]["evidencniPodatki"],
): boolean {
  const expectedStatus = identity.kind === "record-id"
    ? { id: 156, naziv: "Veljaven predpis" }
    : { id: 153, naziv: "Objavljen akt brez datuma začetka veljavnosti" };
  const hasExpectedIdentity = identity.kind === "record-id"
    ? record.zunanjiID === identity.value
    : record.sop === identity.value;
  return hasExpectedIdentity &&
    record.semafor.id === expectedStatus.id &&
    record.semafor.naziv === expectedStatus.naziv;
}

function hasUnsupportedCompletenessField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasUnsupportedCompletenessField);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, nested]) =>
    ["total", "hasmore", "continuationtoken", "pagination"].includes(key.toLowerCase()) ||
    hasUnsupportedCompletenessField(nested)
  );
}

function npbOrdinal(label: string): number | null {
  if (label === "Osnovni") return 0;
  const match = /^NPB ([1-9]\d*)$/.exec(label);
  if (match === null) return null;
  const ordinal = Number(match[1]);
  return Number.isSafeInteger(ordinal) ? ordinal : null;
}

export function decodePisrsRegistry(
  artifact: ArtifactBytes,
  expected: PisrsRegistryIdentity,
  expectedRequestUrl: string,
): PisrsSelectedNpb | null {
  if (!hasExpectedLiveProvenance(
    artifact,
    pisrsRegistryProvenance(expected, expectedRequestUrl),
  )) return null;
  const parsed = pisrsRegistrySchema.safeParse(jsonValue(artifact));
  if (
    !parsed.success ||
    parsed.data.error !== null ||
    !registryIdentityMatches(expected, parsed.data.data.evidencniPodatki) ||
    hasUnsupportedCompletenessField(parsed.data)
  ) return null;

  const versions = parsed.data.data.besedilo.npbVerzije.map((version) => ({
    id: version.id,
    ordinal: npbOrdinal(version.naziv),
  }));
  if (
    versions.some(({ ordinal }) => ordinal === null) ||
    new Set(versions.map(({ id }) => id)).size !== versions.length ||
    new Set(versions.map(({ ordinal }) => ordinal)).size !== versions.length
  ) return null;
  const ordinals = versions.map(({ ordinal }) => ordinal!);
  const maximumOrdinal = Math.max(...ordinals);
  if (
    ordinals.filter((ordinal) => ordinal === 0).length !== 1 ||
    versions.length !== maximumOrdinal + 1
  ) return null;
  const selected = versions.find(({ ordinal }) => ordinal === maximumOrdinal)!;
  return {
    identity: expected.value,
    npbId: selected.id,
    ordinal: maximumOrdinal,
    label: maximumOrdinal === 0 ? "Osnovni" : `NPB ${maximumOrdinal}`,
  };
}

export function decodeSiStatMetadata(
  artifact: ArtifactBytes,
  expectedRequestUrl: string,
): SiStatMetadata | null {
  if (!hasExpectedLiveProvenance(artifact, {
    sourceId: "si-income-threshold",
    role: "sistat-metadata",
    method: "GET",
    requestUrl: expectedRequestUrl,
  })) return null;
  const parsed = sistatWireMetadataSchema.safeParse(jsonValue(artifact));
  if (!parsed.success) return null;
  const codes = parsed.data.variables.map(({ code }) => code);
  if (
    new Set(codes).size !== codes.length ||
    parsed.data.variables.filter(({ time }) => time === true).length !== 1 ||
    parsed.data.variables.some(({ values, valueTexts }) =>
      values.length !== valueTexts.length || new Set(values).size !== values.length
    )
  ) return null;
  return {
    dimensions: parsed.data.variables.map(({ code, values, valueTexts, time }) => ({
      code,
      values: [...values],
      labels: [...valueTexts],
      isTime: time === true,
    })),
  };
}

export function encodeSiStatAllDimensionsQuery(metadata: SiStatMetadata): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    query: metadata.dimensions.map(({ code }) => ({
      code,
      selection: { filter: "all", values: ["*"] },
    })),
    response: { format: "json-stat2" },
  }));
}

const PISRS_API_ROOT = "https://pisrs.si/api/rezultat";

function pisrsRegistryUrl(identity: string): string {
  return `${PISRS_API_ROOT}/zbirka/id/${identity}`;
}

function pisrsDetailsUrl(npbId: number): string {
  return `${PISRS_API_ROOT}/neuradno-precisceno-besedilo/${npbId}/details`;
}

function normalizedMarkupText(value: string): string {
  return normalizedText(load(value).text());
}

function decodePisrsDocument(
  entry: ParserEntry<SloveniaSourceId>,
  identity: PisrsRegistryIdentity & { readonly kind: "record-id" },
  registryRole: string,
  detailsRole: string,
): PisrsDocument | null {
  const registry = artifactByRole(entry, registryRole);
  const details = artifactByRole(entry, detailsRole);
  if (registry === undefined || details === undefined) return null;
  const selected = decodePisrsRegistry(registry, identity, pisrsRegistryUrl(identity.value));
  if (selected === null || !hasExpectedLiveProvenance(details, {
    sourceId: entry.sourceId,
    role: detailsRole,
    method: "GET",
    requestUrl: pisrsDetailsUrl(selected.npbId),
  })) return null;
  const parsed = pisrsDetailsSchema.safeParse(jsonValue(details));
  if (parsed.success === false || parsed.data.error !== null) return null;
  const itemIds = parsed.data.data.besedilo.map(({ id }) => id);
  if (new Set(itemIds).size !== itemIds.length) return null;
  return {
    artifact: details,
    selected,
    items: parsed.data.data.besedilo,
    contents: parsed.data.data.kazalo,
  };
}

function isArticleHeading(value: string): boolean {
  return /^\d+\.(?:[a-z]\s+|\s+)člen$/u.test(value);
}

function findPisrsArticle(
  document: PisrsDocument,
  heading: string,
  contentsName: string,
): PisrsArticle | null {
  const starts = document.items.flatMap((item, index) =>
    item.struktura === "clen" && normalizedMarkupText(item.vsebina) === heading ? [index] : []
  );
  if (starts.length !== 1) return null;
  const startIndex = starts[0]!;
  const nextArticleIndex = document.items.findIndex((item, index) =>
    index > startIndex &&
    item.struktura === "clen" &&
    isArticleHeading(normalizedMarkupText(item.vsebina))
  );
  const items = document.items.slice(
    startIndex,
    nextArticleIndex === -1 ? document.items.length : nextArticleIndex,
  );
  const first = items[0];
  const last = items.at(-1);
  if (first === undefined || last === undefined) return null;
  const bindings = document.contents.flatMap((entry, contentsIndex) =>
    entry.struktura === "clen" && normalizedMarkupText(entry.kazaloIme) === contentsName
      ? [{ entry, contentsIndex }]
      : []
  );
  if (bindings.length !== 1) return null;
  const binding = bindings[0]!;
  if (
    binding.entry.idStrukturniElement !== first.id ||
    binding.entry.idStrukturniElementPostavljeno !== last.id
  ) return null;
  return { startIndex, contentsIndex: binding.contentsIndex, items };
}

function uniquePisrsItem(
  article: PisrsArticle,
  structure: string,
  expectedText: string,
): PisrsTextItem | null {
  const matches = article.items.filter((item) =>
    item.struktura === structure && normalizedMarkupText(item.vsebina) === expectedText
  );
  return matches.length === 1 ? matches[0]! : null;
}

function pisrsItemText(item: PisrsTextItem): string {
  return normalizedMarkupText(item.vsebina);
}

function pisrsArticleText(article: PisrsArticle): string {
  return article.items.map(pisrsItemText).join(" ");
}

const GOV_ROUTE_LINES = {
  title: "Temporary residence permit for digital nomads",
  publishedAt: "21. 11. 2025",
  workScope: "In Slovenia, a digital nomad is defined as a foreigner who is not a citizen of an EU or EEA country and who is either employed or performs work under a civil-law contract for a business entity based outside Slovenia or works as a self-employed person abroad, with all such work carried out remotely via information and communication technologies. The essential point is that the foreigner is not entering the Slovenian labour market. As a result, labour-market admission requirements do not apply to them (they do not need the permit normally issued by the Employment Service of Slovenia).",
  application: "Foreign nationals have to apply for a temporary residence permit for digital nomads at any diplomatic representation or consular post of the Republic of Slovenia abroad. Those already legally residing in Slovenia may also submit their application at any administrative unit in Slovenia.",
  duration: "A temporary residence permit for digital nomads may be issued for up to one year and cannot be extended, reflecting the highly mobile nature of this category of foreigners, who usually stay in a country only for a limited period (for example, during the summer season). A foreigner may reapply for a temporary residence permit for digital nomads six months after the expiry of their previous permit. However, if a digital nomad decides that they wish to continue residing in Slovenia (for example, because they wish to take up employment in the country), they may apply at any time during the validity of their digital-nomad temporary residence permit for another type of temporary residence permit based on a different purpose of stay.",
  funds: "To meet the requirement for sufficient means of subsistence, the foreigner must have monthly funds amounting to at least twice the average monthly net salary in Slovenia, calculated on the basis of the average monthly gross salary most recently published in the Official Gazette of the Republic of Slovenia. Proof of meeting this requirement may be provided through any lawful sources of income, as is the case for all other categories of foreigners.",
  family: "A notable feature of the temporary residence permit for digital nomads is the more favourable family-reunification regime. Digital nomads may reunite with their family members immediately, without any restrictions linked to the duration of the foreigner’s residence in Slovenia or the validity of their permit.",
} as const;

const ZTUJ2_ROUTE_LINES = {
  opening: "(1) Tujcu se lahko izda dovoljenje za začasno prebivanje za digitalnega nomada, če:",
  workScope: "- ni državljan EU ali državljan države članice Evropskega gospodarskega prostora in je zaposlen ali opravlja delo na podlagi sklenjene pogodbe civilnega prava pri poslovnem subjektu s sedežem izven Republike Slovenije ali opravlja delo kot samozaposlena oseba v tujini, pri čemer delo opravlja na daljavo prek komunikacijske tehnologije,",
  passport: "- ima veljavno potno listino, katere veljavnost je najmanj tri mesece daljša od nameravanega prebivanja v Republiki Sloveniji,",
  insurance: "- ima ustrezno zdravstveno zavarovanje, ki krije vsaj nujne zdravstvene storitve na območju Republike Slovenije,",
  funds: "- ima zadostna sredstva za preživljanje v času prebivanja v državi, mesečno najmanj v višini dvakratnika povprečne mesečne neto plače v Republiki Sloveniji, nazadnje objavljene v Uradnem listu Republike Slovenije,",
  refusalGrounds: "- ne obstajajo razlogi za zavrnitev izdaje dovoljenja za prebivanje iz prve, druge, tretje, četrte, pete, šeste, sedme, devete, desete, enajste ali dvanajste alineje prvega odstavka 55. člena tega zakona.",
  duration: "(4) Dovoljenje za začasno prebivanje za digitalnega nomada se izda za čas trajanja pogodbe o zaposlitvi ali pogodbe civilnega prava, vendar ne dlje kot za eno leto, samozaposlenemu pa za obdobje enega leta oziroma za čas nameravanega prebivanja, če je ta krajši, in v obliki iz 58. člena tega zakona, pri čemer se pri vrsti dovoljenja vpiše »digitalni nomad«.",
  reapplication: "(5) Dovoljenja za začasno prebivanje za digitalnega nomada ni mogoče podaljšati, lahko pa tujec za dovoljenje za začasno prebivanje za digitalnega nomada ponovno zaprosi po šestih mesecih od poteka veljavnosti dovoljenja za začasno prebivanje za digitalnega nomada.",
  article55Opening: "(1) Dovoljenje za prebivanje v Republiki Sloveniji se tujcu ne izda, če:",
} as const;

function parseRoute(entry: ParserEntry<SloveniaSourceId>, assessmentAt: string): SloveniaValidationResult {
  const gov = artifactByRole(entry, "gov-route-page");
  const document = decodePisrsDocument(
    entry,
    { kind: "record-id", value: "ZAKO5761" },
    "ztuj2-registry",
    "ztuj2-details",
  );
  if (gov === undefined || document === null) return { ok: false, kind: "semantic_mismatch" };
  const govLines = htmlLines(gov);
  const article51 = findPisrsArticle(
    document,
    "51.a člen",
    "51.a člen (dovoljenje za začasno prebivanje za digitalnega nomada)",
  );
  const article55 = findPisrsArticle(
    document,
    "55. člen",
    "55. člen (zavrnitev izdaje dovoljenja za prebivanje)",
  );
  if (govLines === null || article51 === null || article55 === null) {
    return { ok: false, kind: "semantic_mismatch" };
  }
  const applicability = article51.items[0]?.navezavaNPB?.vsebina;
  const applicabilityMatch = applicability === undefined
    ? null
    : /^Datum začetka uporabe: (\d{2})\.(\d{2})\.(\d{4})$/.exec(
        normalizedMarkupText(applicability),
      );
  const sourcePeriod = applicabilityMatch === null
    ? null
    : `${applicabilityMatch[3]}-${applicabilityMatch[2]}-${applicabilityMatch[1]}`;
  const orderedGovLines = Object.values(GOV_ROUTE_LINES);
  const opening = uniquePisrsItem(article51, "odstavek", ZTUJ2_ROUTE_LINES.opening);
  const workScope = uniquePisrsItem(
    article51,
    "alinea_za_odstavkom",
    ZTUJ2_ROUTE_LINES.workScope,
  );
  const passport = uniquePisrsItem(
    article51,
    "alinea_za_odstavkom",
    ZTUJ2_ROUTE_LINES.passport,
  );
  const insurance = uniquePisrsItem(
    article51,
    "alinea_za_odstavkom",
    ZTUJ2_ROUTE_LINES.insurance,
  );
  const funds = uniquePisrsItem(article51, "alinea_za_odstavkom", ZTUJ2_ROUTE_LINES.funds);
  const refusalGrounds = uniquePisrsItem(
    article51,
    "alinea_za_odstavkom",
    ZTUJ2_ROUTE_LINES.refusalGrounds,
  );
  const duration = uniquePisrsItem(article51, "odstavek", ZTUJ2_ROUTE_LINES.duration);
  const reapplication = uniquePisrsItem(
    article51,
    "odstavek",
    ZTUJ2_ROUTE_LINES.reapplication,
  );
  const article55Opening = uniquePisrsItem(
    article55,
    "odstavek",
    ZTUJ2_ROUTE_LINES.article55Opening,
  );
  const completeArticle51 = pisrsArticleText(article51);
  if (
    sourcePeriod === null ||
    !isIsoDateAtOrBefore(sourcePeriod, assessmentAt) ||
    sourcePeriod !== "2025-11-21" ||
    orderedGovLines.some((line) => uniqueLine(govLines, line) === null) ||
    !markersAreStrictlyOrdered(govLines, orderedGovLines) ||
    [opening, workScope, passport, insurance, funds, refusalGrounds, duration, reapplication,
      article55Opening].some((item) => item === null) ||
    article51.startIndex >= article55.startIndex ||
    article51.contentsIndex >= article55.contentsIndex ||
    /\b(?:diploma|degree|qualification)\b|izobraz/iu.test(completeArticle51)
  ) return { ok: false, kind: "semantic_mismatch" };

  const govTitle = uniqueLine(govLines, GOV_ROUTE_LINES.title)!;
  const govPublicationDate = uniqueLine(govLines, GOV_ROUTE_LINES.publishedAt)!;
  const govWorkScope = uniqueLine(govLines, GOV_ROUTE_LINES.workScope)!;
  const govDuration = uniqueLine(govLines, GOV_ROUTE_LINES.duration)!;
  const govFamily = uniqueLine(govLines, GOV_ROUTE_LINES.family)!;
  const version = `${document.selected.identity} ${document.selected.label}`;
  const govRef = (locator: string, lines: readonly string[]) =>
    evidenceRef(entry.sourceId, gov, sourcePeriod, locator, lines.join(" "));
  const lawRef = (locator: string, items: readonly PisrsTextItem[]) =>
    evidenceRef(
      entry.sourceId,
      document.artifact,
      sourcePeriod,
      `PISRS ${version} > ${locator}`,
      items.map(pisrsItemText).join(" "),
    );
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
      lawRef("51.a člen > route basis", [article51.items[0]!, opening!]),
    ]],
    ["citizenship_applicability", {
      eligibleCategory: "third_country_national",
      explicitNationalityExclusions: ["EU", "EEA"],
    }, [
      lawRef("51.a člen > citizenship scope", [workScope!]),
      govRef("GOV.SI citizenship scope", [govWorkScope]),
    ]],
    ["remote_work_relations", {
      allowedRelations: ["foreign_employer", "own_foreign_business", "foreign_clients"],
      slovenianLabourMarketWorkIncluded: false,
    }, [
      lawRef("51.a člen > remote-work relations", [workScope!]),
      govRef("GOV.SI remote-work relations", [govWorkScope]),
    ]],
    ["qualification", { rule: "not_listed_in_authoritative_requirements" }, [
      lawRef("51.a člen > complete bounded article", article51.items),
    ]],
    ["companion_entry", { rule: "immediate_family_reunification_without_waiting_period" }, [
      govRef("GOV.SI immediate family entry", [govFamily]),
    ]],
    ["duration", { maximumMonths: 12, extendable: false, reapplyAfterMonths: 6 }, [
      govRef("GOV.SI route duration", [govDuration]),
      lawRef("51.a člen > duration and reapplication", [duration!, reapplication!]),
    ]],
    ["general_statutory_prerequisites", {
      passportBeyondPermitMonths: 3,
      healthInsurance: true,
      article55GroundsApply: true,
    }, [
      lawRef("51.a člen > passport, insurance, and refusal prerequisites", [
        passport!,
        insurance!,
        refusalGrounds!,
      ]),
      lawRef("55. člen > refusal grounds opening", [article55Opening!]),
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

function pisrsPublicationSop(urlValue: string | undefined): string | null {
  if (urlValue === undefined) return null;
  try {
    const url = new URL(urlValue);
    const values = url.searchParams.getAll("sop");
    if (
      url.protocol !== "https:" ||
      url.host !== "pisrs.si" ||
      !["/Pis.web/pregledPredpisa", "/pregledPredpisa"].includes(url.pathname) ||
      values.length !== 1 ||
      !/^\d{4}-\d{2}-\d{4}$/.test(values[0]!)
    ) return null;
    return values[0]!;
  } catch {
    return null;
  }
}

function pisrsSopRegistryUrl(sop: string): string {
  return `${PISRS_API_ROOT}/zbirka/sop/${sop}`;
}

const SISTAT_API_URL = "https://pxweb.stat.si/SiStatData/api/v1/en/Data/H285S.px";

const SLOVENE_MONTH = Object.freeze({
  januar: "01",
  februar: "02",
  marec: "03",
  april: "04",
  maj: "05",
  junij: "06",
  julij: "07",
  avgust: "08",
  september: "09",
  oktober: "10",
  november: "11",
  december: "12",
} as const);

const SALARY_TITLE_PATTERN = /^Sklep o objavi gibanja plač za ([a-zčšž]+) (\d{4})$/u;
const MONTHLY_NET_SALARY_PATTERN = /^Povprečna mesečna neto plača na zaposleno osebo v Sloveniji za ([a-zčšž]+) (\d{4}) je znašala ((?:[1-9]\d{0,2}(?:\.\d{3})*|[1-9]\d*),\d{2}) EUR(?: in .+)?\.$/u;

interface PisrsSalaryPublication {
  readonly artifact: ArtifactBytes;
  readonly sop: string;
  readonly period: string;
  readonly salary: Decimal;
  readonly paragraph: string;
}

interface SiStatIncomeCoordinate {
  readonly metadataArtifact: ArtifactBytes;
  readonly seriesArtifact: ArtifactBytes;
  readonly period: string;
  readonly salary: Decimal;
  readonly metricCode: string;
  readonly metadataProjection: string;
  readonly coordinateProjection: string;
}

function salaryPeriod(month: string, year: string): string | null {
  const monthNumber = SLOVENE_MONTH[month as keyof typeof SLOVENE_MONTH];
  return monthNumber === undefined ? null : `${year}M${monthNumber}`;
}

function localizedSalary(value: string): Decimal | null {
  if (!/^(?:[1-9]\d{0,2}(?:\.\d{3})*|[1-9]\d*),\d{2}$/.test(value)) return null;
  try {
    const salary = new Decimal(value.replaceAll(".", "").replace(",", "."));
    return salary.isPositive() ? salary : null;
  } catch {
    return null;
  }
}

function decodePisrsSalaryPublication(
  entry: ParserEntry<SloveniaSourceId>,
  assessmentAt: string,
): PisrsSalaryPublication | null {
  const sop = pisrsPublicationSop(entry.navigationUrl);
  const registry = artifactByRole(entry, "salary-registry");
  const details = artifactByRole(entry, "salary-details");
  if (sop === null || registry === undefined || details === undefined) return null;
  const selected = decodePisrsRegistry(
    registry,
    { kind: "sop", value: sop },
    pisrsSopRegistryUrl(sop),
  );
  const registryValue = pisrsRegistrySchema.safeParse(jsonValue(registry));
  if (
    selected === null ||
    selected.ordinal !== 0 ||
    selected.label !== "Osnovni" ||
    !registryValue.success ||
    !isIsoDateAtOrBefore(
      registryValue.data.data.evidencniPodatki.objavljeno,
      assessmentAt,
    ) ||
    !hasExpectedLiveProvenance(details, {
      sourceId: entry.sourceId,
      role: "salary-details",
      method: "GET",
      requestUrl: pisrsDetailsUrl(selected.npbId),
    })
  ) return null;
  const detailsValue = pisrsDetailsSchema.safeParse(jsonValue(details));
  if (!detailsValue.success || detailsValue.data.error !== null) return null;
  const itemIds = detailsValue.data.data.besedilo.map(({ id }) => id);
  if (new Set(itemIds).size !== itemIds.length) return null;

  const titles = detailsValue.data.data.besedilo.flatMap((item) => {
    const title = pisrsItemText(item);
    const match = item.struktura === "naslov" ? SALARY_TITLE_PATTERN.exec(title) : null;
    const period = match === null ? null : salaryPeriod(match[1]!, match[2]!);
    return period === null ? [] : [{ item, title, period }];
  });
  const paragraphs = detailsValue.data.data.besedilo.flatMap((item) => {
    const paragraph = pisrsItemText(item);
    const match = item.struktura === "odstavek"
      ? MONTHLY_NET_SALARY_PATTERN.exec(paragraph)
      : null;
    const period = match === null ? null : salaryPeriod(match[1]!, match[2]!);
    const salary = match === null ? null : localizedSalary(match[3]!);
    return period === null || salary === null ? [] : [{ paragraph, period, salary }];
  });
  if (titles.length !== 1 || paragraphs.length !== 1) return null;
  const title = titles[0]!;
  const paragraph = paragraphs[0]!;
  const registryTitle = normalizedMarkupText(
    registryValue.data.data.evidencniPodatki.naslov,
  );
  const titleBindings = detailsValue.data.data.kazalo.filter((entryValue) =>
    entryValue.struktura === "naslov" &&
    normalizedMarkupText(entryValue.kazaloIme) === title.title
  );
  if (
    registryTitle !== title.title ||
    title.period !== paragraph.period ||
    titleBindings.length !== 1 ||
    titleBindings[0]!.idStrukturniElement !== title.item.id ||
    titleBindings[0]!.idStrukturniElementPostavljeno !== title.item.id
  ) return null;
  return {
    artifact: details,
    sop,
    period: paragraph.period,
    salary: paragraph.salary,
    paragraph: paragraph.paragraph,
  };
}

function sameKeys(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length &&
    actual.every((value) => expected.includes(value));
}

function decodeSiStatIncomeCoordinate(
  entry: ParserEntry<SloveniaSourceId>,
  assessmentAt: string,
): SiStatIncomeCoordinate | null {
  const metadataArtifact = artifactByRole(entry, "sistat-metadata");
  const seriesArtifact = artifactByRole(entry, "sistat-series");
  if (metadataArtifact === undefined || seriesArtifact === undefined) return null;
  const metadata = decodeSiStatMetadata(metadataArtifact, SISTAT_API_URL);
  const metadataWire = sistatWireMetadataSchema.safeParse(jsonValue(metadataArtifact));
  if (metadata === null || !metadataWire.success) return null;
  const bodySha256 = sha256(encodeSiStatAllDimensionsQuery(metadata));
  if (!hasExpectedLiveProvenance(seriesArtifact, {
    sourceId: entry.sourceId,
    role: "sistat-series",
    method: "POST",
    requestUrl: SISTAT_API_URL,
    bodySha256,
  })) return null;
  const series = sistatSeriesSchema.safeParse(jsonValue(seriesArtifact));
  if (!series.success) return null;
  const metadataCodes = metadata.dimensions.map(({ code }) => code);
  const dimensionKeys = Object.keys(series.data.dimension);
  if (
    series.data.id.length !== metadata.dimensions.length ||
    series.data.size.length !== metadata.dimensions.length ||
    new Set(series.data.id).size !== series.data.id.length ||
    series.data.id.some((code, index) => code !== metadataCodes[index]) ||
    !sameKeys(dimensionKeys, series.data.id)
  ) return null;

  for (let index = 0; index < metadata.dimensions.length; index += 1) {
    const metadataDimension = metadata.dimensions[index]!;
    const metadataVariable = metadataWire.data.variables[index]!;
    const seriesDimension = series.data.dimension[metadataDimension.code];
    if (seriesDimension === undefined) return null;
    const indexKeys = Object.keys(seriesDimension.category.index);
    const labelKeys = Object.keys(seriesDimension.category.label);
    if (
      series.data.size[index] !== metadataDimension.values.length ||
      seriesDimension.label !== metadataVariable.text ||
      !sameKeys(indexKeys, metadataDimension.values) ||
      !sameKeys(labelKeys, metadataDimension.values) ||
      metadataDimension.values.some((value, valueIndex) =>
        seriesDimension.category.index[value] !== valueIndex ||
        seriesDimension.category.label[value] !== metadataDimension.labels[valueIndex]
      )
    ) return null;
  }

  const timeDimensions = metadata.dimensions.filter(({ isTime }) => isTime);
  const netCategories = metadata.dimensions.flatMap((dimension) =>
    dimension.isTime
      ? []
      : dimension.labels.flatMap((label, index) =>
          label === "Net earnings"
            ? [{ dimension, value: dimension.values[index] }]
            : []
        )
  );
  if (timeDimensions.length !== 1 || netCategories.length !== 1) return null;
  const timeDimension = timeDimensions[0]!;
  const netCategory = netCategories[0]!;
  if (
    netCategory.value === undefined ||
    metadata.dimensions.some((dimension) =>
      !dimension.isTime &&
      dimension.code !== netCategory.dimension.code &&
      dimension.values.length !== 1
    ) ||
    timeDimension.values.some((period) => !/^\d{4}M(?:0[1-9]|1[0-2])$/.test(period))
  ) return null;
  const applicablePeriods = timeDimension.values.filter((period) =>
    periodAtOrBefore(period, assessmentAt)
  );
  if (applicablePeriods.length === 0) return null;
  const period = [...applicablePeriods].sort().at(-1)!;
  const coordinates = metadata.dimensions.map((dimension) => {
    if (dimension.code === timeDimension.code) return dimension.values.indexOf(period);
    if (dimension.code === netCategory.dimension.code) {
      return dimension.values.indexOf(netCategory.value!);
    }
    return 0;
  });
  if (coordinates.some((coordinate) => coordinate < 0)) return null;
  const expectedValueCount = series.data.size.reduce((product, size) => product * size, 1);
  if (!Number.isSafeInteger(expectedValueCount) || series.data.value.length !== expectedValueCount) {
    return null;
  }
  let flatIndex = 0;
  for (let index = 0; index < coordinates.length; index += 1) {
    flatIndex = flatIndex * series.data.size[index]! + coordinates[index]!;
  }
  const rawSalary = series.data.value[flatIndex];
  if (rawSalary === null || !Number.isFinite(rawSalary) || rawSalary <= 0) return null;
  const metricIndex = metadataCodes.indexOf(netCategory.dimension.code);
  const metadataVariable = metadataWire.data.variables[metricIndex];
  if (metadataVariable === undefined) return null;
  const coordinate = Object.fromEntries(metadata.dimensions.map((dimension, index) => [
    dimension.code,
    dimension.values[coordinates[index]!]!,
  ]));
  return {
    metadataArtifact,
    seriesArtifact,
    period,
    salary: new Decimal(rawSalary),
    metricCode: netCategory.dimension.code,
    metadataProjection: JSON.stringify({
      dimension: { code: netCategory.dimension.code, label: metadataVariable.text },
      category: { value: netCategory.value, label: "Net earnings" },
    }),
    coordinateProjection: JSON.stringify({ coordinate, value: rawSalary }),
  };
}

function parseIncome(
  entry: ParserEntry<SloveniaSourceId>,
  assessmentAt: string,
): SloveniaValidationResult {
  const publication = decodePisrsSalaryPublication(entry, assessmentAt);
  const coordinate = decodeSiStatIncomeCoordinate(entry, assessmentAt);
  if (
    publication === null ||
    coordinate === null ||
    publication.period !== coordinate.period ||
    !publication.salary.equals(coordinate.salary)
  ) return { ok: false, kind: "semantic_mismatch" };
  const period = publication.period;
  const evidence = [
    evidenceRef(
      entry.sourceId,
      publication.artifact,
      period,
      `PISRS salary publication ${publication.sop} > monthly net salary ${period}`,
      publication.paragraph,
    ),
    evidenceRef(
      entry.sourceId,
      coordinate.metadataArtifact,
      period,
      `H285S.px metadata > ${coordinate.metricCode} > Net earnings`,
      coordinate.metadataProjection,
    ),
    evidenceRef(
      entry.sourceId,
      coordinate.seriesArtifact,
      period,
      `H285S.px series > ${period} > Net earnings`,
      coordinate.coordinateProjection,
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
        thresholdEur: publication.salary.times(2).toFixed(2),
        period,
      },
      period,
      evidence,
      "si-income@2",
    )],
  };
}

const ESS_COMPANION_LINES = {
  title: "Zaposlitev tujcev z dovoljenjem za prebivanje",
  permitScope: "Tujci z dovoljenjem za začasno prebivanje, ki ni izdano zaradi zaposlitve, samozaposlitve ali dela, pač pa na primer zaradi združitve družine, študija ali drugih razlogov, se lahko zaposlijo na podlagi pridobljenega informativnega lista.",
  informationSheetBasis: "Informativni list izdamo na območni službi Zavoda v skladu Zakonom o zaposlovanju, samozaposlovanju in delu tujcev (ZZSDT, 33. člen).",
  procedureHeading: "Kakšen je postopek zaposlitve?",
  vacancyNotice: "2. Delodajalci pri našem pristojnem uradu za delo razpišete prosto delovno mesto na obrazcu PDM-KTD in označite točko b) nova zaposlitev tujca z dovoljenjem za prebivanje, ki ni izdano zaradi zaposlitve ali dela.",
  labourMarketCheck: "3. Na Zavodu preverimo trg dela.",
  writtenNotice: "4. Če v evidenci brezposelnih ni ustreznih kandidatov, v 5 delovnih dneh posredujemo pisno obvestilo in informativni list vam kot delodajalcu, upravni enoti in inšpektoratu. Na informativnem listu so navedeni vsi elementi in pogoji zaposlitve.",
  cardAccess: "Na podlagi informativnega lista bo upravna enota izdala tujcu novo izkaznico dovoljenja za prebivanje, na kateri bo pripisana pravica do dostopa na trg dela. Hkrati bo tujec prejel še pri upravni enoti potrjen informativni list.",
  pendingCardAccess: "Do izdaje izkaznice dovoljenja za prebivanje, na kateri je označena pravica do dela, se tujec lahko zaposli in vključi v obvezna socialna zavarovanja na podlagi veljavne izkaznice dovoljenja za prebivanje, ki ni izdano zaradi zaposlitve, samozaposlitve ali dela, in informativnega lista.",
} as const;

const ZZSDT_COMPANION_LINES = {
  permitScope: "Tujec z dovoljenjem za začasno prebivanje, ki ni izdano zaradi zaposlitve, samozaposlitve ali dela, in ki mu ni prepovedano zaposlovanje, samozaposlovanje in delo v skladu z 42. členom tega zakona, se lahko zaposli, samozaposli ali dela v skladu z določbami tega poglavja, razen tujcev, ki imajo pravico do prostega dostopa na slovenski trg dela na podlagi tega zakona.",
  labourMarketCondition: "(1) Tujec z dovoljenjem za začasno prebivanje, ki ni izdano zaradi zaposlitve, samozaposlitve ali dela, se lahko zaposli le na delovnem mestu, za katerega v evidenci brezposelnih oseb ni ustreznih brezposelnih oseb, razen v primeru opravljanja dela zastopnika.",
  writtenNotice: "(2) V primeru, da v evidenci brezposelnih oseb ni vpisanih ustreznih kandidatov, zavod v petih delovnih dneh od sporočila o prostem delovnem mestu delodajalcu, upravni enoti ter pristojnemu nadzornemu organu o tem posreduje pisno obvestilo ter informativni list, na katerem so navedeni vsi pogoji in elementi zaposlitve, ki jih je delodajalec opredelil v sporočilu. V primeru zaposlitve tujca za opravljanje dela zastopnika in tujca, ki je bil predhodno že zakonito zaposlen pri istem delodajalcu na istem delovnem mestu, se informativni list izda brez preverjanja obstoja ustreznih brezposelnih oseb v evidenci zavoda.",
  cardAccess: "(4) Tujec z dovoljenjem za začasno prebivanje, ki ni izdano zaradi zaposlitve, samozaposlitve ali dela, je lahko zaposlen le na podlagi veljavne izkaznice dovoljenja za prebivanje, na kateri je označena pravica do dela, kateri upravna enota ob vročitvi priloži tudi informativni list. Do izdaje izkaznice dovoljenja za prebivanje, na kateri je označena pravica do dela, se tujec lahko zaposli in vključi v obvezna socialna zavarovanja na podlagi veljavne izkaznice dovoljenja za prebivanje, ki ni izdano zaradi zaposlitve, samozaposlitve ali dela, in informativnega lista iz drugega odstavka tega člena.",
} as const;

function parseCompanion(
  entry: ParserEntry<SloveniaSourceId>,
): SloveniaValidationResult {
  const ess = artifactByRole(entry, "ess-companion-page");
  const document = decodePisrsDocument(
    entry,
    { kind: "record-id", value: "ZAKO6655" },
    "zzsdt-registry",
    "zzsdt-details",
  );
  if (ess === undefined || document === null) return { ok: false, kind: "semantic_mismatch" };
  const essLines = htmlLines(ess);
  const article32 = findPisrsArticle(
    document,
    "32. člen",
    "32. člen (splošna določba)",
  );
  const article33 = findPisrsArticle(
    document,
    "33. člen",
    "33. člen (zaposlovanje)",
  );
  if (essLines === null || article32 === null || article33 === null) {
    return { ok: false, kind: "semantic_mismatch" };
  }
  const orderedEssLines = Object.values(ESS_COMPANION_LINES);
  const permitScope = uniquePisrsItem(
    article32,
    "odstavek",
    ZZSDT_COMPANION_LINES.permitScope,
  );
  const labourMarketCondition = uniquePisrsItem(
    article33,
    "odstavek",
    ZZSDT_COMPANION_LINES.labourMarketCondition,
  );
  const writtenNotice = uniquePisrsItem(
    article33,
    "odstavek",
    ZZSDT_COMPANION_LINES.writtenNotice,
  );
  const cardAccess = uniquePisrsItem(
    article33,
    "odstavek",
    ZZSDT_COMPANION_LINES.cardAccess,
  );
  if (
    orderedEssLines.some((line) => uniqueLine(essLines, line) === null) ||
    !markersAreStrictlyOrdered(essLines, orderedEssLines) ||
    [permitScope, labourMarketCondition, writtenNotice, cardAccess].some((item) => item === null) ||
    article32.startIndex >= article33.startIndex ||
    article32.contentsIndex >= article33.contentsIndex ||
    article32.items[0]?.navezavaNPB !== null ||
    article33.items[0]?.navezavaNPB !== null
  ) return { ok: false, kind: "semantic_mismatch" };

  const sourcePeriod = `${document.selected.identity}:${document.selected.label}`;
  const essEvidenceLines = [
    ESS_COMPANION_LINES.permitScope,
    ESS_COMPANION_LINES.informationSheetBasis,
    ESS_COMPANION_LINES.labourMarketCheck,
    ESS_COMPANION_LINES.writtenNotice,
    ESS_COMPANION_LINES.cardAccess,
    ESS_COMPANION_LINES.pendingCardAccess,
  ];
  const version = `${document.selected.identity} ${document.selected.label}`;
  const evidence = [
    evidenceRef(
      entry.sourceId,
      ess,
      sourcePeriod,
      "ESS conditional employment procedure",
      essEvidenceLines.join(" "),
    ),
    evidenceRef(
      entry.sourceId,
      document.artifact,
      sourcePeriod,
      `PISRS ${version} > 32.–33. člen > conditional employment procedure`,
      [permitScope!, labourMarketCondition!, writtenNotice!, cardAccess!]
        .map(pisrsItemText)
        .join(" "),
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
      return parseCompanion(entry);
  }
}
