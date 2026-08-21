import { createHash } from "node:crypto";

import Decimal from "decimal.js";
import { z } from "zod";

import type {
  CurrentLocationValue,
  CurrentWorkValue,
  EducationValue,
  IsoCountryCode,
  MonthlyIncomeValue,
  MoveHorizonValue,
  MovingPartyValue,
  ParticipantRelationship,
  PassportValue,
  RemoteContinuationValue,
  SavingsValue,
} from "./onboarding-catalog";
import {
  isCanonicalDay,
  isCanonicalDecimal,
  isIsoCountryCode,
  isIsoCurrencyCode,
} from "./iso-codes";

export interface RelocationProfileDraft {
  readonly currentCountryCode: "RU";
  readonly citizenships: readonly ["RU"];
  readonly monthlyIncome: {
    readonly amount: string;
    readonly currency: "RUB";
    readonly basis: "net" | "gross" | "unknown";
  };
  readonly remoteWork: {
    readonly relation: "foreign_employment" | "foreign_service" | "unknown";
    readonly legallyAllowed: true | false | "unknown";
  };
  readonly education: "none" | "higher" | "unknown";
  readonly relevantExperienceYears: number | "unknown";
  readonly passportValidUntil: string | "unknown";
  readonly healthInsurance: "confirmed" | "not_confirmed" | "unknown";
  readonly companions: readonly {
    readonly relationship: "spouse" | "minor_child" | "other_family";
  }[];
}

export interface RelocationProfileSnapshot {
  readonly schemaVersion: "relocation-profile@1";
  readonly id: string;
  readonly confirmedAt: string;
  readonly profile: RelocationProfileDraft;
}

export type ParticipantId = string;

export type ApplicableValue<T> =
  | { readonly applicability: "required"; readonly value: T }
  | { readonly applicability: "not_applicable" };

export interface RelocationParticipantV2 {
  readonly participantId: ParticipantId;
  readonly relationship: ParticipantRelationship;
  readonly citizenships: readonly IsoCountryCode[];
  readonly passport: PassportValue;
  readonly currentWork: ApplicableValue<CurrentWorkValue>;
  readonly remoteContinuation: ApplicableValue<RemoteContinuationValue>;
  readonly monthlyIncome: ApplicableValue<MonthlyIncomeValue>;
  readonly education: ApplicableValue<EducationValue>;
  readonly relevantExperienceYears: ApplicableValue<number>;
}

export interface RelocationProfileV2Snapshot {
  readonly schemaVersion: "relocation-profile@2";
  readonly id: string;
  readonly confirmedAt: string;
  readonly profile: {
    readonly currentLocation: CurrentLocationValue;
    readonly moveHorizon: MoveHorizonValue;
    readonly movingParty: MovingPartyValue;
    readonly participants: readonly [RelocationParticipantV2, ...RelocationParticipantV2[]];
    readonly savings: SavingsValue;
  };
}

export type RelocationProfileV2Value = Omit<
  RelocationProfileV2Snapshot,
  "id" | "confirmedAt"
>;

const MAXIMUM_AMOUNT = new Decimal("1000000000");
const DECIMAL_TEXT = /^\d+(?:\.\d{1,2})?$/;
const DATE_TEXT = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const RELATIONSHIP_ORDER = {
  spouse: 0,
  minor_child: 1,
  other_family: 2,
} as const;

const canonicalDateSchema = z.union([
  z.literal("unknown"),
  z.string().regex(DATE_TEXT).refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
  }),
]);

