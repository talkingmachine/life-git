import { createHash } from "node:crypto";

import Decimal from "decimal.js";
import { z } from "zod";

import type { Profile, ProfileSnapshot } from "../research/contracts";

const maximumAmount = new Decimal("1000000000");
const decimalText = /^\d+(?:\.\d{1,2})?$/;

const profileDraftSchema = z
  .object({
    currency: z.literal("ALL"),
    availableResourcesAll: z.string().regex(decimalText),
    futureIncomeAll: z.string().regex(decimalText),
    incomeBasis: z.enum(["foreign_contract", "albanian_employer_only"]),
    companionBasis: z.enum(["none", "family", "independent", "unknown"]),
    relationship: z.enum(["none", "spouse", "non_family", "other_family"]),
  })
  .strict()
  .superRefine((draft, context) => {
    if (draft.companionBasis === "none" && draft.relationship !== "none") {
      context.addIssue({ code: "custom", message: "A profile without a companion cannot include a relationship." });
    }
    if (draft.companionBasis !== "family" && draft.relationship !== "none") {
      context.addIssue({ code: "custom", message: "Only a family basis can include a relationship." });
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
    currency: parsed.currency,
    availableResourcesAll: normalizeAmount(parsed.availableResourcesAll),
    futureIncomeAll: normalizeAmount(parsed.futureIncomeAll),
    incomeBasis: parsed.incomeBasis,
    companionBasis: parsed.companionBasis,
    relationship: parsed.relationship,
  });
  const confirmedAt = clock().toISOString();
  const id = createHash("sha256")
    .update(JSON.stringify({ confirmedAt, profile }))
    .digest("hex");

  return Object.freeze({ id, confirmedAt, profile });
}
