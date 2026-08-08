import { createHash } from "node:crypto";

import Decimal from "decimal.js";

import type { HousingBranchDiff } from "../application/contracts";
import { calculateBudget, type BudgetCalculation, type BudgetInput } from "./budget";
import { confirmHousingDecision, type HousingDecision } from "./housing";

export interface BranchCommitPayload {
  readonly parentId?: string;
  readonly forkedFrom?: string;
  readonly profileId: string;
  readonly evidenceSnapshotId: string;
  readonly assessmentId: string;
  readonly rulesVersion: string;
  readonly decision: Readonly<HousingDecision>;
  readonly calculationInput: Readonly<BudgetInput>;
  readonly calculation: Readonly<BudgetCalculation>;
  readonly formulaHash: string;
  readonly inputHash: string;
  readonly outputHash: string;
}

export interface BranchCommit extends BranchCommitPayload {
  readonly id: string;
}

export interface BranchCursor {
  readonly commitId: string;
}

export interface CreateCommitInput {
  readonly parentId?: string;
  readonly forkedFrom?: string;
  readonly profileId: string;
  readonly evidenceSnapshotId: string;
  readonly assessmentId: string;
  readonly rulesVersion: string;
  readonly decision: HousingDecision;
  readonly calculationInput: BudgetInput;
}

function idFor(payload: BranchCommitPayload): string {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

function payloadOf(commit: BranchCommit): BranchCommitPayload {
  return {
    ...(commit.parentId === undefined ? {} : { parentId: commit.parentId }),
    ...(commit.forkedFrom === undefined ? {} : { forkedFrom: commit.forkedFrom }),
    profileId: commit.profileId,
    evidenceSnapshotId: commit.evidenceSnapshotId,
    assessmentId: commit.assessmentId,
    rulesVersion: commit.rulesVersion,
    decision: commit.decision,
    calculationInput: commit.calculationInput,
    calculation: commit.calculation,
    formulaHash: commit.formulaHash,
    inputHash: commit.inputHash,
    outputHash: commit.outputHash,
  };
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalValue(item)]));
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export function createCommit(input: CreateCommitInput): BranchCommit {
  if (
    input.profileId.length === 0 || input.evidenceSnapshotId.length === 0 ||
    input.assessmentId.length === 0 || input.rulesVersion.length === 0
  ) throw new Error("invalid_branch_binding");
  const decision = confirmHousingDecision(input.decision);
  const calculationHousing = confirmHousingDecision(input.calculationInput.housing);
  if (canonicalJson(decision) !== canonicalJson(calculationHousing)) throw new Error("integrity_mismatch");
  const calculationInput = Object.freeze({ ...input.calculationInput, housing: decision });
  const calculation = calculateBudget(calculationInput);
  const payload: BranchCommitPayload = Object.freeze({
    ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
    ...(input.forkedFrom === undefined ? {} : { forkedFrom: input.forkedFrom }),
    profileId: input.profileId,
    evidenceSnapshotId: input.evidenceSnapshotId,
    assessmentId: input.assessmentId,
    rulesVersion: input.rulesVersion,
    decision,
    calculationInput,
    calculation,
    formulaHash: calculation.formulaHash,
    inputHash: calculation.inputHash,
    outputHash: calculation.outputHash,
  });
  return Object.freeze({ id: idFor(payload), ...payload });
}

export function rewindTo(commit: BranchCommit): BranchCursor {
  if (commit.id.length === 0) throw new Error("invalid_branch_cursor");
  return Object.freeze({ commitId: commit.id });
}

export function forkHousingCommit(parent: BranchCommit, decisionInput: unknown): BranchCommit {
  replayCommit(parent);
  const decision = confirmHousingDecision(decisionInput);
  return createCommit({
    parentId: parent.id,
    forkedFrom: parent.id,
    profileId: parent.profileId,
    evidenceSnapshotId: parent.evidenceSnapshotId,
    assessmentId: parent.assessmentId,
    rulesVersion: parent.rulesVersion,
    decision,
    calculationInput: { ...parent.calculationInput, housing: decision },
  });
}

function displayDelta(after: string, before: string): string {
  return new Decimal(after).minus(before).toFixed(2);
}

export function diffCommits(before: BranchCommit, after: BranchCommit): HousingBranchDiff {
  replayCommit(before);
  replayCommit(after);
  if (
    after.parentId !== before.id || after.forkedFrom !== before.id ||
    after.profileId !== before.profileId || after.evidenceSnapshotId !== before.evidenceSnapshotId ||
    after.assessmentId !== before.assessmentId || after.rulesVersion !== before.rulesVersion ||
    after.calculation.formulaHash !== before.calculation.formulaHash ||
    canonicalJson({
      income: after.calculationInput.income,
      cbrRate: after.calculationInput.cbrRate,
      boaRate: after.calculationInput.boaRate,
    }) !== canonicalJson({
      income: before.calculationInput.income,
      cbrRate: before.calculationInput.cbrRate,
      boaRate: before.calculationInput.boaRate,
    })
  ) throw new Error("invalid_housing_fork");
  return Object.freeze({
    housing: Object.freeze({
      before: before.calculation.housingAll,
      after: after.calculation.housingAll,
      delta: displayDelta(after.calculation.housingAll, before.calculation.housingAll),
    }),
    knownResidual: Object.freeze({
      before: before.calculation.knownResidualAll,
      after: after.calculation.knownResidualAll,
      delta: displayDelta(after.calculation.knownResidualAll, before.calculation.knownResidualAll),
      cause: "housing" as const,
    }),
    reused: Object.freeze(["profile", "evidence", "rules"] as const),
  });
}

export function replayCommit(commit: BranchCommit): BranchCommit {
  const expected = createCommit({
    ...(commit.parentId === undefined ? {} : { parentId: commit.parentId }),
    ...(commit.forkedFrom === undefined ? {} : { forkedFrom: commit.forkedFrom }),
    profileId: commit.profileId,
    evidenceSnapshotId: commit.evidenceSnapshotId,
    assessmentId: commit.assessmentId,
    rulesVersion: commit.rulesVersion,
    decision: commit.decision,
    calculationInput: commit.calculationInput,
  });
  if (commit.id !== idFor(payloadOf(commit)) || canonicalJson(expected) !== canonicalJson(commit)) {
    throw new Error("integrity_mismatch");
  }
  return commit;
}
