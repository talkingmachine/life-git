import Decimal from "decimal.js";
import { z } from "zod";

const maximumAmount = new Decimal("1000000000");
const decimalText = /^\d+(?:\.\d{1,2})?$/;

const housingInputSchema = z
  .object({
    currency: z.literal("ALL"),
    initialHousingAll: z.string().regex(decimalText),
  })
  .strict();

export type HousingInput = z.input<typeof housingInputSchema>;

export interface HousingDecision {
  readonly currency: "ALL";
  readonly initialHousingAll: string;
}

export function confirmHousingDecision(input: unknown): HousingDecision {
  const parsed = housingInputSchema.parse(input);
  const amount = new Decimal(parsed.initialHousingAll);
  if (amount.lessThanOrEqualTo(0) || amount.greaterThanOrEqualTo(maximumAmount)) {
    throw new Error("Initial housing must be between 0.01 and 999999999.99 ALL.");
  }

  return Object.freeze({
    currency: parsed.currency,
    initialHousingAll: amount.toFixed(),
  });
}
