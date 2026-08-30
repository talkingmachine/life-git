import { createHash } from "node:crypto";

const ROUTE = Object.freeze({
  routeId: "gov-municipalities" as const,
  sourceId: "si-demo-gov-municipalities" as const,
  publisherId: "si-gov" as const,
  role: "municipality-authority-directory" as const,
  url: "https://www.gov.si/podrocja/drzava-in-druzba/lokalna-samouprava-in-regionalni-razvoj/lokalna-samouprava/obcine/" as const,
  allowedHosts: Object.freeze(["www.gov.si"] as const),
  allowedMediaTypes: Object.freeze(["text/html"] as const),
  maxBytes: 2 * 1024 * 1024,
  maxRedirects: 2,
  timeoutMs: 15_000,
});

/** Acquisition-only policy; this does not install the municipality host. */
export const SLOVENIA_SAFETY_AUTHORITY_BOOTSTRAP = Object.freeze({
  schemaVersion: "si-demo-safety-authority-capture-bootstrap@1" as const,
  stagingOnly: true as const,
  policyLockWritten: false as const,
  route: ROUTE,
});

export type SloveniaSafetyAuthorityBootstrapRoute = typeof ROUTE;

export function sloveniaSafetyAuthorityBootstrapUrlSha256(): string {
  return createHash("sha256").update(ROUTE.url, "utf8").digest("hex");
}
