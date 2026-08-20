import type { CanonicalDay, CanonicalDecimal, IsoCountryCode, IsoCurrencyCode } from "./onboarding-catalog";

const CANONICAL_DECIMAL = /^(?:0(?:\.[0-9]+)?|[1-9][0-9]*(?:\.[0-9]+)?)$/;
const ISO_COUNTRY_CODE = /^[A-Z]{2}$/;
const ISO_CURRENCY_CODE = /^[A-Z]{3}$/;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isCanonicalDecimal(value: unknown): value is CanonicalDecimal {
  return typeof value === "string" && CANONICAL_DECIMAL.test(value);
}

export function isIsoCountryCode(value: unknown): value is IsoCountryCode {
  return typeof value === "string" && ISO_COUNTRY_CODE.test(value);
}

export function isIsoCurrencyCode(value: unknown): value is IsoCurrencyCode {
  return typeof value === "string" && ISO_CURRENCY_CODE.test(value);
}

export function isCanonicalDay(value: unknown): value is CanonicalDay {
  if (typeof value !== "string") {
    return false;
  }

  const match = ISO_DAY.exec(value);
  if (match === null) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}
