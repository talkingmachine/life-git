import Decimal from "decimal.js";

export function canonicalDecimal(value: unknown): string {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    throw new Error("invalid_decimal");
  }
  const decimal = new Decimal(value);
  if (!decimal.isFinite() || decimal.isNegative()) throw new Error("invalid_decimal");
  return decimal.toFixed().replace(/(?:\.0+|(?<=\.\d*?)0+)$/, "") || "0";
}

export function linearAtMostFactor(actual: Decimal, target: Decimal, boundary: Decimal): string {
  if (actual.lessThanOrEqualTo(target)) return "1";
  if (actual.greaterThanOrEqualTo(boundary)) return "0";
  return canonicalDecimal(boundary.minus(actual).div(boundary.minus(target))
    .toDecimalPlaces(18, Decimal.ROUND_HALF_EVEN).toFixed());
}
