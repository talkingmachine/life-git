import { createHash } from "node:crypto";

import { z } from "zod";

import {
  CITY_PREFERENCE_IDS,
  COUNTRY_PREFERENCE_IDS,
  type CountryPreferenceId,
  type PreferenceImportance,
  type UniversalCityPreferenceId,
} from "./onboarding-catalog";

export type PlaceCriterionId =
  | "outside_cis"
  | "europe"
  | "personal_safety"
  | "infrastructure"
  | "peace_and_stability";
export type PreferenceMode = "required" | "weighted";
export type Importance = 1 | 2 | 3 | 4 | 5;

export interface PreferenceCriterion {
  readonly id: PlaceCriterionId;
  readonly mode: PreferenceMode;
  readonly importance: Importance;
  readonly target: "required_true" | "maximize";
}

export interface PreferenceProfileDraft {
  readonly criteria: readonly PreferenceCriterion[];
}

export interface PreferenceProfileSnapshot {
  readonly schemaVersion: "preference-profile@1";
  readonly id: string;
  readonly confirmedAt: string;
  readonly criteria: readonly PreferenceCriterion[];
}

export type CountryPreferenceCriterionV2<I extends CountryPreferenceId> =
  | {
      readonly id: I;
      readonly mode: "required";
      readonly importance: PreferenceImportance;
      readonly target: "required_true";
    }
  | {
      readonly id: I;
      readonly mode: "weighted";
      readonly importance: PreferenceImportance;
      readonly target: "maximize";
    };

export interface UniversalCityPreferenceCriterionV2<I extends UniversalCityPreferenceId> {
  readonly id: I;
  readonly mode: PreferenceMode;
  readonly importance: PreferenceImportance;
  readonly target: string;
}

export type CountryPreferenceTupleV2 = readonly [
  CountryPreferenceCriterionV2<"outside_cis">,
  CountryPreferenceCriterionV2<"europe">,
  CountryPreferenceCriterionV2<"personal_safety">,
  CountryPreferenceCriterionV2<"infrastructure">,
  CountryPreferenceCriterionV2<"peace_and_stability">,
];

export type UniversalCityPreferenceTupleV2 = readonly [
  UniversalCityPreferenceCriterionV2<"safety">,
  UniversalCityPreferenceCriterionV2<"long_term_rent">,
  UniversalCityPreferenceCriterionV2<"urban_transit">,
  UniversalCityPreferenceCriterionV2<"fixed_broadband">,
];

export interface PreferenceProfileV2Snapshot {
  readonly schemaVersion: "preference-profile@2";
  readonly id: string;
  readonly confirmedAt: string;
  readonly countryCriteria: CountryPreferenceTupleV2;
  readonly cityCriteria: UniversalCityPreferenceTupleV2;
}

export type PreferenceProfileV2Value = Omit<
  PreferenceProfileV2Snapshot,
  "id" | "confirmedAt"
>;

const CRITERION_ORDER = Object.freeze([
  "outside_cis",
  "europe",
  "personal_safety",
  "infrastructure",
  "peace_and_stability",
] as const satisfies readonly PlaceCriterionId[]);

const criterionPosition = new Map<PlaceCriterionId, number>(
  CRITERION_ORDER.map((criterionId, index) => [criterionId, index]),
);

const importanceSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

const criterionSchema = z.discriminatedUnion("mode", [
  z.object({
    id: z.enum(CRITERION_ORDER),
    mode: z.literal("required"),
    importance: importanceSchema,
    target: z.literal("required_true"),
  }).strict(),
  z.object({
    id: z.enum(CRITERION_ORDER),
    mode: z.literal("weighted"),
    importance: importanceSchema,
    target: z.literal("maximize"),
  }).strict(),
]);

const preferenceProfileSchema = z.object({
  criteria: z.array(criterionSchema).min(1).max(CRITERION_ORDER.length)
    .superRefine((criteria, context) => {
      const seen = new Set<PlaceCriterionId>();
      for (const [index, criterion] of criteria.entries()) {
        if (seen.has(criterion.id)) {
          context.addIssue({
            code: "custom",
            path: [index, "id"],
            message: "duplicate criterion",
          });
        }
        seen.add(criterion.id);
      }
    }),
}).strict();

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export function confirmPreferenceProfile(
  draft: unknown,
  clock: () => Date,
): PreferenceProfileSnapshot {
  const parsed = preferenceProfileSchema.parse(draft);
  const criteria = parsed.criteria
    .map((criterion) => ({ ...criterion }))
    .sort((left, right) =>
      criterionPosition.get(left.id)! - criterionPosition.get(right.id)!
    );
  const confirmedAt = clock().toISOString();
  const payload = {
    schemaVersion: "preference-profile@1" as const,
    confirmedAt,
    criteria,
  };

  return deepFreeze({
    ...payload,
    id: createHash("sha256").update(canonicalJson(payload)).digest("hex"),
  });
}

const V2_MAXIMUM_TEXT_LENGTH = 1_000;
const V2_SHA256 = /^[0-9a-f]{64}$/;
const V2_UNKNOWN_TEXT = new Set(["не знаю", "неизвестно", "unknown", "n/a", "na", "-"]);
const v2ImportanceSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);
const v2CityTargetSchema = z.string().min(1).max(V2_MAXIMUM_TEXT_LENGTH).refine((value) => {
  const normalized = value.trim().toLocaleLowerCase("ru-RU");
  return normalized.length > 0 && !V2_UNKNOWN_TEXT.has(normalized);
});

