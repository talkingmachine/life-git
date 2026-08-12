import {
  createCountryResolutionApplication,
} from "../application/country-resolution";
import { createCountryVerifierAdapter } from "./country-verifier-adapter";
import { createEvidenceIntegrity } from "./integrity";
import {
  createPlaceFrontierComposition,
  type PlaceFrontierCompositionOptions,
} from "./place-frontier-composition";
import { SqliteCountryResolutionStore } from "./sqlite/country-resolution-store";

export type CountryResolutionCompositionOptions = PlaceFrontierCompositionOptions;

export function createCountryResolutionComposition(
  options: CountryResolutionCompositionOptions,
) {
  return createCountryResolutionApplication({
    frontier: createPlaceFrontierComposition(options),
    store: new SqliteCountryResolutionStore(options.database, options.hmacKey),
    verifier: createCountryVerifierAdapter(options),
    integrity: createEvidenceIntegrity(options.hmacKey),
    clock: options.clock ?? (() => new Date()),
  });
}