const relocationProfileSchema = z.object({
  currentCountryCode: z.literal("RU"),
  citizenships: z.tuple([z.literal("RU")]),
  monthlyIncome: z.object({
    amount: z.string().regex(DECIMAL_TEXT),
    currency: z.literal("RUB"),
    basis: z.enum(["net", "gross", "unknown"]),
  }).strict(),
  remoteWork: z.object({
    relation: z.enum(["foreign_employment", "foreign_service", "unknown"]),
    legallyAllowed: z.union([z.boolean(), z.literal("unknown")]),
  }).strict(),
  education: z.enum(["none", "higher", "unknown"]),
  relevantExperienceYears: z.union([
    z.number().finite().int().nonnegative(),
    z.literal("unknown"),
  ]),
  passportValidUntil: canonicalDateSchema,
  healthInsurance: z.enum(["confirmed", "not_confirmed", "unknown"]),
  companions: z.array(z.object({
    relationship: z.enum(["spouse", "minor_child", "other_family"]),
  }).strict()),
}).strict();

function canonicalAmount(value: string): string {
  const amount = new Decimal(value);
  if (!amount.isFinite() || amount.isNegative() || amount.greaterThanOrEqualTo(MAXIMUM_AMOUNT)) {
    throw new Error("invalid_monthly_income");
  }
  return amount.toFixed();
}

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

export function confirmRelocationProfile(
  draft: unknown,
  clock: () => Date,
): RelocationProfileSnapshot {
  const parsed = relocationProfileSchema.parse(draft);
  const profile: RelocationProfileDraft = {
    currentCountryCode: "RU",
    citizenships: ["RU"],
    monthlyIncome: {
      amount: canonicalAmount(parsed.monthlyIncome.amount),
      currency: "RUB",
      basis: parsed.monthlyIncome.basis,
    },
    remoteWork: {
      relation: parsed.remoteWork.relation,
      legallyAllowed: parsed.remoteWork.legallyAllowed,
    },
    education: parsed.education,
    relevantExperienceYears: parsed.relevantExperienceYears,
    passportValidUntil: parsed.passportValidUntil,
    healthInsurance: parsed.healthInsurance,
    companions: parsed.companions
      .map(({ relationship }) => ({ relationship }))
      .sort((left, right) =>
        RELATIONSHIP_ORDER[left.relationship] - RELATIONSHIP_ORDER[right.relationship]
      ),
  };
  const confirmedAt = clock().toISOString();
  const payload = { schemaVersion: "relocation-profile@1" as const, confirmedAt, profile };
  return deepFreeze({
    ...payload,
    id: createHash("sha256").update(canonicalJson(payload)).digest("hex"),
  });
}

const V2_MAXIMUM_ARRAY_LENGTH = 100;
const V2_MAXIMUM_PARTICIPANTS = 20;
const V2_MAXIMUM_TEXT_LENGTH = 1_000;
const LOWERCASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const V2_UNKNOWN_TEXT = new Set(["не знаю", "неизвестно", "unknown", "n/a", "na", "-"]);

const v2BoundedTextSchema = z.string().min(1).max(V2_MAXIMUM_TEXT_LENGTH).refine((value) => {
  const normalized = value.trim().toLocaleLowerCase("ru-RU");
  return normalized.length > 0 && !V2_UNKNOWN_TEXT.has(normalized);
});
const v2CanonicalDecimalSchema = z.string().refine(isCanonicalDecimal);
const v2CountryCodeSchema = z.string().refine(isIsoCountryCode);
const v2CurrencyCodeSchema = z.string().refine(isIsoCurrencyCode);
const v2PassportSchema = z.union([
  z.literal("absent"),
  z.object({ validUntil: z.string().refine(isCanonicalDay) }).strict(),
]);
const v2CurrentWorkSchema = z.object({
  status: z.enum(["not_working", "employment", "self_employment", "contract_service", "other"]),
  occupation: v2BoundedTextSchema.optional(),
}).strict();
const v2MonthlyIncomeSchema = z.object({
  amount: v2CanonicalDecimalSchema,
  currency: v2CurrencyCodeSchema,
  basis: z.enum(["net", "gross"]),
}).strict();
const v2EducationSchema = z.object({
  level: z.enum(["none", "secondary", "vocational", "higher"]),
  field: v2BoundedTextSchema.optional(),
}).strict().superRefine((education, context) => {
  if (education.level === "none" && education.field !== undefined) {
    context.addIssue({ code: "custom", message: "field is not applicable", path: ["field"] });
  }
});
const v2SavingsSchema = z.object({
  min: v2CanonicalDecimalSchema,
  max: v2CanonicalDecimalSchema,
  currency: v2CurrencyCodeSchema,
}).strict().superRefine((savings, context) => {
  if (new Decimal(savings.min).greaterThan(savings.max)) {
    context.addIssue({ code: "custom", message: "invalid savings range", path: ["max"] });
  }
});

