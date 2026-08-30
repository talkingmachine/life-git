import { createHash } from "node:crypto";

/**
 * Pre-authorized capture routes for the M8C.2 staging checkpoint only. They
 * are neither an installed authority directory nor a policy lock.
 */
const ROUTES = Object.freeze([
  Object.freeze({
    jobId: "ljubljana_safety",
    publisherId: "si-police",
    routeId: "police-pu-ljubljana-stats",
    sourceId: "si-demo-police-ljubljana" as const,
    role: "pu-ljubljana-statistics",
    url: "https://www.policija.si/o-slovenski-policiji/organiziranost/policijske-uprave/pu-ljubljana/statistika-pu-lj",
    allowedHosts: Object.freeze(["www.policija.si"]),
    allowedMediaTypes: Object.freeze(["text/html"]),
    maxBytes: 2 * 1024 * 1024,
    maxRedirects: 2,
    timeoutMs: 15_000,
  }),
  Object.freeze({
    jobId: "ljubljana_population",
    publisherId: "si-surs",
    routeId: "surs-ljubljana-municipality",
    sourceId: "si-demo-surs-ljubljana" as const,
    role: "ljubljana-municipality",
    url: "https://www.stat.si/obcine/en/Municip/GroupedAll/82",
    allowedHosts: Object.freeze(["www.stat.si"]),
    allowedMediaTypes: Object.freeze(["text/html"]),
    maxBytes: 2 * 1024 * 1024,
    maxRedirects: 2,
    timeoutMs: 15_000,
  }),
  Object.freeze({
    jobId: "ljubljana_identity_geometry",
    publisherId: "si-e-prostor",
    routeId: "eprostor-spatial-units-register",
    sourceId: "si-demo-e-prostor-ljubljana" as const,
    role: "register-prostorskih-enot",
    url: "https://www.e-prostor.gov.si/podrocja/prostorske-enote-in-naslovi/register-prostorskih-enot/",
    allowedHosts: Object.freeze(["www.e-prostor.gov.si"]),
    allowedMediaTypes: Object.freeze(["text/html"]),
    maxBytes: 2 * 1024 * 1024,
    maxRedirects: 2,
    timeoutMs: 15_000,
  }),
 ] as const);

/** Staging acquisition scope, deliberately not an installed authority directory. */
export const SLOVENIA_OFFICIAL_DIRECTORY_BOOTSTRAP = Object.freeze({
  schemaVersion: "si-demo-official-capture-bootstrap@1" as const,
  stagingOnly: true as const,
  policyLockWritten: false as const,
  routes: ROUTES,
});

export type SloveniaOfficialDirectoryBootstrapEntry = typeof ROUTES[number];

export function sloveniaBootstrapUrlSha256(entry: SloveniaOfficialDirectoryBootstrapEntry): string {
  return createHash("sha256").update(entry.url, "utf8").digest("hex");
}
