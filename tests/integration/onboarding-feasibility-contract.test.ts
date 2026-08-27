import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import {
  access,
  chmod,
  link,
  mkdir,
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
import { promisify } from "node:util";

import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";

import {
  OnboardingFeasibilityError,
  parseOnboardingFeasibilityArguments,
  readOnboardingFeasibilityFixture,
  removeStaleOnboardingFeasibilityArtifact,
  runOnboardingFeasibilityEntrypointForTest,
  runOnboardingFeasibilityForTest,
} from "../../evals/onboarding-feasibility";
import type { OnboardingModelPort } from "../../src/application/onboarding-contracts";
import {
  ONBOARDING_MODEL_VERSIONS_V1,
  ONBOARDING_MODEL_VERSIONS_V2,
  ONBOARDING_MODEL_VERSIONS_V3,
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
  ONBOARDING_REVIEW_SCHEMA,
} from "../../src/infrastructure/codex-cli/onboarding-schema";

const fixtureUrl = new URL("../../evals/fixtures/onboarding/cases.json", import.meta.url);
const fixturePath = fileURLToPath(fixtureUrl);
const MODULE_URL = new URL("../../evals/onboarding-feasibility.ts", import.meta.url);
const TSX_LOADER_URL = new URL("../../node_modules/tsx/dist/loader.mjs", import.meta.url);
const PRIVATE_LAUNCH_SENTINEL = "PRIVATE_FEASIBILITY_LAUNCH_SENTINEL_91a2f6";
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
const execFileAsync = promisify(execFile);
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
    expect(removeStaleOnboardingFeasibilityArtifact).toBeTypeOf("function");
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
      schemaVersion: "onboarding-model-feasibility@3",
      invocationVersion: ONBOARDING_MODEL_VERSIONS_V3.invocation,
      cliVersion: ONBOARDING_MODEL_VERSIONS_V3.cliVersion,
      extractionPromptVersion: "onboarding-extract@3",
      reviewPromptVersion: ONBOARDING_MODEL_VERSIONS_V3.reviewPrompt,
      extractionSchemaVersion: "onboarding-extraction-wire@2",
      reviewSchemaVersion: ONBOARDING_MODEL_VERSIONS_V3.reviewSchema,
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
    expect(artifact.fixtureDigest).toBe(
      "91a4487a3962829ea8cdec216060b4abdf046ea143ee314ce62e043808956b6b",
    );
    expect(artifact.extractionPromptDigest).toBe(digestText(ONBOARDING_EXTRACTION_PROMPT_TEMPLATE));
    expect(artifact.reviewPromptDigest).toBe(digestText(ONBOARDING_REVIEW_PROMPT_TEMPLATE));
    expect(artifact.extractionSchemaDigest).toBe(
      "77fa76052dededa561a0ec596678efd067e89eb106aada6e0f68b88a33cf9c94",
    );
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
      schemaVersion: "onboarding-model-feasibility-diagnostic@3",
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

  test("removes syntactically valid V2 evidence and replaces it only with exact V3 evidence", async () => {
    const fixture = readFixture();
    const directory = await temporaryDirectory();
    const artifactPath = join(directory, "artifact.json");
    await writeFile(artifactPath, `${JSON.stringify(priorFeasibilityArtifact())}\n`, "utf8");

    const artifact = await runOnboardingFeasibilityForTest({
      artifactPath,
      fixtureBytes,
      model: fakeModel(fixture, []),
      signal: new AbortController().signal,
      clock: clockBy(1),
    });

    expect(artifact.schemaVersion).toBe("onboarding-model-feasibility@3");
    const written = JSON.parse(await readFile(artifactPath, "utf8")) as Record<string, unknown>;
    expect(written.schemaVersion).toBe("onboarding-model-feasibility@3");
    expect(JSON.stringify(written)).not.toContain("onboarding-model-feasibility@2");
  });

  test("removes both stale outputs before descriptor-safely reading the model tuple", async () => {
    const fixture = readFixture();
    const directory = await temporaryDirectory();
    const artifactPath = join(directory, "artifact.json");
    const diagnosticPath = join(directory, "diagnostic.json");
    await writeFile(artifactPath, `${JSON.stringify(priorFeasibilityArtifact())}\n`, "utf8");
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
    expect(artifact.extractionPromptVersion).toBe(ONBOARDING_MODEL_VERSIONS_V3.extractionPrompt);
  });

  test.each([
    ["historical V1", ONBOARDING_MODEL_VERSIONS_V1],
    ["historical V2", ONBOARDING_MODEL_VERSIONS_V2],
    ["V1 prompt with V2 schema", {
      ...ONBOARDING_MODEL_VERSIONS_V2,
      extractionPrompt: ONBOARDING_MODEL_VERSIONS_V1.extractionPrompt,
    }],
    ["V2 prompt with V1 schema", {
      ...ONBOARDING_MODEL_VERSIONS_V2,
      extractionSchema: ONBOARDING_MODEL_VERSIONS_V1.extractionSchema,
    }],
    ["V3 prompt with V1 schema", {
      ...ONBOARDING_MODEL_VERSIONS_V3,
      extractionSchema: ONBOARDING_MODEL_VERSIONS_V1.extractionSchema,
    }],
  ])("rejects %s before any model call after removing stale evidence", async (_name, versions) => {
    const directory = await temporaryDirectory();
    const artifactPath = join(directory, "artifact.json");
    const diagnosticPath = join(directory, "diagnostic.json");
    await writeFile(artifactPath, `${JSON.stringify(priorFeasibilityArtifact())}\n`, "utf8");
    await writeFile(diagnosticPath, "stale diagnostic\n", "utf8");
    const borrowedModel = fakeModel(readFixture(), []);
    const extract = vi.fn(borrowedModel.extract);
    const review = vi.fn(borrowedModel.review);

    await expect(runOnboardingFeasibilityForTest({
      artifactPath,
      diagnosticPath,
      fixtureBytes,
      model: Object.freeze({ versions, extract, review }) as unknown as OnboardingModelPort,
      signal: new AbortController().signal,
    })).rejects.toEqual(new OnboardingFeasibilityError());

    expect(extract).not.toHaveBeenCalled();
    expect(review).not.toHaveBeenCalled();
    await expect(stat(artifactPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(JSON.parse(await readFile(diagnosticPath, "utf8"))).toMatchObject({
      schemaVersion: "onboarding-model-feasibility-diagnostic@3",
      stage: "input_validation",
      passingArtifactPresent: false,
    });
  });

  test("removes only an alias-safe stale feasibility artifact", async () => {
    const ordinaryPath = join(await temporaryDirectory(), "stale.json");
    await writeFile(ordinaryPath, `${JSON.stringify(priorFeasibilityArtifact())}\n`, "utf8");
    await removeStaleOnboardingFeasibilityArtifact(ordinaryPath);
    await expect(stat(ordinaryPath)).rejects.toMatchObject({ code: "ENOENT" });

    const originalFixtureBytes = new Uint8Array(await readFile(fixturePath));
    const originalFixtureMode = (await stat(fixturePath)).mode & 0o777;
    const aliasRoot = await temporaryDirectory();
    const symlinkedFixtureDirectory = join(aliasRoot, "fixture-alias");
    await symlink(dirname(fixturePath), symlinkedFixtureDirectory, "dir");
    const hardLinkPath = join(aliasRoot, "fixture-hard-link.json");
    await link(fixturePath, hardLinkPath);

    try {
      for (const candidate of [
        fixturePath,
        join(symlinkedFixtureDirectory, basename(fixturePath)),
        hardLinkPath,
      ]) {
        await expect(removeStaleOnboardingFeasibilityArtifact(candidate))
          .rejects.toEqual(new OnboardingFeasibilityError());
        expect(new Uint8Array(await readFile(fixturePath))).toEqual(originalFixtureBytes);
        expect(new Uint8Array(await readFile(candidate))).toEqual(originalFixtureBytes);
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

});

describe("onboarding feasibility live-model launch gate", () => {
  test("defers legacy feasibility argv before any live callback, removes A, and preserves D", async () => {
    const directory = await temporaryDirectory();
    const artifactPath = join(directory, "artifact.json");
    const diagnosticPath = join(directory, "diagnostic.json");
    await writeFile(artifactPath, "stale passing artifact\n", "utf8");
    await writeFile(diagnosticPath, "historical diagnostic\n", "utf8");
    const runFinalProjectLiveModelGate = vi.fn();

    const result = await runOnboardingFeasibilityEntrypointForTest({
      rawArguments: ["--artifact", artifactPath, "--diagnostic", diagnosticPath],
      runFinalProjectLiveModelGate,
    });

    expect(result).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "onboarding_live_model_gate_deferred\n",
    });
    expect(runFinalProjectLiveModelGate).not.toHaveBeenCalled();
    await expect(access(artifactPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(diagnosticPath, "utf8")).toBe("historical diagnostic\n");
  });

  test("runs the enabled feasibility gate exactly once with resolved paths", async () => {
    const directory = await temporaryDirectory();
    const artifactPath = join(directory, "artifact.json");
    const diagnosticPath = join(directory, "diagnostic.json");
    await writeFile(artifactPath, "stale passing artifact\n", "utf8");
    await writeFile(diagnosticPath, "stale diagnostic\n", "utf8");
    const runFinalProjectLiveModelGate = vi.fn(async () => undefined);

    const result = await runOnboardingFeasibilityEntrypointForTest({
      rawArguments: [
        "--final-project-live-model-gate",
        "--artifact",
        artifactPath,
        "--diagnostic",
        diagnosticPath,
      ],
      runFinalProjectLiveModelGate,
    });

    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(runFinalProjectLiveModelGate).toHaveBeenCalledTimes(1);
    expect(runFinalProjectLiveModelGate).toHaveBeenCalledWith({ artifactPath, diagnosticPath });
    await expect(access(artifactPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(diagnosticPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("contains an enabled feasibility callback failure", async () => {
    const directory = await temporaryDirectory();
    const artifactPath = join(directory, "artifact.json");
    const diagnosticPath = join(directory, "diagnostic.json");
    const runFinalProjectLiveModelGate = vi.fn(async () => {
      throw new Error(PRIVATE_LAUNCH_SENTINEL);
    });

    const result = await runOnboardingFeasibilityEntrypointForTest({
      rawArguments: [
        "--final-project-live-model-gate",
        "--artifact",
        artifactPath,
        "--diagnostic",
        diagnosticPath,
      ],
      runFinalProjectLiveModelGate,
    });

    expect(runFinalProjectLiveModelGate).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "onboarding_model_feasibility_failed\n",
    });
    expect(JSON.stringify(result)).not.toContain(PRIVATE_LAUNCH_SENTINEL);
  });

  test.each([
    ["empty argv", []],
    ["artifact only", ["--artifact", "A"]],
    ["missing diagnostic value", ["--artifact", "A", "--diagnostic"]],
    ["duplicate flag", [
      "--final-project-live-model-gate",
      "--final-project-live-model-gate",
      "--artifact",
      "A",
      "--diagnostic",
      "D",
    ]],
    ["misspelled flag", [
      "--final-project-live-model-gat",
      "--artifact",
      "A",
      "--diagnostic",
      "D",
    ]],
    ["decorated flag", [
      "--final-project-live-model-gate=true",
      "--artifact",
      "A",
      "--diagnostic",
      "D",
    ]],
    ["retry", ["--artifact", "A", "--diagnostic", "D", "--retry"]],
    ["separator", ["--", "--artifact", "A", "--diagnostic", "D"]],
    ["flag after artifact", [
      "--artifact",
      "A",
      "--final-project-live-model-gate",
      "--diagnostic",
      "D",
    ]],
    ["reordered outputs", ["--diagnostic", "D", "--artifact", "A"]],
  ])("rejects malformed %s without touching untrusted paths", async (_name, shape) => {
    const directory = await temporaryDirectory();
    const artifactPath = join(directory, "artifact.json");
    const diagnosticPath = join(directory, "diagnostic.json");
    await writeFile(artifactPath, "untrusted artifact\n", "utf8");
    await writeFile(diagnosticPath, "untrusted diagnostic\n", "utf8");
    const rawArguments = shape.map((value) => value === "A"
      ? artifactPath
      : value === "D" ? diagnosticPath : value);
    const runFinalProjectLiveModelGate = vi.fn();

    expect(() => parseOnboardingFeasibilityArguments(rawArguments))
      .toThrow(OnboardingFeasibilityError);
    const result = await runOnboardingFeasibilityEntrypointForTest({
      rawArguments,
      runFinalProjectLiveModelGate,
    });

    expect(result).toEqual(deferredLaunchResult());
    expect(runFinalProjectLiveModelGate).not.toHaveBeenCalled();
    expect(await readFile(artifactPath, "utf8")).toBe("untrusted artifact\n");
    expect(await readFile(diagnosticPath, "utf8")).toBe("untrusted diagnostic\n");
  });

  test("rejects hostile feasibility argv without invoking traps or getters", async () => {
    const hostileCases: { value: unknown; touched: () => number }[] = [];
    let proxyTouches = 0;
    hostileCases.push({
      value: new Proxy(["--artifact", "a.json", "--diagnostic", "d.json"], {
        getPrototypeOf: () => { proxyTouches += 1; throw new Error(PRIVATE_LAUNCH_SENTINEL); },
        ownKeys: () => { proxyTouches += 1; throw new Error(PRIVATE_LAUNCH_SENTINEL); },
        getOwnPropertyDescriptor: () => {
          proxyTouches += 1;
          throw new Error(PRIVATE_LAUNCH_SENTINEL);
        },
      }),
      touched: () => proxyTouches,
    });
    let getterTouches = 0;
    const getterArray = ["--artifact", "a.json", "--diagnostic", "d.json"];
    Object.defineProperty(getterArray, "1", {
      enumerable: true,
      get: () => { getterTouches += 1; return "a.json"; },
    });
    hostileCases.push({ value: getterArray, touched: () => getterTouches });
    const symbolArray = ["--artifact", "a.json", "--diagnostic", "d.json"];
    Object.defineProperty(symbolArray, Symbol("hostile"), { value: true });
    hostileCases.push({ value: symbolArray, touched: () => 0 });
    hostileCases.push({ value: new Array(4), touched: () => 0 });
    const decoratedPrototype = ["--artifact", "a.json", "--diagnostic", "d.json"];
    Object.setPrototypeOf(decoratedPrototype, null);
    hostileCases.push({ value: decoratedPrototype, touched: () => 0 });

    for (const hostile of hostileCases) {
      const runFinalProjectLiveModelGate = vi.fn();
      const result = await runOnboardingFeasibilityEntrypointForTest({
        rawArguments: hostile.value,
        runFinalProjectLiveModelGate,
      });
      expect(result).toEqual(deferredLaunchResult());
      expect(runFinalProjectLiveModelGate).not.toHaveBeenCalled();
      expect(hostile.touched()).toBe(0);
    }
  });

  test.each(["deferred", "final-project-live-model-gate"] as const)(
    "maps recognized feasibility path failures in %s mode without destructive mutation",
    async (mode) => {
      const expected = mode === "deferred"
        ? deferredLaunchResult()
        : {
            exitCode: 1 as const,
            stdout: "" as const,
            stderr: "onboarding_model_feasibility_failed\n" as const,
          };
      const originalFixture = new Uint8Array(await readFile(fixturePath));

      for (const failure of ["same", "fixture-alias", "extension", "directory"] as const) {
        const directory = await temporaryDirectory();
        let artifactPath = join(directory, "artifact.json");
        let diagnosticPath = join(directory, "diagnostic.json");
        if (failure === "same") diagnosticPath = artifactPath;
        if (failure === "fixture-alias") artifactPath = fixturePath;
        if (failure === "extension") artifactPath = join(directory, "artifact.txt");
        if (failure === "directory") await mkdir(artifactPath);
        else if (failure !== "fixture-alias") await writeFile(artifactPath, "untrusted artifact\n", "utf8");
        if (failure !== "same") await writeFile(diagnosticPath, "historical diagnostic\n", "utf8");
        const runFinalProjectLiveModelGate = vi.fn(async () => {
          throw new Error(PRIVATE_LAUNCH_SENTINEL);
        });
        const prefix = mode === "deferred" ? [] : ["--final-project-live-model-gate"];

        const result = await runOnboardingFeasibilityEntrypointForTest({
          rawArguments: [
            ...prefix,
            "--artifact",
            artifactPath,
            "--diagnostic",
            diagnosticPath,
          ],
          runFinalProjectLiveModelGate,
        });

        expect(result).toEqual(expected);
        expect(JSON.stringify(result)).not.toContain(PRIVATE_LAUNCH_SENTINEL);
        expect(runFinalProjectLiveModelGate).not.toHaveBeenCalled();
        if (failure === "same") {
          expect(await readFile(artifactPath, "utf8")).toBe("untrusted artifact\n");
        } else if (failure === "fixture-alias") {
          expect(new Uint8Array(await readFile(fixturePath))).toEqual(originalFixture);
          expect(await readFile(diagnosticPath, "utf8")).toBe("historical diagnostic\n");
        } else if (failure === "directory") {
          expect((await stat(artifactPath)).isDirectory()).toBe(true);
          expect(await readFile(diagnosticPath, "utf8")).toBe("historical diagnostic\n");
        } else {
          expect(await readFile(artifactPath, "utf8")).toBe("untrusted artifact\n");
          expect(await readFile(diagnosticPath, "utf8")).toBe("historical diagnostic\n");
        }
      }
    },
  );

  test("fails a decorated feasibility subprocess with only the deferred public result", async () => {
    const directory = await temporaryDirectory();
    const artifactPath = join(directory, "artifact.json");
    const diagnosticPath = join(directory, "diagnostic.json");
    await writeFile(artifactPath, "untrusted artifact\n", "utf8");
    await writeFile(diagnosticPath, "historical diagnostic\n", "utf8");

    const result = await failingExecFile(process.execPath, [
      "--import",
      fileURLToPath(TSX_LOADER_URL),
      fileURLToPath(MODULE_URL),
      "--final-project-live-model-gate=true",
      "--artifact",
      artifactPath,
      "--diagnostic",
      diagnosticPath,
    ]);

    expect(result).toMatchObject({
      code: 1,
      stdout: "",
      stderr: "onboarding_live_model_gate_deferred\n",
    });
    expect(await readFile(artifactPath, "utf8")).toBe("untrusted artifact\n");
    expect(await readFile(diagnosticPath, "utf8")).toBe("historical diagnostic\n");
  });

  test("defers the canonical legacy feasibility subprocess and removes only stale A", async () => {
    const directory = await temporaryDirectory();
    const artifactPath = join(directory, "artifact.json");
    const diagnosticPath = join(directory, "diagnostic.json");
    await writeFile(artifactPath, "stale passing artifact\n", "utf8");
    await writeFile(diagnosticPath, "historical diagnostic\n", "utf8");

    const result = await failingExecFile(process.execPath, [
      "--import",
      fileURLToPath(TSX_LOADER_URL),
      fileURLToPath(MODULE_URL),
      "--artifact",
      artifactPath,
      "--diagnostic",
      diagnosticPath,
    ]);

    expect(result).toMatchObject({
      code: 1,
      stdout: "",
      stderr: "onboarding_live_model_gate_deferred\n",
    });
    await expect(access(artifactPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(diagnosticPath, "utf8")).toBe("historical diagnostic\n");
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
      return ONBOARDING_MODEL_VERSIONS_V3;
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

function deferredLaunchResult() {
  return {
    exitCode: 1 as const,
    stdout: "" as const,
    stderr: "onboarding_live_model_gate_deferred\n" as const,
  };
}

async function failingExecFile(file: string, args: readonly string[]): Promise<{
  readonly code: number | string | null;
  readonly stdout: string;
  readonly stderr: string;
}> {
  try {
    await execFileAsync(file, args, { encoding: "utf8" });
  } catch (error) {
    const failure = error as Error & {
      readonly code?: number | string | null;
      readonly stdout?: string;
      readonly stderr?: string;
    };
    return {
      code: failure.code ?? null,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    };
  }
  throw new Error("expected subprocess failure");
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

function priorFeasibilityArtifact(): Record<string, unknown> {
  return {
    schemaVersion: "onboarding-model-feasibility@2",
    fixtureVersion: "onboarding-cases@1",
    fixtureDigest: "0".repeat(64),
    invocationVersion: ONBOARDING_MODEL_VERSIONS_V2.invocation,
    cliVersion: ONBOARDING_MODEL_VERSIONS_V2.cliVersion,
    extractionPromptVersion: ONBOARDING_MODEL_VERSIONS_V2.extractionPrompt,
    reviewPromptVersion: ONBOARDING_MODEL_VERSIONS_V2.reviewPrompt,
    extractionSchemaVersion: ONBOARDING_MODEL_VERSIONS_V2.extractionSchema,
    reviewSchemaVersion: ONBOARDING_MODEL_VERSIONS_V2.reviewSchema,
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
