import type { PlaceFrontierApplicationPorts } from "../application/place-frontier";

export type SharedProfileCompositionPort = PlaceFrontierApplicationPorts["profiles"];

export const SHARED_PROFILE_COMPOSITION_PORT: unique symbol = Symbol(
  "confirmed-life.shared-profile-composition-port",
);

type SharedProfileCompositionOptions = Readonly<{
  [SHARED_PROFILE_COMPOSITION_PORT]?: SharedProfileCompositionPort;
}>;

export function sharedProfileCompositionPort(
  options: object,
): SharedProfileCompositionPort | undefined {
  return (options as SharedProfileCompositionOptions)[SHARED_PROFILE_COMPOSITION_PORT];
}

export function withSharedProfileCompositionPort<T extends object>(
  options: T,
  profiles: SharedProfileCompositionPort,
): T & SharedProfileCompositionOptions {
  return {
    ...options,
    [SHARED_PROFILE_COMPOSITION_PORT]: profiles,
  };
}
