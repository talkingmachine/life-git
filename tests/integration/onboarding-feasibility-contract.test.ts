import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  chmod,
  link,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeAll, describe, expect, test } from "vitest";

import {
  OnboardingFeasibilityError,
  parseOnboardingFeasibilityArguments,
  readOnboardingFeasibilityFixture,
  runOnboardingFeasibilityForTest,
} from "../../evals/onboarding-feasibility";
import type { OnboardingModelPort } from "../../src/application/onboarding-contracts";
import {
  ONBOARDING_MODEL_VERSIONS_V1,
  ONBOARDING_MODEL_VERSIONS_V2,
} from "../../src/application/onboarding-model-versions";
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
const fixturePath = fileURLToPath(fixtureUrl);
const ARTIFACT_KEYS = Object.freeze([
  "artifactDigest",
  "caseResults",
  "cliVersion",
  "extractionLimits",
  "extractionPromptDigest",
  "extractionPromptVersion",
  "extractionSchemaDigest",
  "extractionSchemaVersion",
  "fixtureDigest",
  "fixtureVersion",
  "invocationVersion",
  "rawOutputStored",
  "rawPromptStored",
  "reviewLimits",
  "reviewPromptDigest",
  "reviewPromptVersion",
  "reviewSchemaDigest",
  "reviewSchemaVersion",
  "schemaVersion",
  "transcriptStored",
]);
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
    expect(Object.keys(artifact).sort()).toEqual(ARTIFACT_KEYS);
    expect(artifact).toMatchObject({
      schemaVersion: "onboarding-model-feasibility@2",
      invocationVersion: ONBOARDING_MODEL_VERSIONS_V2.invocation,
      cliVersion: ONBOARDING_MODEL_VERSIONS_V2.cliVersion,
      extractionPromptVersion: ONBOARDING_MODEL_VERSIONS_V2.extractionPrompt,
      reviewPromptVersion: ONBOARDING_MODEL_VERSIONS_V2.reviewPrompt,
      extractionSchemaVersion: ONBOARDING_MODEL_VERSIONS_V2.extractionSchema,
      reviewSchemaVersion: ONBOARDING_MODEL_VERSIONS_V2.reviewSchema,
    });
    expect(artifact).not.toHaveProperty("modelVersions");
    expect(artifact.caseResults).toHaveLength(7);
    expect(artifact.caseResults.every(({ status, elapsedMs }) => status === "passed" && elapsedMs === 7)).toBe(true);
    expect(artifact.extractionLimits).toEqual({
      timeoutMs: 30_000,
      maxStdoutBytes: 131_072,
      maxStderrBytes: 16_384,
      maxEvents: 64,
    });
    expect(artifact.reviewLimits).toEqual({
      timeoutMs: 15_000,
      maxStdoutBytes: 65_536,
      maxStderrBytes: 16_384,
      maxEvents: 64,
    });
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
      schemaVersion: "onboarding-model-feasibility-diagnostic@2",
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

  test("removes syntactically valid legacy evidence and replaces it only with exact V2 evidence", async () => {
    const fixture = readFixture();
    const directory = await temporaryDirectory();
    const artifactPath = join(directory, "artifact.json");
    await writeFile(artifactPath, `${JSON.stringify(legacyFeasibilityArtifact())}\n`, "utf8");

    const artifact = await runOnboardingFeasibilityForTest({
      artifactPath,
      fixtureBytes,
      model: fakeModel(fixture, []),
      signal: new AbortController().signal,
      clock: clockBy(1),
    });

    expect(artifact.schemaVersion).toBe("onboarding-model-feasibility@2");
    const written = JSON.parse(await readFile(artifactPath, "utf8")) as Record<string, unknown>;
    expect(written.schemaVersion).toBe("onboarding-model-feasibility@2");
    expect(JSON.stringify(written)).not.toContain("onboarding-model-feasibility@1");
  });

  test("removes both stale outputs before descriptor-safely reading the model tuple", async () => {
    const fixture = readFixture();
    const directory = await temporaryDirectory();
    const artifactPath = join(directory, "artifact.json");
    const diagnosticPath = join(directory, "diagnostic.json");
    await writeFile(artifactPath, `${JSON.stringify(legacyFeasibilityArtifact())}\n`, "utf8");
    await writeFile(diagnosticPath, "stale diagnostic\n", "utf8");
    let versionReads = 0;
    const model = fakeModelWithVersionGetter(fixture, () => {
      versionReads += 1;
      expect(existsSync(artifactPath)).toBe(false);
      expect(existsSync(diagnosticPath)).toBe(false);
    });

    const artifact = await runOnboardingFeasibilityForTest({
      artifactPath,
      diagnosticPath,
      fixtureBytes,
      model,
      signal: new AbortController().signal,
      clock: clockBy(1),
    });

    expect(versionReads).toBe(1);
    expect(artifact.extractionPromptVersion).toBe(ONBOARDING_MODEL_VERSIONS_V2.extractionPrompt);
  });

  test.each([
    ["historical V1", ONBOARDING_MODEL_VERSIONS_V1],
    ["V1 prompt with V2 schema", {
      ...ONBOARDING_MODEL_VERSIONS_V2,
      extractionPrompt: ONBOARDING_MODEL_VERSIONS_V1.extractionPrompt,
    }],
    ["V2 prompt with V1 schema", {
      ...ONBOARDING_MODEL_VERSIONS_V2,
      extractionSchema: ONBOARDING_MODEL_VERSIONS_V1.extractionSchema,
    }],
  ])("rejects %s before any model call after removing stale evidence", async (_name, versions) => {
    const fixture = readFixture();
    const directory = await temporaryDirectory();
    const artifactPath = join(directory, "artifact.json");
    const diagnosticPath = join(directory, "diagnostic.json");
    await writeFile(artifactPath, `${JSON.stringify(legacyFeasibilityArtifact())}\n`, "utf8");
    await writeFile(diagnosticPath, "stale diagnostic\n", "utf8");
    let calls = 0;

    await expect(runOnboardingFeasibilityForTest({
      artifactPath,
      diagnosticPath,
      fixtureBytes,
      model: fakeModelWithVersions(fixture, versions, () => {
        calls += 1;
      }),
      signal: new AbortController().signal,
    })).rejects.toEqual(new OnboardingFeasibilityError());

    expect(calls).toBe(0);
    await expect(readFile(artifactPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(JSON.parse(await readFile(diagnosticPath, "utf8"))).toMatchObject({
      schemaVersion: "onboarding-model-feasibility-diagnostic@2",
      stage: "input_validation",
      passingArtifactPresent: false,
    });
  });

  test("rejects direct, symlink-parent, and hard-link fixture aliases for both outputs before touching bytes", async () => {
    const originalFixtureBytes = new Uint8Array(await readFile(fixturePath));
    const originalFixtureMode = (await stat(fixturePath)).mode & 0o777;
    const aliasRoot = await temporaryDirectory();
    const symlinkedFixtureDirectory = join(aliasRoot, "fixture-alias");
    await symlink(dirname(fixturePath), symlinkedFixtureDirectory, "dir");
    const hardLinkPath = join(aliasRoot, "fixture-hard-link.json");
    await link(fixturePath, hardLinkPath);
    const candidates = [
      fixturePath,
      join(symlinkedFixtureDirectory, basename(fixturePath)),
      hardLinkPath,
    ];

    try {
      for (const output of ["artifact", "diagnostic"] as const) {
        for (const candidate of candidates) {
          const siblingPath = join(await temporaryDirectory(), `${output}-sibling.json`);
          let calls = 0;
          await expect(runOnboardingFeasibilityForTest({
            artifactPath: output === "artifact" ? candidate : siblingPath,
            diagnosticPath: output === "diagnostic" ? candidate : siblingPath,
            fixtureBytes,
            model: fakeModel(readFixture(), [], undefined, () => {
              calls += 1;
            }),
            signal: new AbortController().signal,
          })).rejects.toEqual(new OnboardingFeasibilityError());
          expect(calls).toBe(0);
          expect(new Uint8Array(await readFile(fixturePath))).toEqual(originalFixtureBytes);
          expect(new Uint8Array(await readFile(candidate))).toEqual(originalFixtureBytes);
        }
      }
    } finally {
      const currentFixtureBytes = await readFile(fixturePath).catch(() => undefined);
      if (
        currentFixtureBytes === undefined ||
        !Buffer.from(currentFixtureBytes).equals(Buffer.from(originalFixtureBytes))
      ) await writeFile(fixturePath, originalFixtureBytes);
      if (((await stat(fixturePath)).mode & 0o777) !== originalFixtureMode) {
        await chmod(fixturePath, originalFixtureMode);
      }
    }
  });

  test("rejects direct, symlink-parent, and hard-link aliases between outputs before removing either", async () => {
    const directPath = join(await temporaryDirectory(), "direct.json");
    await writeFile(directPath, "direct stale evidence\n", "utf8");

    const realRoot = await temporaryDirectory();
    const symlinkRoot = await temporaryDirectory();
    const realPath = join(realRoot, "same.json");
    await writeFile(realPath, "symlink stale evidence\n", "utf8");
    const aliasedRoot = join(symlinkRoot, "output-alias");
    await symlink(realRoot, aliasedRoot, "dir");
    const symlinkPath = join(aliasedRoot, "same.json");

    const hardLinkRoot = await temporaryDirectory();
    const hardLinkArtifact = join(hardLinkRoot, "artifact.json");
    const hardLinkDiagnostic = join(hardLinkRoot, "diagnostic.json");
    await writeFile(hardLinkArtifact, "hard-link stale evidence\n", "utf8");
    await link(hardLinkArtifact, hardLinkDiagnostic);

    const aliases = [
      { artifactPath: directPath, diagnosticPath: directPath, expected: "direct stale evidence\n" },
      { artifactPath: realPath, diagnosticPath: symlinkPath, expected: "symlink stale evidence\n" },
      {
        artifactPath: hardLinkArtifact,
        diagnosticPath: hardLinkDiagnostic,
        expected: "hard-link stale evidence\n",
      },
    ];
    for (const paths of aliases) {
      let calls = 0;
      await expect(runOnboardingFeasibilityForTest({
        artifactPath: paths.artifactPath,
        diagnosticPath: paths.diagnosticPath,
        fixtureBytes,
        model: fakeModel(readFixture(), [], undefined, () => {
          calls += 1;
        }),
        signal: new AbortController().signal,
      })).rejects.toEqual(new OnboardingFeasibilityError());
      expect(calls).toBe(0);
      expect(await readFile(paths.artifactPath, "utf8")).toBe(paths.expected);
      expect(await readFile(paths.diagnosticPath, "utf8")).toBe(paths.expected);
    }
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

function fakeModelWithVersions(
  fixture: Fixture,
  versions: unknown,
  onCall: () => void,
): OnboardingModelPort {
  const model = fakeModel(fixture, [], undefined, onCall);
  return Object.freeze({
    ...model,
    versions,
  }) as unknown as OnboardingModelPort;
}

function fakeModelWithVersionGetter(
  fixture: Fixture,
  onVersionRead: () => void,
): OnboardingModelPort {
  const model = fakeModel(fixture, []);
  const borrowed: Record<string, unknown> = {
    extract: model.extract,
    review: model.review,
  };
  Object.defineProperty(borrowed, "versions", {
    enumerable: true,
    get: () => {
      onVersionRead();
      return ONBOARDING_MODEL_VERSIONS_V2;
    },
  });
  return Object.freeze(borrowed) as unknown as OnboardingModelPort;
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

function clockBy(step: number): () => number {
  let now = 0;
  return () => {
    const value = now;
    now += step;
    return value;
  };
}

function legacyFeasibilityArtifact(): Record<string, unknown> {
  return {
    schemaVersion: "onboarding-model-feasibility@1",
    fixtureVersion: "onboarding-cases@1",
    fixtureDigest: "0".repeat(64),
    invocationVersion: ONBOARDING_MODEL_VERSIONS_V1.invocation,
    cliVersion: ONBOARDING_MODEL_VERSIONS_V1.cliVersion,
    extractionPromptVersion: ONBOARDING_MODEL_VERSIONS_V1.extractionPrompt,
    reviewPromptVersion: ONBOARDING_MODEL_VERSIONS_V1.reviewPrompt,
    extractionSchemaVersion: ONBOARDING_MODEL_VERSIONS_V1.extractionSchema,
    reviewSchemaVersion: ONBOARDING_MODEL_VERSIONS_V1.reviewSchema,
    extractionPromptDigest: "1".repeat(64),
    reviewPromptDigest: "2".repeat(64),
    extractionSchemaDigest: "3".repeat(64),
    reviewSchemaDigest: "4".repeat(64),
    extractionLimits: ONBOARDING_EXTRACTION_LIMITS,
    reviewLimits: ONBOARDING_REVIEW_LIMITS,
    caseResults: [],
    rawPromptStored: false,
    rawOutputStored: false,
    transcriptStored: false,
    artifactDigest: "5".repeat(64),
  };
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(
    ([key, child]) => [key, canonicalize(child)],
  ));
}
