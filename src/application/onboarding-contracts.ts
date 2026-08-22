import type {
  LocalExtractionResult,
  LocalReviewResult,
} from "../decision/onboarding-catalog";
import type { SessionMessage } from "../decision/onboarding-session";

export interface OnboardingModelVersions {
  readonly invocation: "codex-cli-invocation@1";
  readonly cliVersion: "codex-cli 0.148.0-alpha.15";
  readonly extractionPrompt: "onboarding-extract@1";
  readonly reviewPrompt: "onboarding-review@1";
  readonly extractionSchema: "onboarding-model-output@1";
  readonly reviewSchema: "onboarding-review-output@1";
}

export interface OnboardingModelPort {
  readonly versions: OnboardingModelVersions;
  extract(input: {
    readonly message: SessionMessage;
    readonly questionnaire: unknown;
    readonly signal: AbortSignal;
  }): Promise<LocalExtractionResult>;
  review(input: {
    readonly questionnaire: unknown;
    readonly signal: AbortSignal;
  }): Promise<LocalReviewResult>;
}

export type OnboardingRuntimeErrorCode =
  | "codex_missing"
  | "codex_version_mismatch"
  | "codex_not_authenticated"
  | "codex_protocol_invalid"
  | "codex_tool_event"
  | "codex_output_too_large"
  | "codex_event_limit"
  | "codex_timeout"
  | "codex_aborted"
  | "codex_process_failed"
  | "codex_json_invalid"
  | "codex_temp_root_invalid"
  | "codex_tool_isolation_unproven";

export type OnboardingModelErrorCode =
  | "onboarding_model_aborted"
  | "onboarding_model_invalid"
  | "onboarding_model_runtime_failed";

export class OnboardingModelError extends Error {
  readonly name = "OnboardingModelError";

  constructor(
    readonly code: OnboardingModelErrorCode,
    readonly runtimeCode?: OnboardingRuntimeErrorCode,
  ) {
    super(code);
  }
}
