import type {
  InstalledPlacePackage,
  InstalledPlacePackagePort,
} from "../../research/place-package";

const INSTALLED_PACKAGES = Object.freeze([Object.freeze({
  countryCode: "SI",
  label: "Slovenia",
  flag: "🇸🇮",
  coordinate: Object.freeze({ lat: 46.1512, lng: 14.9955 }),
  supportedCriteria: Object.freeze([]),
  routeCatalog: Object.freeze({
    revisionId: "si-routes@1",
    routeIds: Object.freeze(["si-temporary-residence-digital-nomad"]),
    completeness: "unproven",
  }),
}) satisfies InstalledPlacePackage]);

export function createInstalledPlacePackages(): InstalledPlacePackagePort {
  return Object.freeze({
    list(): readonly InstalledPlacePackage[] {
      return INSTALLED_PACKAGES;
    },
  });
}
