import type { HousingDecision } from "../branch/housing";
import type {
  Assessment,
  EvidenceBlockerKind,
  EvidenceSnapshot,
  ProfileSnapshot,
  SourceId,
} from "../research/contracts";

export const ASSESSMENT_RULES_VERSION = "vs1-assessment@1";

export interface AssessmentRunRevisionPayload {
  readonly id: string;
  readonly runId: string;
  readonly stage: "assessment";
  readonly assessmentDate: string;
  readonly initialHousing: Readonly<HousingDecision>;
  readonly profileId: string;
  readonly evidenceSnapshotId: string;
  readonly assessmentId: string;
  readonly rulesVersion: string;
}

export interface AssessmentRunRevision extends AssessmentRunRevisionPayload {
  readonly hmac: string;
}

export interface RunResult {
  readonly runId: string;
  readonly runRevisionId: string;
  readonly assessmentDate: string;
  readonly profileId: string;
  readonly evidenceSnapshotId: string;
  readonly assessmentId: string;
  readonly assessment: Assessment;
  readonly mode: "current" | "historical";
}

export interface CalculationInput {
  readonly binding: string;
  readonly value: string;
  readonly unit: string;
  readonly provenance: "profile" | "claim";
  readonly ref: string;
}

export type EvidenceReadItem =
  | {
      readonly class: "calculation";
      readonly label: string;
      readonly displayValue: string;
      readonly formulaId: "FORMULA-VS1-FX-01";
      readonly formulaVersion: string;
      readonly inputs: readonly CalculationInput[];
      readonly rounding: "UNROUNDED_THEN_HALF_UP_2DP";
      readonly outputHash: string;
    }
  | {
      readonly class: "official_fact";
      readonly label: string;
      readonly displayValue: string;
      readonly sourceId: SourceId;
      readonly scope: string;
      readonly sourcePeriod: string;
      readonly anchor: string;
      readonly resolvedUrl: string;
      readonly integrity: "verified";
    }
  | {
      readonly class: "user_fact";
      readonly label: string;
      readonly displayValue: string;
      readonly provenance: "confirmed_profile";
    }
  | {
      readonly class: "assumption" | "projection";
      readonly label: string;
      readonly displayValue?: string;
      readonly provenance: "scenario";
    }
  | {
      readonly class: "unknown";
      readonly label: string;
      readonly provenance: "source_unavailable";
      readonly sourceId: SourceId;
      readonly blockerKind: EvidenceBlockerKind;
      readonly navigationUrl: string;
      readonly resolvedUrl?: string;
    }
  | {
      readonly class: "unknown";
      readonly label: string;
      readonly provenance: "unmodelled";
    };

export interface RunDetailsCore {
  readonly run: RunResult;
  readonly profile: ProfileSnapshot;
  readonly evidenceItems: readonly EvidenceReadItem[];
}

export interface ResearchPort {
  runCurrentEvidence(input: {
    readonly runId: string;
    readonly assessmentDate: string;
    readonly deadlineAt: string;
  }): Promise<EvidenceSnapshot>;
}

export interface ProfileStorePort {
  append(snapshot: ProfileSnapshot): Promise<void>;
  loadVerified(id: string): Promise<ProfileSnapshot>;
}

export interface RunStorePort {
  appendAssessment(input: AssessmentRunRevisionPayload & {
    readonly assessment: Assessment;
  }): Promise<{ readonly revision: AssessmentRunRevision; readonly assessment: Assessment }>;
  loadAssessmentByRunId(runId: string): Promise<{
    readonly revision: AssessmentRunRevision;
    readonly assessment: Assessment;
  }>;
}

export interface EvidenceLoadExpectations {
  readonly assessmentDate?: string;
  readonly parserVersions?: Readonly<Record<SourceId, string>>;
  readonly rulesVersion?: string;
}

export interface EvidenceReadPort {
  loadVerified(id: string, expected?: EvidenceLoadExpectations): Promise<EvidenceSnapshot>;
  loadVerifiedDetails(
    id: string,
    expected?: EvidenceLoadExpectations,
  ): Promise<{
    readonly snapshot: EvidenceSnapshot;
    readonly sources: readonly {
      readonly sourceId: SourceId;
      readonly navigationUrl: string;
      readonly resolvedEvidenceUrl: string;
    }[];
  }>;
}

export interface ConfirmedLifePorts {
  readonly profileStore: ProfileStorePort;
  readonly runStore: RunStorePort;
  readonly evidence: EvidenceReadPort;
  readonly research: ResearchPort;
  readonly assess: (
    profile: ProfileSnapshot,
    evidence: EvidenceSnapshot,
    conditions: { readonly housingProvided: true },
  ) => Assessment;
  readonly clock: () => Date;
  readonly nextId: (kind: "run" | "revision" | "assessment") => string;
  readonly deadlineAt: (now: Date) => Date;
}
