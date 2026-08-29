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

export interface OnboardingModelVersionsV3 {
  readonly invocation: "codex-cli-invocation@1";
  readonly cliVersion: "codex-cli 0.148.0-alpha.15";
  readonly extractionPrompt: "onboarding-extract@3";
  readonly reviewPrompt: "onboarding-review@1";
  readonly extractionSchema: "onboarding-extraction-wire@2";
  readonly reviewSchema: "onboarding-review-output@1";
}

export interface OnboardingModelVersionsV4 {
  readonly invocation: "codex-cli-invocation@2";
  readonly cliVersion: "codex-cli-0.149.0-alpha.4-plus@1";
  readonly extractionPrompt: "onboarding-extract@4";
  readonly reviewPrompt: "onboarding-review@2";
  readonly extractionSchema: "onboarding-extraction-wire@2";
  readonly reviewSchema: "onboarding-review-output@1";
}

export interface OnboardingModelVersionsV5 {
  readonly invocation: "codex-cli-invocation@2";
  readonly cliVersion: "codex-cli-0.149.0-alpha.4-plus@1";
  readonly extractionPrompt: "onboarding-extract@5";
  readonly reviewPrompt: "onboarding-review@2";
  readonly extractionSchema: "onboarding-extraction-wire@2";
  readonly reviewSchema: "onboarding-review-output@1";
}

export interface OnboardingModelVersionsV6 {
  readonly invocation: "codex-cli-invocation@2";
  readonly cliVersion: "codex-cli-0.149.0-alpha.4-plus@1";
  readonly extractionPrompt: "onboarding-extract@6";
  readonly reviewPrompt: "onboarding-review@2";
  readonly extractionSchema: "onboarding-extraction-wire@2";
  readonly reviewSchema: "onboarding-review-output@1";
}

export interface OnboardingModelVersionsV7 {
  readonly invocation: "codex-cli-invocation@2";
  readonly cliVersion: "codex-cli-0.149.0-alpha.4-plus@1";
  readonly extractionPrompt: "onboarding-extract@7";
  readonly reviewPrompt: "onboarding-review@2";
  readonly extractionSchema: "onboarding-extraction-wire@2";
  readonly reviewSchema: "onboarding-review-output@1";
}

export interface OnboardingModelVersionsV8 {
  readonly invocation: "codex-cli-invocation@2";
  readonly cliVersion: "codex-cli-0.149.0-alpha.4-plus@1";
  readonly extractionPrompt: "onboarding-extract@8";
  readonly reviewPrompt: "onboarding-review@2";
  readonly extractionSchema: "onboarding-extraction-wire@2";
  readonly reviewSchema: "onboarding-review-output@1";
}

export interface OnboardingModelVersionsV9 {
  readonly invocation: "codex-cli-invocation@2";
  readonly cliVersion: "codex-cli-0.149.0-alpha.4-plus@1";
  readonly extractionPrompt: "onboarding-extract@9";
  readonly reviewPrompt: "onboarding-review@2";
  readonly extractionSchema: "onboarding-extraction-wire@3";
  readonly reviewSchema: "onboarding-review-output@1";
}

export type OnboardingModelVersions =
  | OnboardingModelVersionsV1
  | OnboardingModelVersionsV2
  | OnboardingModelVersionsV3
  | OnboardingModelVersionsV4
  | OnboardingModelVersionsV5
  | OnboardingModelVersionsV6
  | OnboardingModelVersionsV7
  | OnboardingModelVersionsV8
  | OnboardingModelVersionsV9;

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

export const ONBOARDING_MODEL_VERSIONS_V3 = Object.freeze({
  invocation: "codex-cli-invocation@1",
  cliVersion: "codex-cli 0.148.0-alpha.15",
  extractionPrompt: "onboarding-extract@3",
  reviewPrompt: "onboarding-review@1",
  extractionSchema: "onboarding-extraction-wire@2",
  reviewSchema: "onboarding-review-output@1",
} as const satisfies OnboardingModelVersionsV3);

