import {
  createCountryResolutionApplication,
} from "../application/country-resolution";
import {
  sharedProfileCompositionPort,
  withSharedProfileCompositionPort,
} from "./composition-dependencies";
import { createCountryVerifierAdapter } from "./country-verifier-adapter";
import { createEvidenceIntegrity } from "./integrity";
import {
  createPlaceFrontierComposition,
  type PlaceFrontierCompositionOptions,
} from "./place-frontier-composition";
import { SqliteCountryResolutionStore } from "./sqlite/country-resolution-store";
import { SqliteProfileStore } from "./sqlite/profile-store";

export type CountryResolutionCompositionOptions = PlaceFrontierCompositionOptions;

export function createCountryResolutionComposition(
  options: CountryResolutionCompositionOptions,
) {
  const profiles = sharedProfileCompositionPort(options) ??
    new SqliteProfileStore(options.database);
  const sharedOptions = withSharedProfileCompositionPort(
    options,
    profiles,
  );
  return createCountryResolutionApplication({
    frontier: createPlaceFrontierComposition(sharedOptions),
    store: new SqliteCountryResolutionStore(options.database, options.hmacKey),
    verifier: createCountryVerifierAdapter(sharedOptions),
    integrity: createEvidenceIntegrity(options.hmacKey),
    clock: options.clock ?? (() => new Date()),
  });
}
