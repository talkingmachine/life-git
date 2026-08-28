import type {
  LocalExtractionResult,
  LocalReviewResult,
} from "../decision/onboarding-catalog";
import type { SessionMessage } from "../decision/onboarding-session";
import type { OnboardingSessionState } from "../decision/onboarding-session";
import type { PlaceFrontierPrepared } from "./place-frontier";
import type {
  ConfirmedOnboardingValues,
  PreferenceProfileV2Snapshot,
  QuestionnaireIssue,
  RelocationProfileV2Snapshot,
} from "../decision/onboarding-questionnaire";
import type { QuestionnaireProvenance } from "../decision/onboarding-provenance";
import type { OnboardingModelVersions } from "./onboarding-model-versions";

export type { OnboardingModelVersions } from "./onboarding-model-versions";

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
  | "codex_tool_isolation_unproven"
  | "codex_rate_limited"
  | "codex_provider_transient";

export type OnboardingModelErrorCode =
  | "onboarding_model_aborted"
  | "onboarding_model_integrity_failed"
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

export interface OnboardingReceipt {
  readonly schemaVersion: "onboarding-receipt@1";
  readonly receiptId: string;
  readonly completionCommandId: string;
  readonly confirmationDigest: string;
  readonly profileId: string;
  readonly preferenceProfileId: string;
  readonly frontierRunId: string;
  readonly confirmedAt: string;
}

export interface VerifiedOnboardingConfirmation {
  readonly receipt: OnboardingReceipt;
  readonly profile: RelocationProfileV2Snapshot;
  readonly preferences: PreferenceProfileV2Snapshot;
  readonly provenance: QuestionnaireProvenance;
  readonly versions: OnboardingModelVersions;
}

export interface OnboardingCompletionPort {
  replayCommitted(input: {
    readonly completionCommandId: string;
    readonly confirmed: ConfirmedOnboardingValues;
    readonly versions: OnboardingModelVersions;
  }): Promise<OnboardingReceipt | undefined>;
  commitOrReplay(input: {
    readonly completionCommandId: string;
    readonly confirmed: ConfirmedOnboardingValues;
    readonly versions: OnboardingModelVersions;
  }): Promise<OnboardingReceipt>;
}

export interface OnboardingConfirmationReadPort {
  loadBySnapshotBindingsVerified(input: {
    readonly profileId: string;
    readonly preferenceProfileId: string;
  }): Promise<VerifiedOnboardingConfirmation>;
}

export interface ConfirmedOnboardingFrontierPort {
  prepareFromOnboardingReceipt(receipt: OnboardingReceipt): Promise<PlaceFrontierPrepared>;
}

export interface ExtractOnboardingMessageCommand {
  readonly schemaVersion: "onboarding-message-command@1";
  readonly session: OnboardingSessionState;
  readonly message: SessionMessage;
}

export interface ContinueOnboardingCommand {
  readonly schemaVersion: "onboarding-continue-command@1";
  readonly session: OnboardingSessionState;
}

export type CompleteOnboardingResult =
  | {
      readonly kind: "blocked";
      readonly session: OnboardingSessionState;
      readonly issues: readonly [QuestionnaireIssue, ...QuestionnaireIssue[]];
      readonly followUpQuestion: string;
    }
  | {
      readonly kind: "launched";
      readonly receipt: OnboardingReceipt;
      readonly prepared: PlaceFrontierPrepared;
    };