function v2ApplicableSchema<T extends z.ZodType>(valueSchema: T) {
  return z.union([
    z.object({ applicability: z.literal("required"), value: valueSchema }).strict(),
    z.object({ applicability: z.literal("not_applicable") }).strict(),
  ]);
}

const v2ParticipantSchema = z.object({
  participantId: z.string().regex(LOWERCASE_UUID),
  relationship: z.enum(["self", "spouse", "minor_child", "other_family"]),
  citizenships: z.array(v2CountryCodeSchema).min(1).max(V2_MAXIMUM_ARRAY_LENGTH)
    .refine((values) => new Set(values).size === values.length),
  passport: v2PassportSchema,
  currentWork: v2ApplicableSchema(v2CurrentWorkSchema),
  remoteContinuation: v2ApplicableSchema(z.enum(["yes", "no"])),
  monthlyIncome: v2ApplicableSchema(v2MonthlyIncomeSchema),
  education: v2ApplicableSchema(v2EducationSchema),
  relevantExperienceYears: v2ApplicableSchema(z.number().int().nonnegative().safe()),
}).strict();

const v2ProfileSchema = z.object({
  currentLocation: z.object({
    countryCode: v2CountryCodeSchema,
    city: v2BoundedTextSchema,
  }).strict(),
  moveHorizon: z.enum([
    "within_3_months",
    "3_to_6_months",
    "6_to_12_months",
    "more_than_12_months",
  ]),
  movingParty: z.enum(["alone", "with_companions"]),
  participants: z.tuple([v2ParticipantSchema], v2ParticipantSchema),
  savings: v2SavingsSchema,
}).strict().superRefine(validateV2ProfileSemantics);

const relocationProfileV2ValueSchema = z.object({
  schemaVersion: z.literal("relocation-profile@2"),
  profile: v2ProfileSchema,
}).strict();

const relocationProfileV2SnapshotSchema = z.object({
  schemaVersion: z.literal("relocation-profile@2"),
  id: z.string().regex(SHA256),
  confirmedAt: z.string().refine(isCanonicalInstant),
  profile: v2ProfileSchema,
}).strict();

export function materializeRelocationProfileV2(input: {
  readonly confirmedAt: string;
  readonly profile: RelocationProfileV2Value;
}): RelocationProfileV2Snapshot {
  const confirmedAt = parseCanonicalInstant(input.confirmedAt);
  const profile = parseRelocationProfileV2Value(input.profile);
  const payload = { ...profile, confirmedAt };

  return deepFreeze({
    ...payload,
    id: createHash("sha256").update(canonicalJson(payload)).digest("hex"),
  }) as RelocationProfileV2Snapshot;
}

export function reconstructRelocationProfileV2(value: unknown): RelocationProfileV2Snapshot {
  const snapshot = parseRelocationProfileV2Snapshot(value);
  const payload = {
    schemaVersion: snapshot.schemaVersion,
    confirmedAt: snapshot.confirmedAt,
    profile: snapshot.profile,
  };
  const expectedId = createHash("sha256").update(canonicalJson(payload)).digest("hex");
  if (snapshot.id !== expectedId) throw invalidRelocationProfileV2();

  return deepFreeze(snapshot) as RelocationProfileV2Snapshot;
}