function v2CountryCriterionSchema<I extends CountryPreferenceId>(id: I) {
  return z.union([
    z.object({
      id: z.literal(id),
      mode: z.literal("required"),
      importance: v2ImportanceSchema,
      target: z.literal("required_true"),
    }).strict(),
    z.object({
      id: z.literal(id),
      mode: z.literal("weighted"),
      importance: v2ImportanceSchema,
      target: z.literal("maximize"),
    }).strict(),
  ]);
}

function v2CityCriterionSchema<I extends UniversalCityPreferenceId>(id: I) {
  return z.object({
    id: z.literal(id),
    mode: z.enum(["required", "weighted"]),
    importance: v2ImportanceSchema,
    target: v2CityTargetSchema,
  }).strict();
}

const v2CountryCriteriaSchema = z.tuple([
  v2CountryCriterionSchema(COUNTRY_PREFERENCE_IDS[0]),
  v2CountryCriterionSchema(COUNTRY_PREFERENCE_IDS[1]),
  v2CountryCriterionSchema(COUNTRY_PREFERENCE_IDS[2]),
  v2CountryCriterionSchema(COUNTRY_PREFERENCE_IDS[3]),
  v2CountryCriterionSchema(COUNTRY_PREFERENCE_IDS[4]),
]);
const v2CityCriteriaSchema = z.tuple([
  v2CityCriterionSchema(CITY_PREFERENCE_IDS[0]),
  v2CityCriterionSchema(CITY_PREFERENCE_IDS[1]),
  v2CityCriterionSchema(CITY_PREFERENCE_IDS[2]),
  v2CityCriterionSchema(CITY_PREFERENCE_IDS[3]),
]);
const preferenceProfileV2ValueSchema = z.object({
  schemaVersion: z.literal("preference-profile@2"),
  countryCriteria: v2CountryCriteriaSchema,
  cityCriteria: v2CityCriteriaSchema,
}).strict();
const preferenceProfileV2SnapshotSchema = z.object({
  schemaVersion: z.literal("preference-profile@2"),
  id: z.string().regex(V2_SHA256),
  confirmedAt: z.string().refine(isCanonicalInstant),
  countryCriteria: v2CountryCriteriaSchema,
  cityCriteria: v2CityCriteriaSchema,
}).strict();

export function materializePreferenceProfileV2(input: {
  readonly confirmedAt: string;
  readonly preferences: PreferenceProfileV2Value;
}): PreferenceProfileV2Snapshot {
  const confirmedAt = parseCanonicalInstant(input.confirmedAt);
  const preferences = parsePreferenceProfileV2Value(input.preferences);
  const payload = { ...preferences, confirmedAt };

  return deepFreeze({
    ...payload,
    id: createHash("sha256").update(canonicalJson(payload)).digest("hex"),
  }) as PreferenceProfileV2Snapshot;
}

export function reconstructPreferenceProfileV2(value: unknown): PreferenceProfileV2Snapshot {
  const snapshot = parsePreferenceProfileV2Snapshot(value);
  const payload = {
    schemaVersion: snapshot.schemaVersion,
    confirmedAt: snapshot.confirmedAt,
    countryCriteria: snapshot.countryCriteria,
    cityCriteria: snapshot.cityCriteria,
  };
  const expectedId = createHash("sha256").update(canonicalJson(payload)).digest("hex");
  if (snapshot.id !== expectedId) throw invalidPreferenceProfileV2();

  return deepFreeze(snapshot) as PreferenceProfileV2Snapshot;
}

function parsePreferenceProfileV2Value(value: unknown): PreferenceProfileV2Value {
  try {
    return preferenceProfileV2ValueSchema.parse(
      descriptorSafeCopy(value),
    ) as PreferenceProfileV2Value;
  } catch {
    throw invalidPreferenceProfileV2();
  }
}

function parsePreferenceProfileV2Snapshot(value: unknown): PreferenceProfileV2Snapshot {
  try {
    return preferenceProfileV2SnapshotSchema.parse(
      descriptorSafeCopy(value),
    ) as PreferenceProfileV2Snapshot;
  } catch {
    throw invalidPreferenceProfileV2();
  }
}

function parseCanonicalInstant(value: unknown): string {
  if (!isCanonicalInstant(value)) throw invalidPreferenceProfileV2();
  return value;
}

function isCanonicalInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function descriptorSafeCopy<T>(borrowed: T): T {
  const active = new Set<object>();

  const copy = (value: unknown): unknown => {
    if (value === null || typeof value !== "object") return value;
    if (active.has(value) || Object.getOwnPropertySymbols(value).length !== 0) {
      throw invalidPreferenceProfileV2();
    }
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) throw invalidPreferenceProfileV2();
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      if (lengthDescriptor === undefined || !("value" in lengthDescriptor) ||
        !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) {
        throw invalidPreferenceProfileV2();
      }
      const length = lengthDescriptor.value as number;
      if (Object.getOwnPropertyNames(value).length !== length + 1) {
        throw invalidPreferenceProfileV2();
      }
      active.add(value);
      try {
        return Array.from({ length }, (_, index) => {
          const descriptor = descriptors[String(index)];
          if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
            throw invalidPreferenceProfileV2();
          }
          return copy(descriptor.value);
        });
      } finally {
        active.delete(value);
      }
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw invalidPreferenceProfileV2();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    active.add(value);
    try {
      return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => {
        if (!("value" in descriptor) || !descriptor.enumerable) throw invalidPreferenceProfileV2();
        return [key, copy(descriptor.value)];
      }));
    } finally {
      active.delete(value);
    }
  };

  return copy(borrowed) as T;
}

function invalidPreferenceProfileV2(): TypeError {
  return new TypeError("Invalid preference-profile@2");
}
