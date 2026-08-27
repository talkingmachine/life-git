import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeAll, describe, expect, test } from "vitest";

import {
  OnboardingFeasibilityError,
  parseOnboardingFeasibilityArguments,
  readOnboardingFeasibilityFixture,
  runOnboardingFeasibilityForTest,
} from "../../evals/onboarding-feasibility";
import type { OnboardingModelPort } from "../../src/application/onboarding-contracts";
import type {
  GuardedExtractionProposal,
} from "../../src/decision/onboarding-model-contract";
import {
  parseLocalExtractionOutput,
  parseLocalReviewOutput,
} from "../../src/decision/onboarding-model-output";
import {
  ONBOARDING_EXTRACTION_LIMITS,
  ONBOARDING_EXTRACTION_PROMPT_TEMPLATE,
  ONBOARDING_MODEL_VERSIONS,
  ONBOARDING_REVIEW_LIMITS,
  ONBOARDING_REVIEW_PROMPT_TEMPLATE,
} from "../../src/infrastructure/codex-cli/onboarding-model";
import {
  ONBOARDING_EXTRACTION_SCHEMA,
  ONBOARDING_REVIEW_SCHEMA,
} from "../../src/infrastructure/codex-cli/onboarding-schema";

const fixtureUrl = new URL("../../evals/fixtures/onboarding/cases.json", import.meta.url);
const temporaryDirectories: string[] = [];
let fixtureBytes: Uint8Array;

