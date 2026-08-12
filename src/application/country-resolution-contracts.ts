import type { FrontierMarker } from "./place-frontier";
import type {
  ResolutionMarkerProjection,
  ResolutionStopCondition,
  YellowDecision,
  YellowDecisionKind,
} from "../decision/country-resolution-policy";

export interface ResolutionSourceBinding {
  readonly automaticShortlistSnapshotId: string;
  readonly rankingSnapshotId: string;
  readonly profileSnapshotId: string;
  readonly preferenceProfileSnapshotId: string;
}

export interface ResolvedCountryEntry {
  readonly countryCode: string;
  readonly rank: number;
  readonly formalMarkerDigest: string;
}

export interface CountryResolutionSemanticContext {
  readonly source: ResolutionSourceBinding;
  readonly orderedCountryCodes: readonly string[];
  readonly markerProjections: readonly ResolutionMarkerProjection[];
}

export interface CountryResolutionChainLocator {
  readonly resolutionRunId: string;
  readonly source: ResolutionSourceBinding;
  readonly revisions: readonly CountryResolutionRevision[];
}

interface CountryResolutionRevisionBase extends ResolutionSourceBinding {
  readonly schemaVersion: "country-resolution@1";
  readonly rulesVersion: "country-resolution@1";
  readonly id: string;
  readonly resolutionRunId: string;
  readonly predecessorRevisionId?: string;
  readonly decisions: readonly YellowDecision[];
  readonly replacementMarkers: readonly FrontierMarker[];
  readonly nextUncheckedRank: number;
  readonly unresolvedCountryCodes: readonly string[];
  readonly slotCountryCodes: readonly string[];
  readonly contextHash: string;
  readonly createdAt: string;
}

export interface WorkingCountryResolutionRevision extends CountryResolutionRevisionBase {
  readonly kind: "working";
  readonly phase: "awaiting_decision" | "replacement_required";
}

export interface ResolvedCountryShortlistSnapshot extends CountryResolutionRevisionBase {
  readonly kind: "resolved";
  readonly resolvedEntries: readonly ResolvedCountryEntry[];
  readonly stopCondition: ResolutionStopCondition;
}

export type CountryResolutionRevision =
  | WorkingCountryResolutionRevision
  | ResolvedCountryShortlistSnapshot;

export interface ResolutionIntegrity {
  canonical(value: unknown): string;
  hash(value: string): string;
}

export type CountryResolutionOperation =
  | {
      readonly commandId: string;
      readonly kind: "start";
      readonly automaticShortlistSnapshotId: string;
    }
  | {
      readonly commandId: string;
      readonly kind: "yellow_decision";
      readonly expectedHeadRevisionId: string;
      readonly countryCode: string;
      readonly decision: YellowDecisionKind;
      readonly warningCopyVersion: "yellow-risk@1";
    }
  | {
      readonly commandId: string;
      readonly kind: "replacement_completed";
      readonly expectedHeadRevisionId: string;
      readonly countryCode: string;
      readonly countryCheckRunId: string;
    };

export function countryResolutionStartCommandId(
  automaticShortlistSnapshotId: string,
  integrity: ResolutionIntegrity,
): string {
  return `country-resolution:start:${integrity.hash(automaticShortlistSnapshotId)}`;
}

export function countryResolutionRunId(
  automaticShortlistSnapshotId: string,
  integrity: ResolutionIntegrity,
): string {
  return `country-resolution:${integrity.hash(integrity.canonical({ automaticShortlistSnapshotId }))}`;
}

export function countryResolutionContextHash(input: {
  readonly resolutionRunId: string;
  readonly source: ResolutionSourceBinding;
  readonly predecessorRevisionId?: string;
  readonly operation: CountryResolutionOperation;
  readonly rulesVersion: "country-resolution@1";
}, integrity: ResolutionIntegrity): string {
  return integrity.hash(integrity.canonical(input));
}

export function countryResolutionRevisionId(
  resolutionRunId: string,
  operation: CountryResolutionOperation,
  integrity: ResolutionIntegrity,
): string {
  return `country-resolution-revision:${integrity.hash(integrity.canonical({
    resolutionRunId,
    operation,
  }))}`;
}

export interface CountryResolutionStorePort {
  append(input: {
    readonly revision: CountryResolutionRevision;
    readonly operation: CountryResolutionOperation;
    readonly context: CountryResolutionSemanticContext;
  }): CountryResolutionRevision;
  loadRevisionVerified(id: string, context: CountryResolutionSemanticContext): CountryResolutionRevision;
  loadHeadVerified(resolutionRunId: string, context: CountryResolutionSemanticContext): CountryResolutionRevision;
  loadChainVerified(
    resolutionRunId: string,
    context: CountryResolutionSemanticContext,
  ): readonly CountryResolutionRevision[];
  findByCommandVerified(
    resolutionRunId: string,
    commandId: string,
    context: CountryResolutionSemanticContext,
  ): { readonly revision: CountryResolutionRevision; readonly operation: CountryResolutionOperation } | undefined;
  findRootForRunVerified(
    resolutionRunId: string,
    context: CountryResolutionSemanticContext,
  ): CountryResolutionRevision | undefined;
  locateChainVerified(input:
    | { readonly resolutionRunId: string }
    | { readonly revisionId: string }
  ): CountryResolutionChainLocator;
}