export const ONBOARDING_MODEL_VERSIONS_V4 = Object.freeze({
  invocation: "codex-cli-invocation@2",
  cliVersion: "codex-cli-0.149.0-alpha.4-plus@1",
  extractionPrompt: "onboarding-extract@4",
  reviewPrompt: "onboarding-review@2",
  extractionSchema: "onboarding-extraction-wire@2",
  reviewSchema: "onboarding-review-output@1",
} as const satisfies OnboardingModelVersionsV4);

export const ONBOARDING_MODEL_VERSIONS_V5 = Object.freeze({
  invocation: "codex-cli-invocation@2",
  cliVersion: "codex-cli-0.149.0-alpha.4-plus@1",
  extractionPrompt: "onboarding-extract@5",
  reviewPrompt: "onboarding-review@2",
  extractionSchema: "onboarding-extraction-wire@2",
  reviewSchema: "onboarding-review-output@1",
} as const satisfies OnboardingModelVersionsV5);

export const ONBOARDING_MODEL_VERSIONS_V6 = Object.freeze({
  invocation: "codex-cli-invocation@2",
  cliVersion: "codex-cli-0.149.0-alpha.4-plus@1",
  extractionPrompt: "onboarding-extract@6",
  reviewPrompt: "onboarding-review@2",
  extractionSchema: "onboarding-extraction-wire@2",
  reviewSchema: "onboarding-review-output@1",
} as const satisfies OnboardingModelVersionsV6);

export const ONBOARDING_MODEL_VERSIONS_V7 = Object.freeze({
  invocation: "codex-cli-invocation@2",
  cliVersion: "codex-cli-0.149.0-alpha.4-plus@1",
  extractionPrompt: "onboarding-extract@7",
  reviewPrompt: "onboarding-review@2",
  extractionSchema: "onboarding-extraction-wire@2",
  reviewSchema: "onboarding-review-output@1",
} as const satisfies OnboardingModelVersionsV7);

export const ONBOARDING_MODEL_VERSIONS_V8 = Object.freeze({
  invocation: "codex-cli-invocation@2",
  cliVersion: "codex-cli-0.149.0-alpha.4-plus@1",
  extractionPrompt: "onboarding-extract@8",
  reviewPrompt: "onboarding-review@2",
  extractionSchema: "onboarding-extraction-wire@2",
  reviewSchema: "onboarding-review-output@1",
} as const satisfies OnboardingModelVersionsV8);

export const ONBOARDING_MODEL_VERSIONS_V9 = Object.freeze({
  invocation: "codex-cli-invocation@2",
  cliVersion: "codex-cli-0.149.0-alpha.4-plus@1",
  extractionPrompt: "onboarding-extract@9",
  reviewPrompt: "onboarding-review@2",
  extractionSchema: "onboarding-extraction-wire@3",
  reviewSchema: "onboarding-review-output@1",
} as const satisfies OnboardingModelVersionsV9);

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
  if (matchesTuple(versions, ONBOARDING_MODEL_VERSIONS_V3)) {
    return ONBOARDING_MODEL_VERSIONS_V3;
  }
  if (matchesTuple(versions, ONBOARDING_MODEL_VERSIONS_V4)) {
    return ONBOARDING_MODEL_VERSIONS_V4;
  }
  if (matchesTuple(versions, ONBOARDING_MODEL_VERSIONS_V5)) {
    return ONBOARDING_MODEL_VERSIONS_V5;
  }
  if (matchesTuple(versions, ONBOARDING_MODEL_VERSIONS_V6)) {
    return ONBOARDING_MODEL_VERSIONS_V6;
  }
  if (matchesTuple(versions, ONBOARDING_MODEL_VERSIONS_V7)) {
    return ONBOARDING_MODEL_VERSIONS_V7;
  }
  if (matchesTuple(versions, ONBOARDING_MODEL_VERSIONS_V8)) {
    return ONBOARDING_MODEL_VERSIONS_V8;
  }
  if (matchesTuple(versions, ONBOARDING_MODEL_VERSIONS_V9)) {
    return ONBOARDING_MODEL_VERSIONS_V9;
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
