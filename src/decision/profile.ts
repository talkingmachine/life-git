import { createHash } from "node:crypto";

import Decimal from "decimal.js";
import { z } from "zod";

import type { Profile, ProfileSnapshot } from "../research/contracts";

const maximumAmount = new Decimal("1000000000");
const decimalText = /^\d+(?:\.\d{1,2})?$/;

const profileDraftSchema = z
  .object({
    availableResourcesAll: z.string().regex(decimalText),
    monthlyIncome: z.object({
      amount: z.string().regex(decimalText),
      currency: z.literal("RUB"),
    }).strict(),
    incomeBasis: z.enum(["foreign_contract", "albanian_employer_only"]),
    companionBasis: z.enum(["none", "family", "independent", "unknown"]),
    relationship: z.enum(["none", "spouse", "non_family", "other_family"]),
    conditions: z.object({
      incomeContinues12Months: z.boolean(),
      lawfulStayPrerequisiteAccepted: z.boolean(),
      stagedSpouseRouteAccepted: z.boolean(),
    }).strict(),
  })
  .strict()
  .superRefine((draft, context) => {
    if (draft.companionBasis === "none" && draft.relationship !== "none") {
      context.addIssue({ code: "custom", message: "A profile without a companion cannot include a relationship." });
    }
    if (draft.companionBasis !== "family" && draft.relationship !== "none") {
      context.addIssue({ code: "custom", message: "Only a family basis can include a relationship." });
    }
    if (
      draft.conditions.stagedSpouseRouteAccepted &&
      (draft.companionBasis !== "family" || draft.relationship !== "spouse")
    ) {
      context.addIssue({
        code: "custom",
        message: "Only a spouse family route can accept the staged spouse condition.",
      });
    }
  });

export type ProfileDraft = z.input<typeof profileDraftSchema>;

function normalizeAmount(value: string): string {
  const amount = new Decimal(value);
  if (amount.isNegative() || amount.greaterThanOrEqualTo(maximumAmount)) {
    throw new Error("ALL amount must be between 0 and 999999999.99.");
  }
  return amount.toFixed();
}

export function confirmProfile(draft: unknown, clock: () => Date): ProfileSnapshot {
  const parsed = profileDraftSchema.parse(draft);
  const profile: Profile = Object.freeze({
    availableResourcesAll: normalizeAmount(parsed.availableResourcesAll),
    monthlyIncome: Object.freeze({
      amount: normalizeAmount(parsed.monthlyIncome.amount),
      currency: parsed.monthlyIncome.currency,
    }),
    incomeBasis: parsed.incomeBasis,
    companionBasis: parsed.companionBasis,
    relationship: parsed.relationship,
    conditions: Object.freeze({ ...parsed.conditions }),
  });
  const confirmedAt = clock().toISOString();
  const id = createHash("sha256")
    .update(JSON.stringify({ confirmedAt, profile }))
    .digest("hex");

  return Object.freeze({ id, confirmedAt, profile });
}
