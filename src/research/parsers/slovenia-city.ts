import { z } from "zod";

import type { CityFixedAttemptRejectionReason } from "../city-evidence";

export type SloveniaCityParserOutcome<T> =
  | { readonly kind: "observation"; readonly value: T }
  | { readonly kind: "rejected"; readonly reason: CityFixedAttemptRejectionReason };

export interface SloveniaCatalogFeasibilityObservation {
  readonly schemaVersion: "slovenia-city-catalog-feasibility@1";
  readonly consideredUniverseRows: 104;
  readonly comparablePopulationRows: 104;
  readonly catalogArtifactVersion: null;
  readonly registryCoordinatesSealed: false;
  readonly installable: false;
}

export interface SloveniaRentMechanicsObservation {
  readonly schemaVersion: "slovenia-city-rent-mechanics@1";
  readonly municipalityCode: string;
  readonly referencePeriod: string;
  readonly unit: "EUR per square metre per month";
  readonly denominator: "qualifying lease contracts";
  readonly qualifyingCount: number;
  readonly median: string;
  readonly fixtureClass: "redacted-derived";
  readonly productionClaimAuthorized: false;
}

export interface SloveniaTransitUniverseObservation {
  readonly schemaVersion: "slovenia-city-transit-universe@1";
  readonly sourceUniverseComplete: false;
  readonly missingMunicipalCoverageMeansZero: false;
  readonly rejectionReason: "universe_incomplete";
}

export interface SloveniaBroadbandFeasibilityObservation {
  readonly schemaVersion: "slovenia-city-broadband-feasibility@1";
  readonly sourceField: "gosp_vsaj_100_delez";
  readonly sourceAreaIdentifierFields: readonly ["eid_naselj", "eid_obcina"];
  readonly currentPortalStatusObserved: boolean;
  readonly underlyingReferencePeriodProved: false;
  readonly productionReuseLicenseProved: false;
  readonly comparableCriterionDefinitionApproved: false;
}

const catalogRowSchema = z.strictObject({
  code: z.string().regex(/^\d{6}$/),
  officialName: z.string().min(1),
  municipalityCode: z.string().regex(/^\d{3}$/),
  municipalityName: z.string().min(1),
  population: z.number().int().positive(),
});

const catalogProjectionSchema = z.strictObject({
  schemaVersion: z.literal("slovenia-smn-central-urban-projection@1"),
  classification: z.literal("SMN 2022"),
  classificationEffectiveFrom: z.literal("2022-11-17"),
  populationReferenceDate: z.literal("2026-01-01"),
  populationReleaseDate: z.literal("2026-06-11"),
  sourceClassificationRows: z.literal(104),
  rows: z.array(catalogRowSchema).length(104),
}).superRefine(({ rows }, context) => {
  const codes = rows.map(({ code }) => code);
  if (new Set(codes).size !== rows.length) {
    context.addIssue({ code: "custom", message: "duplicate catalog code" });
  }
  rows.forEach((row, index) => {
    if (!row.code.startsWith(row.municipalityCode)) {
      context.addIssue({ code: "custom", message: "catalog area mismatch", path: ["rows", index] });
    }
    if (index > 0 && codes[index - 1]! >= row.code) {
      context.addIssue({ code: "custom", message: "catalog order mismatch", path: ["rows", index] });
    }
  });
});

const rentAggregateSchema = z.strictObject({
  schemaVersion: z.literal("slovenia-etn-rent-aggregate@1"),
  sourceArchive: z.strictObject({
    name: z.literal("ETN_061_2025_NP_20260808.zip"),
    sha256: z.literal("ca349751f5d0679412ae8e1a8c5df3b7d041adbbeca1cf5e5621dc22b4f29188"),
  }),
  municipalityCode: z.literal("61"),
  referencePeriod: z.literal("2025"),
  unit: z.literal("EUR per square metre per month"),
  denominator: z.literal("qualifying lease contracts"),
  qualifyingCount: z.literal(9982),
  median: z.literal(9.090909090909092),
  privacy: z.literal(
    "Redacted aggregate only; no source transaction, address, coordinate, note or property identifier is committed.",
  ),
});

const transitTripSchema = z.strictObject({
  agencyId: z.string().min(1),
  agencyName: z.string().min(1),
  routeId: z.string().min(1),
  routeShortName: z.string().min(1),
  routeLongName: z.string().min(1),
  tripId: z.string().min(1),
  serviceId: z.string().min(1),
  stopTimeRows: z.number().int().positive(),
  firstDeparture: z.string().regex(/^\d{2}:\d{2}:\d{2}$/),
  lastArrival: z.string().regex(/^\d{2}:\d{2}:\d{2}$/),
});

