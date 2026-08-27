import { createHash } from "node:crypto";

import { z } from "zod";

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
