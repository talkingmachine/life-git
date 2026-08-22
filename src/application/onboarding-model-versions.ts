import { types } from "node:util";

export interface OnboardingModelVersionsV1 {
  readonly invocation: "codex-cli-invocation@1";
  readonly cliVersion: "codex-cli 0.148.0-alpha.15";
  readonly extractionPrompt: "onboarding-extract@1";
  readonly reviewPrompt: "onboarding-review@1";
  readonly extractionSchema: "onboarding-model-output@1";
  readonly reviewSchema: "onboarding-review-output@1";
}

export interface OnboardingModelVersionsV2 {
  readonly invocation: "codex-cli-invocation@1";
  readonly cliVersion: "codex-cli 0.148.0-alpha.15";
  readonly extractionPrompt: "onboarding-extract@2";
  readonly reviewPrompt: "onboarding-review@1";
  readonly extractionSchema: "onboarding-extraction-wire@2";
  readonly reviewSchema: "onboarding-review-output@1";
}

export type OnboardingModelVersions =
  | OnboardingModelVersionsV1
  | OnboardingModelVersionsV2;

export const ONBOARDING_MODEL_VERSIONS_V1 = Object.freeze({
  invocation: "codex-cli-invocation@1",
  cliVersion: "codex-cli 0.148.0-alpha.15",
  extractionPrompt: "onboarding-extract@1",
  reviewPrompt: "onboarding-review@1",
  extractionSchema: "onboarding-model-output@1",
  reviewSchema: "onboarding-review-output@1",
} as const satisfies OnboardingModelVersionsV1);

export const ONBOARDING_MODEL_VERSIONS_V2 = Object.freeze({
  invocation: "codex-cli-invocation@1",
  cliVersion: "codex-cli 0.148.0-alpha.15",
  extractionPrompt: "onboarding-extract@2",
  reviewPrompt: "onboarding-review@1",
  extractionSchema: "onboarding-extraction-wire@2",
  reviewSchema: "onboarding-review-output@1",
} as const satisfies OnboardingModelVersionsV2);

const VERSION_KEYS = Object.freeze([
  "invocation",
  "cliVersion",
  "extractionPrompt",
  "reviewPrompt",
  "extractionSchema",
  "reviewSchema",
] as const);

export function reconstructOnboardingModelVersions(value: unknown): OnboardingModelVersions {
  const versions = readExactVersionTuple(value);
  if (matchesTuple(versions, ONBOARDING_MODEL_VERSIONS_V1)) {
    return ONBOARDING_MODEL_VERSIONS_V1;
  }
  if (matchesTuple(versions, ONBOARDING_MODEL_VERSIONS_V2)) {
    return ONBOARDING_MODEL_VERSIONS_V2;
  }
  throw invalidVersions();
}

function readExactVersionTuple(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) {
    throw invalidVersions();
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw invalidVersions();

  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== VERSION_KEYS.length) throw invalidVersions();

  const tuple = Object.create(null) as Record<string, unknown>;
  for (const key of VERSION_KEYS) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || descriptor.enumerable !== true || !("value" in descriptor)) {
      throw invalidVersions();
    }
    tuple[key] = descriptor.value;
  }
  return tuple;
}

function matchesTuple(
  actual: Readonly<Record<string, unknown>>,
  expected: OnboardingModelVersions,
): boolean {
  return VERSION_KEYS.every((key) => actual[key] === expected[key]);
}

function invalidVersions(): TypeError {
  return new TypeError("Invalid onboarding model versions");
}
