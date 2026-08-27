import type { PlaceCriterionId } from "../decision/preference-profile";

export interface InstalledPlacePackage {
  readonly countryCode: string;
  readonly label: string;
  readonly flag: string;
  readonly coordinate: { readonly lat: number; readonly lng: number };
  readonly supportedCriteria: readonly PlaceCriterionId[];
  readonly routeCatalog: {
    readonly revisionId: string;
    readonly routeIds: readonly string[];
    readonly completeness: "unproven";
  };
}

export interface InstalledPlacePackagePort {
  list(): readonly InstalledPlacePackage[];
}