const transitProjectionSchema = z.strictObject({
  schemaVersion: z.literal("slovenia-dujpp-coverage-projection@1"),
  referenceDate: z.literal("2026-08-17"),
  source: z.strictObject({
    url: z.literal("https://dujpp.si/gtfs/dujpp-ijpp.zip"),
    datasetId: z.literal("8db7cc40-3770-d834-5e15-81a0a7763f58"),
    bytes: z.literal(41195555),
    sha256: z.literal("e5458f9dff5ae2ccf08079dfaabb80524706fc3759f638bba81c5d8a73371f34"),
    feedVersion: z.literal("260813.5003600"),
    feedStartDate: z.literal("2025-12-29"),
    feedEndDate: z.literal("2028-01-02"),
  }),
  selectedActiveTrips: z.array(transitTripSchema).length(3),
  fullSourceCoverage: z.strictObject({
    agencies: z.literal(5),
    routes: z.literal(2477),
    trips: z.literal(19020),
    stops: z.literal(9793),
    stopTimes: z.literal(364105),
    lppRouteRecords: z.literal(107),
    lppUniqueLineCodes: z.literal(37),
    marpromAgencyMatches: z.literal(0),
  }),
  expectedConclusion: z.literal("absence_in_dujpp_is_not_zero_municipal_transit"),
});

const broadbandFeatureSchema = z.strictObject({
  type: z.literal("Feature"),
  properties: z.strictObject({
    eid_naselj: z.string().regex(/^\d{18}$/),
    eid_obcina: z.string().regex(/^\d{18}$/),
    naziv: z.string().min(1),
    gosp_vsaj_100_delez: z.number().finite().min(0).max(100),
  }),
  geometryOmitted: z.literal(true),
});

const broadbandStatusSchema = z.strictObject({
  label: z.literal("Fiksna širokopasovna pokritost"),
  status: z.literal("Aktualni podatki"),
  updateCadence: z.literal("daily"),
  source: z.literal("https://gis.akos-rs.si/StanjePodatkov?lang=slo"),
  capturedResponseSha256: z.literal(
    "15e1142f9ff7f828a3c22262b768ba8aeba5c6487400a9e51013812bab8c898b",
  ),
});

const broadbandInputSchema = z.strictObject({
  feature: broadbandFeatureSchema,
  status: broadbandStatusSchema,
  underlyingReferencePeriod: z.string().regex(/^\d{4}$/).optional(),
});

function rejected<T>(reason: CityFixedAttemptRejectionReason): SloveniaCityParserOutcome<T> {
  return { kind: "rejected", reason };
}

export function parseSloveniaCatalogFeasibility(
  value: unknown,
): SloveniaCityParserOutcome<SloveniaCatalogFeasibilityObservation> {
  if (!catalogProjectionSchema.safeParse(value).success) return rejected("universe_incomplete");

  return {
    kind: "observation",
    value: {
      schemaVersion: "slovenia-city-catalog-feasibility@1",
      consideredUniverseRows: 104,
      comparablePopulationRows: 104,
      catalogArtifactVersion: null,
      registryCoordinatesSealed: false,
      installable: false,
    },
  };
}

export function parseSloveniaRentMechanics(
  value: unknown,
): SloveniaCityParserOutcome<SloveniaRentMechanicsObservation> {
  const parsed = rentAggregateSchema.safeParse(value);
  if (!parsed.success) return rejected("definition_noncomparable");

  return {
    kind: "observation",
    value: {
      schemaVersion: "slovenia-city-rent-mechanics@1",
      municipalityCode: parsed.data.municipalityCode,
      referencePeriod: parsed.data.referencePeriod,
      unit: parsed.data.unit,
      denominator: parsed.data.denominator,
      qualifyingCount: parsed.data.qualifyingCount,
      median: String(parsed.data.median),
      fixtureClass: "redacted-derived",
      productionClaimAuthorized: false,
    },
  };
}

export function parseSloveniaTransitUniverse(
  value: unknown,
): SloveniaCityParserOutcome<SloveniaTransitUniverseObservation> {
  if (!transitProjectionSchema.safeParse(value).success) return rejected("source_drift");
  return rejected("universe_incomplete");
}

export function parseSloveniaBroadbandFeasibility(
  value: unknown,
): SloveniaCityParserOutcome<SloveniaBroadbandFeasibilityObservation> {
  const parsed = broadbandInputSchema.safeParse(value);
  if (!parsed.success) return rejected("source_drift");
  return rejected(parsed.data.underlyingReferencePeriod === undefined
    ? "reference_period_unproved"
    : "license_unproved");
}
