import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";

import { createConfirmedLife } from "../application/confirmed-life";
import { createHousingBranchApplication } from "../application/fork-housing";
import {
  completeOnboarding as completeOnboardingUseCase,
  extractMessage as extractOnboardingMessageUseCase,
} from "../application/onboarding";
import type {
  ContinueOnboardingCommand,
  ExtractOnboardingMessageCommand,
  OnboardingModelPort,
} from "../application/onboarding-contracts";
import { createJourneyPresentation } from "../application/present-journey";
import { createReplayApplication } from "../application/replay";
import {
  replayEvidence as replayVerifiedEvidence,
  type EvidenceReplayIntegrityFactoryPort,
} from "../application/replay-evidence";
import {
  projectDecisionEvidence,
  projectVerifiedBudgetFacts,
} from "../application/verified-evidence";
import { assessRoute } from "../decision/assessment";
import type {
  OfficialSourcePort,
  RequestStep,
} from "../research/contracts";
import type { SloveniaSourceId } from "../research/cold-start-contracts";
import {
  runCurrentEvidence,
  type EvidenceParsers,
} from "../research/run";
import { createEvidenceIntegrity } from "./integrity";
import { createCodexOnboardingModel } from "./codex-cli/onboarding-model";
import { getCodexCliModelAdapter } from "./codex-cli/runtime";
import { createColdStartComposition } from "./cold-start-composition";
import { createCountryResolutionComposition } from "./country-resolution-composition";
import { createPlaceFrontierComposition } from "./place-frontier-composition";
import { captureHttpOnce } from "./sources/gateway";
import { OfficialSourceAdapter } from "./sources/official-source-adapter";
import { openEvidenceDatabase } from "./sqlite/db";
import { SqliteEvidenceStore } from "./sqlite/evidence-store";
import { SqliteBranchStore } from "./sqlite/branch-store";
import { SqliteHousingBranchWriter } from "./sqlite/housing-branch-writer";
import { SqliteOnboardingStore } from "./sqlite/onboarding-store";
import { SqliteProfileStore } from "./sqlite/profile-store";
import { SqliteRunStore } from "./sqlite/run-store";

export interface ConfirmedLifeCompositionOptions {
  readonly database: Database.Database;
  readonly hmacKey: string;
  readonly source?: OfficialSourcePort;
  readonly requestStep?: RequestStep;
  readonly parsers?: EvidenceParsers;
  readonly clock?: () => Date;
  readonly nextId?: (kind: "run" | "revision" | "assessment") => string;
  readonly deadlineAt?: (now: Date) => Date;
}