function validateV2ProfileSemantics(
  profile: RelocationProfileV2Snapshot["profile"],
  context: z.RefinementCtx,
): void {
  const participants = profile.participants;
  if (participants.length > V2_MAXIMUM_PARTICIPANTS) {
    context.addIssue({ code: "custom", message: "too many participants", path: ["participants"] });
  }
  const participantIds = participants.map(({ participantId }) => participantId);
  if (participants[0].relationship !== "self" ||
    participants.slice(1).some(({ relationship }) => relationship === "self")) {
    context.addIssue({ code: "custom", message: "invalid participant order", path: ["participants"] });
  }
  if (new Set(participantIds).size !== participantIds.length) {
    context.addIssue({ code: "custom", message: "duplicate participant", path: ["participants"] });
  }
  if ((profile.movingParty === "alone" && participants.length !== 1) ||
    (profile.movingParty === "with_companions" && participants.length < 2)) {
    context.addIssue({ code: "custom", message: "moving party mismatch", path: ["participants"] });
  }

  participants.forEach((participant, index) => {
    const isAdult = participant.relationship !== "minor_child";
    requireApplicability(participant.currentWork, isAdult, context, index, "currentWork");
    requireApplicability(participant.monthlyIncome, isAdult, context, index, "monthlyIncome");
    requireApplicability(participant.education, isAdult, context, index, "education");
    requireApplicability(
      participant.relevantExperienceYears,
      isAdult,
      context,
      index,
      "relevantExperienceYears",
    );
    const requiresRemoteContinuation = isAdult &&
      participant.currentWork.applicability === "required" &&
      participant.currentWork.value.status !== "not_working";
    requireApplicability(
      participant.remoteContinuation,
      requiresRemoteContinuation,
      context,
      index,
      "remoteContinuation",
    );
  });
}

function parseRelocationProfileV2Value(value: unknown): RelocationProfileV2Value {
  try {
    return relocationProfileV2ValueSchema.parse(
      descriptorSafeCopy(value),
    ) as RelocationProfileV2Value;
  } catch {
    throw invalidRelocationProfileV2();
  }
}

function parseRelocationProfileV2Snapshot(value: unknown): RelocationProfileV2Snapshot {
  try {
    return relocationProfileV2SnapshotSchema.parse(
      descriptorSafeCopy(value),
    ) as RelocationProfileV2Snapshot;
  } catch {
    throw invalidRelocationProfileV2();
  }
}

function requireApplicability(
  value: { readonly applicability: "required" | "not_applicable" },
  isRequired: boolean,
  context: z.RefinementCtx,
  participantIndex: number,
  field: string,
): void {
  if ((value.applicability === "required") !== isRequired) {
    context.addIssue({
      code: "custom",
      message: "invalid applicability",
      path: ["participants", participantIndex, field],
    });
  }
}

function parseCanonicalInstant(value: unknown): string {
  if (!isCanonicalInstant(value)) throw invalidRelocationProfileV2();
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
      throw invalidRelocationProfileV2();
    }
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) throw invalidRelocationProfileV2();
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      if (lengthDescriptor === undefined || !("value" in lengthDescriptor) ||
        !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) {
        throw invalidRelocationProfileV2();
      }
      const length = lengthDescriptor.value as number;
      if (Object.getOwnPropertyNames(value).length !== length + 1) {
        throw invalidRelocationProfileV2();
      }
      active.add(value);
      try {
        return Array.from({ length }, (_, index) => {
          const descriptor = descriptors[String(index)];
          if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
            throw invalidRelocationProfileV2();
          }
          return copy(descriptor.value);
        });
      } finally {
        active.delete(value);
      }
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw invalidRelocationProfileV2();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    active.add(value);
    try {
      return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => {
        if (!("value" in descriptor) || !descriptor.enumerable) throw invalidRelocationProfileV2();
        return [key, copy(descriptor.value)];
      }));
    } finally {
      active.delete(value);
    }
  };

  return copy(borrowed) as T;
}

function invalidRelocationProfileV2(): TypeError {
  return new TypeError("Invalid relocation-profile@2");
}