beforeAll(async () => {
  fixtureBytes = new Uint8Array(await readFile(fixtureUrl));
});

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("onboarding feasibility contract", () => {
  test("exports the closed fixture reader and test runner", () => {
    expect(readOnboardingFeasibilityFixture).toBeTypeOf("function");
    expect(runOnboardingFeasibilityForTest).toBeTypeOf("function");
  });

  test("reads the exact ordered fixture and rejects hostile or reordered input", () => {
    const fixture = readFixture();
    expect(fixture.cases.map(({ caseId }) => caseId)).toEqual([
      "extract_self_ru",
      "extract_companion",
      "extract_zero_unusual_iso",
      "extract_unknown",
      "extract_correction",
      "extract_prompt_injection",
      "review_final_blockers",
    ]);
    for (const testCase of fixture.cases.filter((entry) => entry.kind === "extract")) {
      expect(testCase.userMessage.text).not.toMatch(
        /\b(?:countryCode|city|self|companion\.\d+|amount|currency|basis)\b/u,
      );
    }
    expect(Object.isFrozen(fixture)).toBe(true);

    const reordered = JSON.parse(decodeFixture()) as { cases: unknown[] };
    [reordered.cases[0], reordered.cases[1]] = [reordered.cases[1], reordered.cases[0]];
    expect(() => readOnboardingFeasibilityFixture(reordered)).toThrow(OnboardingFeasibilityError);

    let getterCalled = false;
    const hostile = JSON.parse(decodeFixture()) as Record<string, unknown>;
    Object.defineProperty(hostile, "fixtureVersion", {
      enumerable: true,
      get: () => {
        getterCalled = true;
        return "onboarding-cases@1";
      },
    });
    expect(() => readOnboardingFeasibilityFixture(hostile)).toThrow(OnboardingFeasibilityError);
    expect(getterCalled).toBe(false);
  });

  test("runs every semantic oracle once and writes only the closed bound artifact", async () => {
    const fixture = readFixture();
    const calls: string[] = [];
    const model = fakeModel(fixture, calls);
    const directory = await temporaryDirectory();
    const artifactPath = join(directory, "artifact.json");
    const diagnosticPath = join(directory, "diagnostic.json");
    await writeFile(diagnosticPath, "stale diagnostic\n", "utf8");
    let now = 0;

    const artifact = await runOnboardingFeasibilityForTest({
      artifactPath,
      diagnosticPath,
      fixtureBytes,
      model,
      signal: new AbortController().signal,
      clock: () => {
        const value = now;
        now += 7;
        return value;
      },
    });

    expect(calls).toEqual(["extract", "extract", "extract", "extract", "extract", "extract", "review"]);
    expect(artifact.caseResults).toHaveLength(7);
    expect(artifact.caseResults.every(({ status, elapsedMs }) => status === "passed" && elapsedMs === 7)).toBe(true);
    expect(artifact.extractionLimits).toEqual(ONBOARDING_EXTRACTION_LIMITS);
    expect(artifact.reviewLimits).toEqual(ONBOARDING_REVIEW_LIMITS);
    expect(artifact.fixtureDigest).toBe(digestBytes(fixtureBytes));
    expect(artifact.extractionPromptDigest).toBe(digestText(ONBOARDING_EXTRACTION_PROMPT_TEMPLATE));
    expect(artifact.reviewPromptDigest).toBe(digestText(ONBOARDING_REVIEW_PROMPT_TEMPLATE));
    expect(artifact.extractionSchemaDigest).toBe(digestJson(ONBOARDING_EXTRACTION_SCHEMA));
    expect(artifact.reviewSchemaDigest).toBe(digestJson(ONBOARDING_REVIEW_SCHEMA));
    const { artifactDigest, ...withoutDigest } = artifact;
    expect(artifactDigest).toBe(digestJson(withoutDigest));

    const bytes = await readFile(artifactPath);
    expect(bytes.at(-1)).toBe(0x0a);
    expect((await stat(artifactPath)).mode & 0o777).toBe(0o600);
    const serialized = bytes.toString("utf8");
    for (const forbidden of ["Москва", "Белград", "shell-команду", "currentUserMessage", "BEGIN_ONBOARDING_INPUT_JSON"]) {
      expect(serialized).not.toContain(forbidden);
    }
    await expect(readFile(diagnosticPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("removes a stale artifact first and never retries a failed case", async () => {
    const fixture = readFixture();
    const directory = await temporaryDirectory();
    const artifactPath = join(directory, "artifact.json");
    const diagnosticPath = join(directory, "diagnostic.json");
    await writeFile(artifactPath, "stale passing artifact\n", "utf8");
    let calls = 0;
    const model = fakeModel(fixture, [], 3, () => {
      calls += 1;
    });

    await expect(runOnboardingFeasibilityForTest({
      artifactPath,
      diagnosticPath,
      fixtureBytes,
      model,
      signal: new AbortController().signal,
    })).rejects.toEqual(new OnboardingFeasibilityError());
    expect(calls).toBe(3);
    await expect(readFile(artifactPath)).rejects.toMatchObject({ code: "ENOENT" });
    const diagnostic = JSON.parse(await readFile(diagnosticPath, "utf8")) as Record<string, unknown>;
    expect(diagnostic).toMatchObject({
      schemaVersion: "onboarding-model-feasibility-diagnostic@1",
      fixtureVersion: "onboarding-cases@1",
      caseId: "extract_zero_unusual_iso",
      stage: "extract_model",
      errorCode: "onboarding_model_feasibility_failed",
      runtimeCode: null,
      passingArtifactPresent: false,
    });
    expect((await stat(diagnosticPath)).mode & 0o777).toBe(0o600);
    expect(JSON.stringify(diagnostic)).not.toContain("secret model failure");
    const { diagnosticDigest, ...withoutDigest } = diagnostic;
    expect(diagnosticDigest).toBe(digestJson(withoutDigest));
  });

  test("rejects invalid input or an inactive signal before any model callback and leaves no artifact", async () => {
    const directory = await temporaryDirectory();
    const artifactPath = join(directory, "artifact.json");
    const diagnosticPath = join(directory, "diagnostic.json");
    await writeFile(artifactPath, "stale\n", "utf8");
    const invalid = JSON.parse(decodeFixture()) as Record<string, unknown>;
    invalid.extra = true;
    let calls = 0;
    const model = fakeModel(readFixture(), [], undefined, () => {
      calls += 1;
    });

    await expect(runOnboardingFeasibilityForTest({
      artifactPath,
      diagnosticPath,
      fixtureBytes: new TextEncoder().encode(JSON.stringify(invalid)),
      model,
      signal: new AbortController().signal,
    })).rejects.toBeInstanceOf(OnboardingFeasibilityError);
    expect(calls).toBe(0);
    await expect(readFile(artifactPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(JSON.parse(await readFile(diagnosticPath, "utf8"))).toMatchObject({
      caseId: null,
      stage: "input_validation",
      passingArtifactPresent: false,
    });

    const controller = new AbortController();
    controller.abort(new Error("secret abort reason"));
    await expect(runOnboardingFeasibilityForTest({
      artifactPath,
      diagnosticPath,
      fixtureBytes,
      model,
      signal: controller.signal,
    })).rejects.toEqual(new OnboardingFeasibilityError());
    expect(calls).toBe(0);
  });

  test("accepts only the single artifact argument", () => {
    expect(parseOnboardingFeasibilityArguments(["--artifact", "data/evals/onboarding-model-feasibility.json"]))
      .toEqual({ artifactPath: "data/evals/onboarding-model-feasibility.json" });
    expect(parseOnboardingFeasibilityArguments([
      "--artifact",
      "data/evals/onboarding-model-feasibility.json",
      "--diagnostic",
      "data/evals/onboarding-model-feasibility-diagnostic.json",
    ])).toEqual({
      artifactPath: "data/evals/onboarding-model-feasibility.json",
      diagnosticPath: "data/evals/onboarding-model-feasibility-diagnostic.json",
    });
    expect(() => parseOnboardingFeasibilityArguments([])).toThrow(OnboardingFeasibilityError);
    expect(() => parseOnboardingFeasibilityArguments(["--artifact", "a", "--retry"])).toThrow(
      OnboardingFeasibilityError,
    );
  });
});

type Fixture = ReturnType<typeof readOnboardingFeasibilityFixture>;

function readFixture(): Fixture {
  return readOnboardingFeasibilityFixture(JSON.parse(decodeFixture()) as unknown);
}

function decodeFixture(): string {
  return new TextDecoder().decode(fixtureBytes);
}

function fakeModel(
  fixture: Fixture,
  calls: string[],
  failAt?: number,
  onCall: () => void = () => undefined,
): OnboardingModelPort {
  const extractionCases = fixture.cases.filter((entry) => entry.kind === "extract");
  const reviewCase = fixture.cases.find((entry) => entry.kind === "review");
  let extractionIndex = 0;
  let callIndex = 0;

  function begin(kind: string): void {
    calls.push(kind);
    callIndex += 1;
    onCall();
    if (callIndex === failAt) throw new Error("secret model failure");
  }

  const model: OnboardingModelPort = {
    versions: ONBOARDING_MODEL_VERSIONS,
    async extract(input) {
      begin("extract");
      const testCase = extractionCases[extractionIndex];
      extractionIndex += 1;
      if (testCase?.kind !== "extract") throw new Error("fixture exhausted");
      return parseLocalExtractionOutput({
        schemaVersion: "onboarding-model-output@1",
        proposals: testCase.expectedProposals.map((proposal) => rawProposal(proposal, input.message)),
        nextQuestion: "Какой следующий обязательный ответ вы хотите добавить?",
      });
    },
    async review() {
      begin("review");
      if (reviewCase?.kind !== "review") throw new Error("review fixture absent");
      return parseLocalReviewOutput({
        schemaVersion: "onboarding-review-output@1",
        issues: reviewCase.expectedIssues,
      });
    },
  };
  return Object.freeze(model);
}

function rawProposal(proposal: GuardedExtractionProposal, message: { messageId: string; text: string }) {
  const common = {
    messageId: message.messageId,
    sourceSpan: { start: 0, end: message.text.length },
  };
  if (proposal.kind === "participant_roster") {
    return { fieldId: "participants" as const, typedValue: proposal.roster, ...common };
  }
  if (proposal.kind === "participant_leaf") {
    return {
      fieldId: `participants.${proposal.descriptor}.${proposal.leafId}` as const,
      typedValue: proposal.normalizedValue,
      ...common,
    };
  }
  return { fieldId: proposal.fieldId, typedValue: proposal.normalizedValue, ...common };
}

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "onboarding-feasibility-test-"));
  temporaryDirectories.push(path);
  return path;
}

function digestBytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function digestText(value: string): string {
  return digestBytes(new TextEncoder().encode(value));
}

function digestJson(value: unknown): string {
  return digestText(JSON.stringify(canonicalize(value)));
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(
    ([key, child]) => [key, canonicalize(child)],
  ));
}