export function createConfirmedLifeComposition(options: ConfirmedLifeCompositionOptions) {
  const evidenceStore = new SqliteEvidenceStore(options.database);
  const branchStore = new SqliteBranchStore(options.database, options.hmacKey);
  const onboardingStore = new SqliteOnboardingStore(
    options.database,
    options.hmacKey,
    options.clock === undefined ? {} : { clock: options.clock },
  );
  const profileStore = new SqliteProfileStore(options.database);
  const runStore = new SqliteRunStore(options.database, options.hmacKey);
  const housingBranchAppend = new SqliteHousingBranchWriter(options.database, branchStore, runStore);
  const source = options.source ?? new OfficialSourceAdapter();
  const requestStep = options.requestStep ?? captureHttpOnce;
  const integrity = createEvidenceIntegrity(options.hmacKey);
  const integrityFactory = Object.freeze({
    create: createEvidenceIntegrity,
  }) satisfies EvidenceReplayIntegrityFactoryPort;
  const nextId = options.nextId ?? (
    (kind: "run" | "revision" | "assessment") => `${kind}-${randomUUID()}`
  );
  const nextOnboardingParticipantId = () => randomUUID();
  const nextOnboardingAssistantMessageId = () => randomUUID();
  const nextOnboardingCompletionCommandId = () => randomUUID();
  let onboardingModel: OnboardingModelPort | undefined;
  const getOnboardingModel = (): OnboardingModelPort => {
    onboardingModel ??= createCodexOnboardingModel(getCodexCliModelAdapter());
    return onboardingModel;
  };

  const confirmedLife = createConfirmedLife({
    profileStore,
    runStore,
    evidence: {
      loadVerified: (id, expected) => evidenceStore.loadVerified(id, options.hmacKey, expected),
      loadVerifiedDetails: async (id, expected) => {
        const bundle = await evidenceStore.loadVerifiedBundle(id, options.hmacKey, expected);
        return {
          snapshot: bundle.snapshot,
          sources: bundle.entries.map((entry) => ({
            sourceId: entry.sourceId,
            navigationUrl: entry.navigationUrl,
            resolvedEvidenceUrl: entry.resolvedEvidenceUrl,
          })),
        };
      },
    },
    research: {
      runCurrentEvidence: (input) => runCurrentEvidence(input, {
        source,
        requestStep,
        store: evidenceStore,
        integrity,
        ...(options.parsers === undefined ? {} : { parsers: options.parsers }),
      }),
    },
    assess: assessRoute,
    clock: options.clock ?? (() => new Date()),
    nextId,
    deadlineAt: options.deadlineAt ?? ((now) => new Date(now.getTime() + 45_000)),
  });
  const coldStart = createColdStartComposition({
    database: options.database,
    hmacKey: options.hmacKey,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    nextRunId: () => nextId("run"),
  });
  const placeFrontier = createPlaceFrontierComposition({
    database: options.database,
    hmacKey: options.hmacKey,
    onboardingConfirmations: onboardingStore,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    nextRunId: () => nextId("run"),
  });
  const countryResolution = createCountryResolutionComposition({
    database: options.database,
    hmacKey: options.hmacKey,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.requestStep === undefined ? {} : {
      requestStep: options.requestStep as unknown as RequestStep<SloveniaSourceId>,
    }),
    nextRunId: () => nextId("run"),
  });
  const housingBranch = createHousingBranchApplication({
    profileStore,
    runStore,
    branchStore,
    housingBranchAppend,
    budgetFacts: {
      loadVerifiedBudgetFacts: async (id, expected) => projectVerifiedBudgetFacts(
        await evidenceStore.loadVerified(id, options.hmacKey, expected),
      ),
    },
    nextRevisionId: () => nextId("revision"),
  });
  const replay = createReplayApplication({
    profileStore,
    runStore,
    branchStore,
    replayEvidence: (snapshotId) => replayVerifiedEvidence(
      { snapshotId, hmacKey: options.hmacKey },
      {
        store: evidenceStore,
        integrityFactory,
        ...(options.parsers === undefined ? {} : { parsers: options.parsers }),
      },
    ),
    projectDecisionEvidence,
    projectBudgetFacts: projectVerifiedBudgetFacts,
  });
  const journey = createJourneyPresentation({
    loadRunDetailsCore: confirmedLife.loadRunDetailsCore,
    loadInitialBranchByRunId: (runId, assessmentRevisionId) =>
      runStore.loadInitialBranchByRunId(runId, assessmentRevisionId),
    loadBranchCommit: (commitId) => branchStore.loadVerified(commitId),
    saveInitialHousingBranch: housingBranch.saveInitialHousingBranch,
    forkHousingBranch: housingBranch.forkHousingBranch,
  });
  return Object.freeze({
    ...confirmedLife,
    ...coldStart,
    ...housingBranch,
    ...replay,
    ...journey,
    extractOnboardingMessage: (
      command: ExtractOnboardingMessageCommand,
      signal: AbortSignal,
    ) => extractOnboardingMessageUseCase(command, {
      model: getOnboardingModel(),
      nextParticipantId: nextOnboardingParticipantId,
      nextAssistantMessageId: nextOnboardingAssistantMessageId,
      nextCompletionCommandId: nextOnboardingCompletionCommandId,
    }, signal),
    completeOnboarding: (
      command: ContinueOnboardingCommand,
      signal: AbortSignal,
    ) => completeOnboardingUseCase(command, {
      model: getOnboardingModel(),
      completion: onboardingStore,
      frontier: placeFrontier,
    }, signal),
    preparePlaceFrontier: placeFrontier.preparePlaceFrontier,
    runPlaceFrontier: placeFrontier.runPlaceFrontier,
    presentPlaceFrontier: placeFrontier.presentPlaceFrontier,
    startCountryResolution: countryResolution.startCountryResolution,
    decideYellow: countryResolution.decideYellow,
    prepareCountryResolutionContinuation:
      countryResolution.prepareCountryResolutionContinuation,
    continueCountryResolution: countryResolution.continueCountryResolution,
    presentCountryResolution: countryResolution.presentCountryResolution,
    requireResolvedCountryShortlistForCity:
      countryResolution.requireResolvedCountryShortlistForCity,
  });
}

let application: ReturnType<typeof createConfirmedLifeComposition> | undefined;

export function getConfirmedLifeApplication(): ReturnType<typeof createConfirmedLifeComposition> {
  if (application !== undefined) return application;
  const databasePath = process.env.DATABASE_PATH;
  const hmacKey = process.env.EVIDENCE_HMAC_KEY;
  if (databasePath === undefined || databasePath.length === 0) throw new Error("database_path_missing");
  if (hmacKey === undefined || hmacKey.length === 0) throw new Error("integrity_key_missing");
  application = createConfirmedLifeComposition({
    database: openEvidenceDatabase(databasePath),
    hmacKey,
  });
  return application;
}
