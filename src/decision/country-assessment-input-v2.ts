import {
  reconstructRelocationProfileV2,
  type RelocationProfileV2Snapshot,
} from "./relocation-profile";

export interface CountryAssessmentInputV2 {
  readonly schemaVersion: "country-assessment-input@2";
  readonly profileSnapshotId: string;
  readonly profile: RelocationProfileV2Snapshot;
}

export function projectCountryAssessmentInputV2(
  profile: RelocationProfileV2Snapshot,
): CountryAssessmentInputV2 {
  const reconstructed = reconstructRelocationProfileV2(profile);
  return deepFreeze({
    schemaVersion: "country-assessment-input@2" as const,
    profileSnapshotId: reconstructed.id,
    profile: reconstructed,
  });
}

export function reconstructCountryAssessmentInputV2(
  value: unknown,
): CountryAssessmentInputV2 {
  const input = exactRecord(value, ["schemaVersion", "profileSnapshotId", "profile"]);
  if (input.schemaVersion !== "country-assessment-input@2") throw invalidInput();
  if (typeof input.profileSnapshotId !== "string") throw invalidInput();

  let profile: RelocationProfileV2Snapshot;
  try {
    profile = reconstructRelocationProfileV2(input.profile);
  } catch {
    throw invalidInput();
  }
  if (input.profileSnapshotId !== profile.id) throw invalidInput();

  return deepFreeze({
    schemaVersion: "country-assessment-input@2" as const,
    profileSnapshotId: profile.id,
    profile,
  });
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) throw invalidInput();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Object.keys(descriptors).length !== keys.length ||
    !keys.every((key) => key in descriptors)
  ) throw invalidInput();

  const record: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      throw invalidInput();
    }
    record[key] = descriptor.value;
  }
  return record;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function invalidInput(): TypeError {
  return new TypeError("Invalid country-assessment-input@2");
}
