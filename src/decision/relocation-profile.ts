import { createHash } from "node:crypto";

import Decimal from "decimal.js";
import { z } from "zod";

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
