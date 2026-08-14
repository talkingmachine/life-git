import DecimalJs from "decimal.js";

const Decimal = DecimalJs.clone({ precision: 40, rounding: DecimalJs.ROUND_HALF_EVEN });

export function canonicalDecimal(value: unknown): string {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    throw new Error("invalid_decimal");
  }
  const decimal = new Decimal(value);
  if (!decimal.isFinite() || decimal.isNegative()) throw new Error("invalid_decimal");
  return decimal.toFixed().replace(/(?:\.0+|(?<=\.\d*?)0+)$/, "") || "0";
}

export function linearAtMostFactor(actual: DecimalJs.Value, target: DecimalJs.Value, boundary: DecimalJs.Value): string {
  const actualValue = new Decimal(actual);
  const targetValue = new Decimal(target);
  const boundaryValue = new Decimal(boundary);
  if (actualValue.lessThanOrEqualTo(targetValue)) return "1";
  if (actualValue.greaterThanOrEqualTo(boundaryValue)) return "0";
  return canonicalDecimal(boundaryValue.minus(actualValue).div(boundaryValue.minus(targetValue))
    .toDecimalPlaces(18, Decimal.ROUND_HALF_EVEN).toFixed());
}

export function linearAtLeastFactor(actual: DecimalJs.Value, target: DecimalJs.Value, zeroBoundary: DecimalJs.Value): string {
  const actualValue = new Decimal(actual);
  const targetValue = new Decimal(target);
  const zeroValue = new Decimal(zeroBoundary);
  if (actualValue.greaterThanOrEqualTo(targetValue)) return "1";
  if (actualValue.lessThanOrEqualTo(zeroValue)) return "0";
  return canonicalDecimal(actualValue.minus(zeroValue).div(targetValue.minus(zeroValue))
    .toDecimalPlaces(18, Decimal.ROUND_HALF_EVEN).toFixed());
}
