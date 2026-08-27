import type { CountryRef } from "./cold-start-contracts";

export const SI_AUTHORITY_ROOTS = Object.freeze([
  "https://www.gov.si",
  "https://pisrs.si",
  "https://pxweb.stat.si",
  "https://www.ess.gov.si",
] as const);

export const REQUIRED_CLAIM_KINDS = Object.freeze([
  "route_basis",
  "citizenship_applicability",
  "remote_work_relations",
  "income",
  "qualification",
  "companion_entry",
  "companion_local_work_access",
  "duration",
  "general_statutory_prerequisites",
] as const);

export type ResolveCountryResult =
  | {
      readonly ok: true;
      readonly country: CountryRef;
      readonly authorityRoots: typeof SI_AUTHORITY_ROOTS;
    }
  | { readonly ok: false; readonly kind: "unsupported_country" };

const SI_COUNTRY: CountryRef = Object.freeze({
  code: "SI",
  englishName: "Slovenia",
  displayName: "Словения",
  flag: "🇸🇮",
  coordinate: Object.freeze({ lat: 46.1512, lng: 14.9955 }),
});

const SI_RESULT: ResolveCountryResult = Object.freeze({
  ok: true,
  country: SI_COUNTRY,
  authorityRoots: SI_AUTHORITY_ROOTS,
});

const UNSUPPORTED_RESULT: ResolveCountryResult = Object.freeze({
  ok: false,
  kind: "unsupported_country",
});

const SI_ALIASES = new Set(["si", "slovenia", "словения"]);

export function resolveCountry(input: string): ResolveCountryResult {
  return SI_ALIASES.has(input.trim().toLowerCase()) ? SI_RESULT : UNSUPPORTED_RESULT;
}
