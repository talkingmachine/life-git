import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  access,
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, test, vi } from "vitest";

import {
  ONBOARDING_CANONICAL_JOURNEY_LIMIT_MS,
  OnboardingJourneyTimingError,
  assertCanonicalOnboardingJourneySession,
  parseOnboardingJourneyTimingArguments,
  readOnboardingCanonicalJourneyFixture,
  removeStaleOnboardingJourneyTimingArtifact,
  runOnboardingJourneyTimingEntrypointForTest,
  runOnboardingJourneyTimingForTest,
} from "../../evals/onboarding-journey-timing";
import {
  ONBOARDING_MODEL_VERSIONS_V1,
  ONBOARDING_MODEL_VERSIONS_V2,
  ONBOARDING_MODEL_VERSIONS_V3,
} from "../../src/application/onboarding-model-versions";
import type { OnboardingSessionState } from "../../src/decision/onboarding-session";

const MODULE_URL = new URL("../../evals/onboarding-journey-timing.ts", import.meta.url);
const TSX_LOADER_URL = new URL("../../node_modules/tsx/dist/loader.mjs", import.meta.url);
const FIXTURE_URL = new URL(
  "../../evals/fixtures/onboarding/canonical-journey.json",
  import.meta.url,
);
const PACKAGE_URL = new URL("../../package.json", import.meta.url);
const PRIVATE_SENTINEL = "PRIVATE_CANONICAL_TRANSCRIPT_SENTINEL_7e4ac1";
const UUIDS = Object.freeze({
  initialParticipantId: "10000000-0000-4000-8000-000000000001",
  companionParticipantId: "10000000-0000-4000-8000-000000000002",
  initialCompletionCommandId: "10000000-0000-4000-8000-000000000003",
  assistantMessageId: "10000000-0000-4000-8000-000000000004",
  extractedCompletionCommandId: "10000000-0000-4000-8000-000000000005",
  messageId: "10000000-0000-4000-8000-000000000006",
});
const ARTIFACT_KEYS = Object.freeze([
  "acceptedFrontierHandoff",
  "artifactDigest",
  "elapsedMs",
  "fixtureDigest",
  "fixtureVersion",
  "limitMs",
  "modelInvocationCount",
  "modelVersions",
  "rawOutputStored",
  "rawPromptStored",
  "schemaVersion",
  "transcriptStored",
]);
const execFileAsync = promisify(execFile);

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })));
});

describe("onboarding canonical journey fixture", () => {
  test("reads the exact one-message self-plus-spouse fixture and freezes owned values", () => {
    const bytes = fixtureBytes();
    const fixture = readOnboardingCanonicalJourneyFixture(bytes);

    expect(fixture).toEqual(validFixture());
    expect(Object.isFrozen(fixture)).toBe(true);
    expect(Object.isFrozen(fixture.ids)).toBe(true);
    expect(Object.isFrozen(fixture.messages)).toBe(true);
    expect(Object.isFrozen(fixture.messages[0])).toBe(true);
    expect(new Set([...Object.values(fixture.ids), fixture.messages[0].messageId]).size).toBe(6);
  });

  test("rejects malformed UTF-8, non-JSON, extra or missing keys, and non-canonical messages", () => {
    const malformedUtf8 = new Uint8Array([0xc3, 0x28]);
    expect(() => readOnboardingCanonicalJourneyFixture(malformedUtf8))
      .toThrow(OnboardingJourneyTimingError);
    expect(() => readOnboardingCanonicalJourneyFixture(new TextEncoder().encode("not json")))
      .toThrow(OnboardingJourneyTimingError);

    const extraRoot = { ...validFixture(), extra: true };
    expectFixtureRejected(extraRoot);
    const missingRoot = { ...validFixture() } as Record<string, unknown>;
    delete missingRoot.messages;
    expectFixtureRejected(missingRoot);
    expectFixtureRejected({ ...validFixture(), schemaVersion: "onboarding-canonical-journey@2" });

    const extraIds = { ...validFixture(), ids: { ...validFixture().ids, extra: UUIDS.messageId } };
    expectFixtureRejected(extraIds);
    const missingIds = { ...validFixture(), ids: { ...validFixture().ids } } as {
      ids: Record<string, unknown>;
    };
    delete missingIds.ids.assistantMessageId;
    expectFixtureRejected(missingIds);

    expectFixtureRejected({ ...validFixture(), messages: [] });
    expectFixtureRejected({ ...validFixture(), messages: [validFixture().messages[0], validFixture().messages[0]] });
    expectFixtureRejected({ ...validFixture(), messages: [null] });
    expectFixtureRejected({
      ...validFixture(),
      messages: [{ ...validFixture().messages[0], role: "assistant" }],
    });
    expectFixtureRejected({
      ...validFixture(),
      messages: [{ ...validFixture().messages[0], extra: true }],
    });
    expectFixtureRejected({
      ...validFixture(),
      messages: [{ ...validFixture().messages[0], text: "   " }],
    });
  });

  test("requires six distinct canonical UUIDs and the exact session text byte bound", () => {
    for (const key of Object.keys(validFixture().ids)) {
      expectFixtureRejected({
        ...validFixture(),
        ids: { ...validFixture().ids, [key]: "not-a-uuid" },
      });
    }
    expectFixtureRejected({
      ...validFixture(),
      ids: { ...validFixture().ids, companionParticipantId: UUIDS.initialParticipantId },
    });
    expectFixtureRejected({
      ...validFixture(),
      messages: [{ ...validFixture().messages[0], messageId: UUIDS.initialParticipantId }],
    });

    const boundary = {
      ...validFixture(),
      messages: [{ ...validFixture().messages[0], text: "x".repeat(8_192) }],
    };
    expect(readOnboardingCanonicalJourneyFixture(encodeFixture(boundary)).messages[0].text)
      .toHaveLength(8_192);
    expectFixtureRejected({
      ...validFixture(),
      messages: [{ ...validFixture().messages[0], text: "x".repeat(8_193) }],
    });
  });

  test("rejects duplicate member names at the root and in nested objects before the model", async () => {
    const serialized = JSON.stringify(validFixture());
    const duplicateFixtures = [
      serialized.replace(
        '{"schemaVersion":',
        '{"schema\\u0056ersion":"onboarding-canonical-journey@1","schemaVersion":',
      ),
      serialized.replace(
        '"ids":{',
        `"ids":{"initialParticipantId":"${UUIDS.initialParticipantId}",`,
      ),
      serialized.replace('"messages":[{', '"messages":[{"role":"user",'),
    ];

    for (const duplicateFixture of duplicateFixtures) {
      const callback = vi.fn(acceptedJourney);
      await expect(runOnboardingJourneyTimingForTest({
        artifactPath: await freshArtifactPath(),
        fixtureBytes: new TextEncoder().encode(duplicateFixture),
        modelVersions: ONBOARDING_MODEL_VERSIONS_V3,
        runCanonicalJourney: callback,
        monotonicNowMs: clock(0, 1),
      })).rejects.toEqual(new OnboardingJourneyTimingError());
      expect(callback).not.toHaveBeenCalled();
    }
  });
});

describe("onboarding journey timing artifact", () => {
  test("accepts exactly 35 seconds, writes the exact closed private artifact, and binds both digests", async () => {
    const directory = await temporaryDirectory();
    const artifactPath = join(directory, "timing.json");
    await writeFile(artifactPath, `stale ${PRIVATE_SENTINEL}\n`, "utf8");
    const bytes = new Uint8Array(await readFile(FIXTURE_URL));
    const runCanonicalJourney = vi.fn(async () => {
      await expect(access(artifactPath)).rejects.toMatchObject({ code: "ENOENT" });
      return {
        acceptedFrontierHandoff: true,
        modelInvocationCount: 2,
        modelVersions: ONBOARDING_MODEL_VERSIONS_V3,
      };
    });

    const artifact = await runOnboardingJourneyTimingForTest({
      artifactPath,
      fixtureBytes: bytes,
      modelVersions: ONBOARDING_MODEL_VERSIONS_V3,
      runCanonicalJourney,
      monotonicNowMs: clock(100.25, 35_100.25),
    });

    expect(ONBOARDING_CANONICAL_JOURNEY_LIMIT_MS).toBe(35_000);
    expect(runCanonicalJourney).toHaveBeenCalledOnce();
    expect(Object.keys(artifact).sort()).toEqual(ARTIFACT_KEYS);
    expect(artifact).toMatchObject({
      schemaVersion: "onboarding-journey-timing@3",
      fixtureVersion: "onboarding-canonical-journey@1",
      fixtureDigest: "f42948b6283f42903df4e576fc08a2cb490bfc7b74db23fb1d91f37bb8ebfaa1",
      modelVersions: ONBOARDING_MODEL_VERSIONS_V3,
      elapsedMs: 35_000,
      limitMs: 35_000,
      acceptedFrontierHandoff: true,
      modelInvocationCount: 2,
      rawPromptStored: false,
      rawOutputStored: false,
      transcriptStored: false,
    });
    expect(artifact.modelVersions).toBe(ONBOARDING_MODEL_VERSIONS_V3);
    const { artifactDigest, ...withoutDigest } = artifact;
    expect(artifactDigest).toBe(sha256(new TextEncoder().encode(canonicalJson(withoutDigest))));
    expect(Object.isFrozen(artifact)).toBe(true);
    expect(Object.isFrozen(artifact.modelVersions)).toBe(true);
    expect(artifact).not.toHaveProperty("cliVersion");

    const serialized = await readFile(artifactPath, "utf8");
    expect(serialized).toBe(`${canonicalJson(artifact)}\n`);
    expect((await stat(artifactPath)).mode & 0o777).toBe(0o600);
    for (const forbidden of [
      PRIVATE_SENTINEL,
      ...Object.values(UUIDS),
      "BEGIN_ONBOARDING_INPUT_JSON",
      "sourceSpan",
      "currentUserMessage",
    ]) expect(serialized).not.toContain(forbidden);
    expect((await readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  test("conservatively ceils a fractional duration at the passing boundary", async () => {
    const artifactPath = await freshArtifactPath();
    const artifact = await runOnboardingJourneyTimingForTest({
      artifactPath,
      fixtureBytes: fixtureBytes(),
      modelVersions: ONBOARDING_MODEL_VERSIONS_V3,
      runCanonicalJourney: acceptedJourney,
      monotonicNowMs: clock(10, 35_009.1),
    });
    expect(artifact.elapsedMs).toBe(35_000);
  });

  test.each([
    ["unaccepted handoff", journeyResult({ acceptedFrontierHandoff: false })],
    ["zero calls", journeyResult({ modelInvocationCount: 0 })],
    ["one call", journeyResult({ modelInvocationCount: 1 })],
    ["three calls", journeyResult({ modelInvocationCount: 3 })],
    ["fractional calls", journeyResult({ modelInvocationCount: 2.5 })],
    ["negative calls", journeyResult({ modelInvocationCount: -2 })],
    ["NaN calls", journeyResult({ modelInvocationCount: Number.NaN })],
    ["infinite calls", journeyResult({ modelInvocationCount: Number.POSITIVE_INFINITY })],
  ])("fails closed for %s, invokes no retry, and removes a stale passing artifact", async (
    _name,
    result,
  ) => {
    const artifactPath = await freshArtifactPath();
    await writeFile(artifactPath, "stale passing artifact\n", "utf8");
    const callback = vi.fn(async () => result);

    await expect(runOnboardingJourneyTimingForTest({
      artifactPath,
      fixtureBytes: fixtureBytes(),
      modelVersions: ONBOARDING_MODEL_VERSIONS_V3,
      runCanonicalJourney: callback,
      monotonicNowMs: clock(0, 1),
    })).rejects.toEqual(new OnboardingJourneyTimingError());

    expect(callback).toHaveBeenCalledOnce();
    await expect(access(artifactPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test.each([
    ["over limit after ceil", [0, 35_000.0001]],
    ["clock rollback", [10, 9]],
    ["negative start", [-1, 0]],
    ["NaN start", [Number.NaN, 1]],
    ["infinite finish", [0, Number.POSITIVE_INFINITY]],
  ] as const)("fails closed for %s", async (_name, values) => {
    const artifactPath = await freshArtifactPath();
    await writeFile(artifactPath, "stale\n", "utf8");

    await expect(runOnboardingJourneyTimingForTest({
      artifactPath,
      fixtureBytes: fixtureBytes(),
      modelVersions: ONBOARDING_MODEL_VERSIONS_V3,
      runCanonicalJourney: acceptedJourney,
      monotonicNowMs: clock(values[0], values[1]),
    })).rejects.toEqual(new OnboardingJourneyTimingError());
    await expect(access(artifactPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("validates the fixture before the model callback and deletes stale evidence", async () => {
    const artifactPath = await freshArtifactPath();
    await writeFile(artifactPath, "stale\n", "utf8");
    const callback = vi.fn(acceptedJourney);

    await expect(runOnboardingJourneyTimingForTest({
      artifactPath,
      fixtureBytes: new TextEncoder().encode('{"schemaVersion":"wrong"}'),
      modelVersions: ONBOARDING_MODEL_VERSIONS_V3,
      runCanonicalJourney: callback,
      monotonicNowMs: clock(0, 1),
    })).rejects.toEqual(new OnboardingJourneyTimingError());

    expect(callback).not.toHaveBeenCalled();
    await expect(access(artifactPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("removes a syntactically valid V2 artifact and writes only the exact V3 artifact", async () => {
    const artifactPath = await freshArtifactPath();
    await writeFile(artifactPath, `${JSON.stringify(legacyTimingArtifact())}\n`, "utf8");

    const artifact = await runOnboardingJourneyTimingForTest({
      artifactPath,
      fixtureBytes: fixtureBytes(),
      modelVersions: ONBOARDING_MODEL_VERSIONS_V3,
      runCanonicalJourney: acceptedJourney,
      monotonicNowMs: clock(0, 1),
    });

    expect(artifact.schemaVersion).toBe("onboarding-journey-timing@3");
    const serialized = await readFile(artifactPath, "utf8");
    expect(serialized).not.toContain("onboarding-journey-timing@2");
    expect(JSON.parse(serialized)).not.toHaveProperty("cliVersion");
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
  ])("rejects callback result lineage %s and leaves no passing artifact", async (_name, modelVersions) => {
    const artifactPath = await freshArtifactPath();
    await writeFile(artifactPath, `${JSON.stringify(legacyTimingArtifact())}\n`, "utf8");
    const callback = vi.fn(async () => journeyResult({ modelVersions }));

    await expect(runOnboardingJourneyTimingForTest({
      artifactPath,
      fixtureBytes: fixtureBytes(),
      modelVersions: ONBOARDING_MODEL_VERSIONS_V3,
      runCanonicalJourney: callback,
      monotonicNowMs: clock(0, 1),
    })).rejects.toEqual(new OnboardingJourneyTimingError());

    expect(callback).toHaveBeenCalledOnce();
    await expect(access(artifactPath)).rejects.toMatchObject({ code: "ENOENT" });
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
  ])("rejects input lineage %s before reading time or running the journey", async (
    _name,
    modelVersions,
  ) => {
    const artifactPath = await freshArtifactPath();
    await writeFile(artifactPath, `${JSON.stringify(legacyTimingArtifact())}\n`, "utf8");
    const monotonicNowMs = vi.fn(() => 0);
    const runCanonicalJourney = vi.fn(acceptedJourney);

    await expect(runOnboardingJourneyTimingForTest({
      artifactPath,
      fixtureBytes: fixtureBytes(),
      modelVersions,
      runCanonicalJourney,
      monotonicNowMs,
    })).rejects.toEqual(new OnboardingJourneyTimingError());

    expect(monotonicNowMs).not.toHaveBeenCalled();
    expect(runCanonicalJourney).not.toHaveBeenCalled();
    await expect(stat(artifactPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("rejects hostile callback result roots without invoking a getter or Proxy trap", async () => {
    let getterCalls = 0;
    const accessorResult = journeyResult();
    Object.defineProperty(accessorResult, "modelVersions", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return ONBOARDING_MODEL_VERSIONS_V2;
      },
    });
    const symbolResult = Object.assign(journeyResult(), { [Symbol("hidden")]: true });
    const nonEnumerableResult = journeyResult();
    Object.defineProperty(nonEnumerableResult, "modelInvocationCount", {
      enumerable: false,
      value: 2,
    });
    const customPrototypeResult = Object.assign(Object.create({ inherited: true }), journeyResult());
    let proxyTrapCalls = 0;
    const proxyResult = new Proxy(journeyResult(), {
      getPrototypeOf: () => {
        proxyTrapCalls += 1;
        throw new Error("result_proxy_trap");
      },
      ownKeys: () => {
        proxyTrapCalls += 1;
        throw new Error("result_proxy_trap");
      },
      getOwnPropertyDescriptor: () => {
        proxyTrapCalls += 1;
        throw new Error("result_proxy_trap");
      },
    });

    for (const result of [
      accessorResult,
      symbolResult,
      nonEnumerableResult,
      customPrototypeResult,
      proxyResult,
    ]) {
      await expect(runOnboardingJourneyTimingForTest({
        artifactPath: await freshArtifactPath(),
        fixtureBytes: fixtureBytes(),
        modelVersions: ONBOARDING_MODEL_VERSIONS_V3,
        runCanonicalJourney: async () => result,
        monotonicNowMs: clock(0, 1),
      })).rejects.toEqual(new OnboardingJourneyTimingError());
    }
    expect(getterCalls).toBe(0);
    expect(proxyTrapCalls).toBe(0);
  });

  test("rejects hostile nested model tuples without invoking a getter or Proxy trap", async () => {
    let getterCalls = 0;
    const accessorTuple = { ...ONBOARDING_MODEL_VERSIONS_V3 };
    Object.defineProperty(accessorTuple, "extractionPrompt", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return ONBOARDING_MODEL_VERSIONS_V3.extractionPrompt;
      },
    });
    const symbolTuple = Object.assign(
      { ...ONBOARDING_MODEL_VERSIONS_V3 },
      { [Symbol("hidden")]: true },
    );
    const nonEnumerableTuple = { ...ONBOARDING_MODEL_VERSIONS_V3 };
    Object.defineProperty(nonEnumerableTuple, "reviewSchema", {
      enumerable: false,
      value: ONBOARDING_MODEL_VERSIONS_V3.reviewSchema,
    });
    const customPrototypeTuple = Object.assign(
      Object.create({ inherited: true }),
      ONBOARDING_MODEL_VERSIONS_V3,
    );
    let proxyTrapCalls = 0;
    const proxyTuple = new Proxy({ ...ONBOARDING_MODEL_VERSIONS_V3 }, {
      getPrototypeOf: () => {
        proxyTrapCalls += 1;
        throw new Error("versions_proxy_trap");
      },
      ownKeys: () => {
        proxyTrapCalls += 1;
        throw new Error("versions_proxy_trap");
      },
      getOwnPropertyDescriptor: () => {
        proxyTrapCalls += 1;
        throw new Error("versions_proxy_trap");
      },
    });

    for (const modelVersions of [
      accessorTuple,
      symbolTuple,
      nonEnumerableTuple,
      customPrototypeTuple,
      proxyTuple,
    ]) {
      const artifactPath = await freshArtifactPath();
      await writeFile(artifactPath, `${JSON.stringify(legacyTimingArtifact())}\n`, "utf8");
      const monotonicNowMs = vi.fn(() => 0);
      const runCanonicalJourney = vi.fn(acceptedJourney);
      await expect(runOnboardingJourneyTimingForTest({
        artifactPath,
        fixtureBytes: fixtureBytes(),
        modelVersions,
        runCanonicalJourney,
        monotonicNowMs,
      })).rejects.toEqual(new OnboardingJourneyTimingError());
      expect(monotonicNowMs).not.toHaveBeenCalled();
      expect(runCanonicalJourney).not.toHaveBeenCalled();
      await expect(stat(artifactPath)).rejects.toMatchObject({ code: "ENOENT" });
    }
    expect(getterCalls).toBe(0);
    expect(proxyTrapCalls).toBe(0);
  });

  test("sanitizes callback and filesystem failures and leaves no temporary passing artifact", async () => {
    const artifactPath = await freshArtifactPath();
    const callback = vi.fn(async () => {
      throw new Error(`${PRIVATE_SENTINEL} secret model output`);
    });
    const caught = await runOnboardingJourneyTimingForTest({
      artifactPath,
      fixtureBytes: fixtureBytes(),
      modelVersions: ONBOARDING_MODEL_VERSIONS_V3,
      runCanonicalJourney: callback,
      monotonicNowMs: clock(0, 1),
    }).catch((error: unknown) => error);
    expect(caught).toEqual(new OnboardingJourneyTimingError());
    expect(String(caught)).not.toContain(PRIVATE_SENTINEL);
    expect(callback).toHaveBeenCalledOnce();
    await expect(access(artifactPath)).rejects.toMatchObject({ code: "ENOENT" });

    const blockedParent = join(await temporaryDirectory(), "not-a-directory");
    await writeFile(blockedParent, "block", "utf8");
    const blockedArtifact = join(blockedParent, "timing.json");
    const filesystemFailure = await runOnboardingJourneyTimingForTest({
      artifactPath: blockedArtifact,
      fixtureBytes: fixtureBytes(),
      modelVersions: ONBOARDING_MODEL_VERSIONS_V3,
      runCanonicalJourney: acceptedJourney,
      monotonicNowMs: clock(0, 1),
    }).catch((error: unknown) => error);
    expect(filesystemFailure).toEqual(new OnboardingJourneyTimingError());
    expect(await readFile(blockedParent, "utf8")).toBe("block");
  });

  test("does not retry after a post-journey atomic rename failure and removes its temporary file", async () => {
    const directory = await temporaryDirectory();
    const artifactPath = join(directory, "timing.json");
    const callback = vi.fn(async () => {
      await mkdir(artifactPath);
      return acceptedJourney();
    });

    await expect(runOnboardingJourneyTimingForTest({
      artifactPath,
      fixtureBytes: fixtureBytes(),
      modelVersions: ONBOARDING_MODEL_VERSIONS_V3,
      runCanonicalJourney: callback,
      monotonicNowMs: clock(0, 1),
    })).rejects.toEqual(new OnboardingJourneyTimingError());

    expect(callback).toHaveBeenCalledOnce();
    await expect(readFile(artifactPath, "utf8")).rejects.toBeDefined();
    expect((await readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  test("rejects an artifact path resolving to the canonical fixture before touching it", async () => {
    const fixturePath = fileURLToPath(FIXTURE_URL);
    const originalBytes = new Uint8Array(await readFile(fixturePath));
    const originalMode = (await stat(fixturePath)).mode & 0o777;
    const callback = vi.fn(acceptedJourney);

    try {
      await expect(runOnboardingJourneyTimingForTest({
        artifactPath: join(fixturePath, "..", "canonical-journey.json"),
        fixtureBytes: originalBytes,
        modelVersions: ONBOARDING_MODEL_VERSIONS_V3,
        runCanonicalJourney: callback,
        monotonicNowMs: clock(0, 1),
      })).rejects.toEqual(new OnboardingJourneyTimingError());
      expect(callback).not.toHaveBeenCalled();
      expect(new Uint8Array(await readFile(fixturePath))).toEqual(originalBytes);
      expect((await stat(fixturePath)).mode & 0o777).toBe(originalMode);
    } finally {
      const currentBytes = await readFile(fixturePath).catch(() => undefined);
      if (currentBytes === undefined || !Buffer.from(currentBytes).equals(Buffer.from(originalBytes))) {
        await writeFile(fixturePath, originalBytes);
      }
      if (((await stat(fixturePath)).mode & 0o777) !== originalMode) {
        await chmod(fixturePath, originalMode);
      }
    }
  });

  test("rejects the canonical fixture through a symlinked parent before touching it", async () => {
    const fixturePath = fileURLToPath(FIXTURE_URL);
    const originalBytes = new Uint8Array(await readFile(fixturePath));
    const originalMode = (await stat(fixturePath)).mode & 0o777;
    const aliasRoot = await temporaryDirectory();
    const aliasedFixtureDirectory = join(aliasRoot, "fixture-alias");
    await symlink(dirname(fixturePath), aliasedFixtureDirectory, "dir");
    const callback = vi.fn(acceptedJourney);

    try {
      await expect(runOnboardingJourneyTimingForTest({
        artifactPath: join(aliasedFixtureDirectory, "canonical-journey.json"),
        fixtureBytes: originalBytes,
        modelVersions: ONBOARDING_MODEL_VERSIONS_V3,
        runCanonicalJourney: callback,
        monotonicNowMs: clock(0, 1),
      })).rejects.toEqual(new OnboardingJourneyTimingError());
      expect(callback).not.toHaveBeenCalled();
      expect(new Uint8Array(await readFile(fixturePath))).toEqual(originalBytes);
      expect((await stat(fixturePath)).mode & 0o777).toBe(originalMode);
    } finally {
      const currentBytes = await readFile(fixturePath).catch(() => undefined);
      if (currentBytes === undefined || !Buffer.from(currentBytes).equals(Buffer.from(originalBytes))) {
        await writeFile(fixturePath, originalBytes);
      }
      if (((await stat(fixturePath)).mode & 0o777) !== originalMode) {
        await chmod(fixturePath, originalMode);
      }
    }
  });

  test("rejects a hard-link alias of the canonical fixture by inode identity", async () => {
    const fixturePath = fileURLToPath(FIXTURE_URL);
    const originalBytes = new Uint8Array(await readFile(fixturePath));
    const originalIdentity = await stat(fixturePath);
    const artifactPath = join(await temporaryDirectory(), "timing.json");
    await link(fixturePath, artifactPath);
    const callback = vi.fn(acceptedJourney);

    await expect(runOnboardingJourneyTimingForTest({
      artifactPath,
      fixtureBytes: originalBytes,
      modelVersions: ONBOARDING_MODEL_VERSIONS_V3,
      runCanonicalJourney: callback,
      monotonicNowMs: clock(0, 1),
    })).rejects.toEqual(new OnboardingJourneyTimingError());

    expect(callback).not.toHaveBeenCalled();
    expect(new Uint8Array(await readFile(fixturePath))).toEqual(originalBytes);
    expect(new Uint8Array(await readFile(artifactPath))).toEqual(originalBytes);
    const aliasIdentity = await stat(artifactPath);
    expect([aliasIdentity.dev, aliasIdentity.ino])
      .toEqual([originalIdentity.dev, originalIdentity.ino]);
  });

  test("removes only an alias-safe stale journey timing artifact", async () => {
    const ordinaryPath = await freshArtifactPath();
    await writeFile(ordinaryPath, `${JSON.stringify(legacyTimingArtifact())}\n`, "utf8");
    await removeStaleOnboardingJourneyTimingArtifact(ordinaryPath);
    await expect(stat(ordinaryPath)).rejects.toMatchObject({ code: "ENOENT" });

    const fixturePath = fileURLToPath(FIXTURE_URL);
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
        join(symlinkedFixtureDirectory, "canonical-journey.json"),
        hardLinkPath,
      ]) {
        await expect(removeStaleOnboardingJourneyTimingArtifact(candidate))
          .rejects.toEqual(new OnboardingJourneyTimingError());
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

  test("keeps supporting a new nested artifact leaf below a symlinked existing parent", async () => {
    const realOutputRoot = await temporaryDirectory();
    const aliasRoot = await temporaryDirectory();
    const aliasedOutputRoot = join(aliasRoot, "output-alias");
    await symlink(realOutputRoot, aliasedOutputRoot, "dir");
    const artifactPath = join(aliasedOutputRoot, "new", "nested", "timing.json");

    const artifact = await runOnboardingJourneyTimingForTest({
      artifactPath,
      fixtureBytes: fixtureBytes(),
      modelVersions: ONBOARDING_MODEL_VERSIONS_V3,
      runCanonicalJourney: acceptedJourney,
      monotonicNowMs: clock(0, 1),
    });

    expect(JSON.parse(await readFile(artifactPath, "utf8"))).toEqual(artifact);
    expect(await readFile(join(realOutputRoot, "new", "nested", "timing.json"), "utf8"))
      .toBe(`${canonicalJson(artifact)}\n`);
  });
});

describe("canonical timing session oracle", () => {
  test("accepts only the exact 44 model-origin values plus the two remote N/A fields", () => {
    const fixture = validFixture();
    const session = canonicalSession(fixture);

    expect(canonicalFieldStates(fixture)).toHaveLength(46);
    expect(() => assertCanonicalOnboardingJourneySession(
      session,
      readOnboardingCanonicalJourneyFixture(encodeFixture(fixture)),
      canonicalCallbackReads(),
    )).not.toThrow();
  });

  test.each([
    ["field order", (fields: Record<string, unknown>[]) => {
      [fields[0], fields[1]] = [fields[1]!, fields[0]!];
    }],
    ["missing field", (fields: Record<string, unknown>[]) => {
      fields.pop();
    }],
    ["extra field", (fields: Record<string, unknown>[]) => {
      fields.push({ ...fields.at(-1), fieldId: "city_preferences.extra.target" });
    }],
    ["extra field-state key", (fields: Record<string, unknown>[]) => {
      fields[0]!.extra = true;
    }],
    ["self value", (fields: Record<string, unknown>[]) => {
      fields.find(({ fieldId }) => fieldId === `participants.${UUIDS.initialParticipantId}.citizenships`)!
        .normalizedValue = ["RS"];
    }],
    ["spouse value", (fields: Record<string, unknown>[]) => {
      fields.find(({ fieldId }) => fieldId === `participants.${UUIDS.companionParticipantId}.monthly_income`)!
        .normalizedValue = { amount: "1", currency: "EUR", basis: "net" };
    }],
    ["preference value", (fields: Record<string, unknown>[]) => {
      fields.find(({ fieldId }) => fieldId === "city_preferences.fixed_broadband.importance")!
        .normalizedValue = 4;
    }],
    ["model origin", (fields: Record<string, unknown>[]) => {
      fields.find(({ fieldId }) => fieldId === "savings")!.origin = "manual";
    }],
    ["participants overwrite provenance", (fields: Record<string, unknown>[]) => {
      const participants = fields.find(({ fieldId }) => fieldId === "participants")!;
      participants.overwrite = {
        ...(participants.overwrite as Record<string, unknown>),
        reviewState: "model_overwrite_confirmed",
      };
    }],
    ["remote applicability", (fields: Record<string, unknown>[]) => {
      const remote = fields.find(({ fieldId }) =>
        fieldId === `participants.${UUIDS.initialParticipantId}.remote_continuation`)!;
      Object.assign(remote, {
        applicability: "required",
        normalizedValue: "no",
        origin: "model",
      });
    }],
  ])("rejects canonical %s mutation", (_name, mutate) => {
    const fixture = validFixture();
    const session = canonicalSession(fixture);
    const fields = session.draft.fields as unknown as Record<string, unknown>[];
    mutate(fields);

    expect(() => assertCanonicalOnboardingJourneySession(
      session,
      readOnboardingCanonicalJourneyFixture(encodeFixture(fixture)),
      canonicalCallbackReads(),
    )).toThrow(OnboardingJourneyTimingError);
  });
});

describe("onboarding journey timing live-model launch gate", () => {
  test.each([
    ["direct", ["--artifact", "artifact.json"]],
    ["package", ["--", "--artifact", "artifact.json"]],
  ])("defers %s legacy timing argv after stale cleanup", async (_name, rawArguments) => {
    const artifactPath = join(await temporaryDirectory(), "artifact.json");
    await writeFile(artifactPath, "stale passing artifact\n", "utf8");
    const runFinalProjectLiveModelGate = vi.fn();
    const args = rawArguments.map((value) => value === "artifact.json" ? artifactPath : value);

    const result = await runOnboardingJourneyTimingEntrypointForTest({
      rawArguments: args,
      runFinalProjectLiveModelGate,
    });

    expect(result).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "onboarding_live_model_gate_deferred\n",
    });
    expect(runFinalProjectLiveModelGate).not.toHaveBeenCalled();
    await expect(access(artifactPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test.each([
    ["direct", false],
    ["package", true],
  ])("runs the enabled %s timing gate once with the resolved path", async (_name, packaged) => {
    const artifactPath = join(await temporaryDirectory(), "artifact.json");
    await writeFile(artifactPath, "stale passing artifact\n", "utf8");
    const runFinalProjectLiveModelGate = vi.fn(async () => undefined);
    const body = ["--final-project-live-model-gate", "--artifact", artifactPath];

    const result = await runOnboardingJourneyTimingEntrypointForTest({
      rawArguments: packaged ? ["--", ...body] : body,
      runFinalProjectLiveModelGate,
    });

    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(runFinalProjectLiveModelGate).toHaveBeenCalledTimes(1);
    expect(runFinalProjectLiveModelGate).toHaveBeenCalledWith(artifactPath);
    await expect(access(artifactPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test.each([
    ["direct", false],
    ["package", true],
  ])("contains an enabled %s timing callback rejection", async (_name, packaged) => {
    const artifactPath = join(await temporaryDirectory(), "artifact.json");
    await writeFile(artifactPath, "stale passing artifact\n", "utf8");
    const observed: string[] = [];
    const runFinalProjectLiveModelGate = vi.fn(async (canonicalArtifactPath: string) => {
      observed.push(canonicalArtifactPath);
      throw new Error(PRIVATE_SENTINEL);
    });
    const body = ["--final-project-live-model-gate", "--artifact", artifactPath];

    const result = await runOnboardingJourneyTimingEntrypointForTest({
      rawArguments: packaged ? ["--", ...body] : body,
      runFinalProjectLiveModelGate,
    });

    expect(observed).toEqual([artifactPath]);
    expect(runFinalProjectLiveModelGate).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "onboarding_journey_timing_failed\n",
    });
    expect(JSON.stringify(result)).not.toContain(PRIVATE_SENTINEL);
    await expect(access(artifactPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("parses and freezes only the exact direct and package launch shapes", () => {
    const legacyDirect = parseOnboardingJourneyTimingArguments(["--artifact", "artifact.json"]);
    const legacyPackage = parseOnboardingJourneyTimingArguments(["--", "--artifact", "artifact.json"]);
    const enabledDirect = parseOnboardingJourneyTimingArguments([
      "--final-project-live-model-gate",
      "--artifact",
      "artifact.json",
    ]);
    const enabledPackage = parseOnboardingJourneyTimingArguments([
      "--",
      "--final-project-live-model-gate",
      "--artifact",
      "artifact.json",
    ]);

    expect(legacyDirect).toEqual({ mode: "deferred", artifactPath: "artifact.json" });
    expect(legacyPackage).toEqual({ mode: "deferred", artifactPath: "artifact.json" });
    expect(enabledDirect).toEqual({
      mode: "final-project-live-model-gate",
      artifactPath: "artifact.json",
    });
    expect(enabledPackage).toEqual({
      mode: "final-project-live-model-gate",
      artifactPath: "artifact.json",
    });
    expect([
      legacyDirect,
      legacyPackage,
      enabledDirect,
      enabledPackage,
    ].every(Object.isFrozen)).toBe(true);
  });

  test.each([
    ["empty", []],
    ["missing artifact value", ["--artifact"]],
    ["missing enabled artifact value", ["--final-project-live-model-gate", "--artifact"]],
    ["duplicate flag", [
      "--final-project-live-model-gate",
      "--final-project-live-model-gate",
      "--artifact",
      "A",
    ]],
    ["misspelled flag", ["--final-project-live-model-gat", "--artifact", "A"]],
    ["decorated flag", ["--final-project-live-model-gate=true", "--artifact", "A"]],
    ["reordered flag", ["--artifact", "A", "--final-project-live-model-gate"]],
    ["extra retry", ["--artifact", "A", "--retry"]],
    ["extra artifact", ["--artifact", "A", "--artifact", "A"]],
    ["repeated separator", ["--", "--", "--artifact", "A"]],
    ["misplaced separator", ["--artifact", "A", "--"]],
    ["separator after flag", ["--final-project-live-model-gate", "--", "--artifact", "A"]],
  ])("rejects malformed timing argv: %s", async (_name, shape) => {
    const artifactPath = join(await temporaryDirectory(), "artifact.json");
    await writeFile(artifactPath, "untrusted artifact\n", "utf8");
    const rawArguments = shape.map((value) => value === "A" ? artifactPath : value);
    const runFinalProjectLiveModelGate = vi.fn();

    expect(() => parseOnboardingJourneyTimingArguments(rawArguments))
      .toThrow(OnboardingJourneyTimingError);
    const result = await runOnboardingJourneyTimingEntrypointForTest({
      rawArguments,
      runFinalProjectLiveModelGate,
    });

    expect(result).toEqual(deferredTimingLaunchResult());
    expect(runFinalProjectLiveModelGate).not.toHaveBeenCalled();
    expect(await readFile(artifactPath, "utf8")).toBe("untrusted artifact\n");
  });

  test("rejects hostile timing argv without invoking traps or getters", async () => {
    const hostileCases: { value: unknown; touched: () => number }[] = [];
    let proxyTouches = 0;
    hostileCases.push({
      value: new Proxy(["--artifact", "artifact.json"], {
        getPrototypeOf: () => { proxyTouches += 1; throw new Error(PRIVATE_SENTINEL); },
        ownKeys: () => { proxyTouches += 1; throw new Error(PRIVATE_SENTINEL); },
        getOwnPropertyDescriptor: () => { proxyTouches += 1; throw new Error(PRIVATE_SENTINEL); },
      }),
      touched: () => proxyTouches,
    });
    let getterTouches = 0;
    const getterArray = ["--artifact", "artifact.json"];
    Object.defineProperty(getterArray, "1", {
      enumerable: true,
      get: () => { getterTouches += 1; return "artifact.json"; },
    });
    hostileCases.push({ value: getterArray, touched: () => getterTouches });
    const symbolArray = ["--artifact", "artifact.json"];
    Object.defineProperty(symbolArray, Symbol("hostile"), { value: true });
    hostileCases.push({ value: symbolArray, touched: () => 0 });
    hostileCases.push({ value: new Array(2), touched: () => 0 });
    const decoratedPrototype = ["--artifact", "artifact.json"];
    Object.setPrototypeOf(decoratedPrototype, null);
    hostileCases.push({ value: decoratedPrototype, touched: () => 0 });

    for (const hostile of hostileCases) {
      const runFinalProjectLiveModelGate = vi.fn();
      const result = await runOnboardingJourneyTimingEntrypointForTest({
        rawArguments: hostile.value,
        runFinalProjectLiveModelGate,
      });
      expect(result).toEqual(deferredTimingLaunchResult());
      expect(runFinalProjectLiveModelGate).not.toHaveBeenCalled();
      expect(hostile.touched()).toBe(0);
    }
  });

  test.each([
    ["deferred", false],
    ["deferred", true],
    ["final-project-live-model-gate", false],
    ["final-project-live-model-gate", true],
  ] as const)(
    "maps %s timing path failures for package=%s without destructive mutation",
    async (mode, packaged) => {
      const expected = mode === "deferred"
        ? deferredTimingLaunchResult()
        : {
            exitCode: 1 as const,
            stdout: "" as const,
            stderr: "onboarding_journey_timing_failed\n" as const,
          };
      const fixturePath = fileURLToPath(FIXTURE_URL);
      const originalFixture = new Uint8Array(await readFile(fixturePath));

      for (const failure of ["fixture-alias", "extension", "directory"] as const) {
        const directory = await temporaryDirectory();
        let artifactPath = join(directory, "artifact.json");
        if (failure === "fixture-alias") artifactPath = fixturePath;
        if (failure === "extension") artifactPath = join(directory, "artifact.txt");
        if (failure === "directory") await mkdir(artifactPath);
        else if (failure !== "fixture-alias") await writeFile(artifactPath, "untrusted artifact\n", "utf8");
        const runFinalProjectLiveModelGate = vi.fn(async () => {
          throw new Error(PRIVATE_SENTINEL);
        });
        const body = [
          ...(mode === "deferred" ? [] : ["--final-project-live-model-gate"]),
          "--artifact",
          artifactPath,
        ];

        const result = await runOnboardingJourneyTimingEntrypointForTest({
          rawArguments: packaged ? ["--", ...body] : body,
          runFinalProjectLiveModelGate,
        });

        expect(result).toEqual(expected);
        expect(JSON.stringify(result)).not.toContain(PRIVATE_SENTINEL);
        expect(runFinalProjectLiveModelGate).not.toHaveBeenCalled();
        if (failure === "fixture-alias") {
          expect(new Uint8Array(await readFile(fixturePath))).toEqual(originalFixture);
        } else if (failure === "directory") {
          expect((await stat(artifactPath)).isDirectory()).toBe(true);
        } else {
          expect(await readFile(artifactPath, "utf8")).toBe("untrusted artifact\n");
        }
      }
    },
  );

  test("fails a decorated timing subprocess with only the deferred public result", async () => {
    const artifactPath = join(await temporaryDirectory(), "artifact.json");
    await writeFile(artifactPath, "untrusted artifact\n", "utf8");

    const result = await failingExecFile(process.execPath, [
      "--import",
      fileURLToPath(TSX_LOADER_URL),
      fileURLToPath(MODULE_URL),
      "--final-project-live-model-gate=true",
      "--artifact",
      artifactPath,
    ]);

    expect(result).toMatchObject({
      code: 1,
      stdout: "",
      stderr: "onboarding_live_model_gate_deferred\n",
    });
    expect(await readFile(artifactPath, "utf8")).toBe("untrusted artifact\n");
  });

  test.each([
    ["direct", false],
    ["package", true],
  ])("defers the canonical legacy %s timing subprocess and removes stale A", async (
    _name,
    packaged,
  ) => {
    const artifactPath = join(await temporaryDirectory(), "artifact.json");
    await writeFile(artifactPath, "stale passing artifact\n", "utf8");
    const legacyArguments = ["--artifact", artifactPath];

    const result = await failingExecFile(process.execPath, [
      "--import",
      fileURLToPath(TSX_LOADER_URL),
      fileURLToPath(MODULE_URL),
      ...(packaged ? ["--", ...legacyArguments] : legacyArguments),
    ]);

    expect(result).toMatchObject({
      code: 1,
      stdout: "",
      stderr: "onboarding_live_model_gate_deferred\n",
    });
    await expect(access(artifactPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("onboarding journey timing CLI boundary", () => {

  test("pins the package command, tracked fixture, and a no-research production boundary", async () => {
    const packageJson = JSON.parse(await readFile(PACKAGE_URL, "utf8")) as {
      scripts?: Record<string, unknown>;
    };
    expect(packageJson.scripts?.["eval:onboarding-journey-timing"])
      .toBe("node --import tsx evals/onboarding-journey-timing.ts");

    const trackedBytes = new Uint8Array(await readFile(FIXTURE_URL));
    const fixture = readOnboardingCanonicalJourneyFixture(trackedBytes);
    expect(fixture.messages[0].text).toMatch(/супруг/u);
    expect(fixture.messages[0].text).toMatch(/граждан/u);

    const source = await readFile(MODULE_URL, "utf8");
    expect(source).toContain('openEvidenceDatabase(":memory:")');
    expect(source).toContain("createCodexOnboardingModel(getCodexCliModelAdapter())");
    expect(source).toContain("openPlaceFrontierStreamResponse");
    expect(source).toContain("createPlaceFrontierStreamHandoff");
    expect(source).toContain('new URL("./fixtures/onboarding/canonical-journey.json", import.meta.url)');
    expect(source).toContain('open(temporaryPath, "wx", 0o600)');
    expect(source).toContain("await handle.sync()");
    expect(source).toContain("await handle.close()");
    expect(source).toContain("await rename(temporaryPath, artifactPath)");
    expect(source).not.toMatch(/\.runPlaceFrontier\s*\(/u);
    expect(source).not.toContain("runCurrentEvidence");
    expect(source).not.toContain("OfficialSource");
    expect(source).not.toContain("--fixture");
    expect(source).not.toContain("process.stdin");
    expect(source).not.toMatch(/\bfetch\s*\(/u);
    expect(source).not.toMatch(/\bwindow\./u);
  });

  test("imports the test seam from /private/tmp without production filesystem access", async () => {
    const externalCwd = await mkdtemp(join("/private/tmp", "onboarding-timing-import-"));
    temporaryDirectories.push(externalCwd);
    const script = [
      `const timing = await import(${JSON.stringify(MODULE_URL.href)});`,
      "if (typeof timing.runOnboardingJourneyTimingForTest !== 'function') throw new Error('missing seam');",
      "process.stdout.write('imported');",
    ].join("\n");

    const result = await execFileAsync(process.execPath, [
      "--import",
      fileURLToPath(TSX_LOADER_URL),
      "--input-type=module",
      "--eval",
      script,
    ], {
      cwd: externalCwd,
      encoding: "utf8",
    });

    expect(result.stdout).toBe("imported");
    expect(result.stderr).toBe("");
  });
});

function validFixture() {
  return {
    schemaVersion: "onboarding-canonical-journey@1" as const,
    ids: {
      initialParticipantId: UUIDS.initialParticipantId,
      companionParticipantId: UUIDS.companionParticipantId,
      initialCompletionCommandId: UUIDS.initialCompletionCommandId,
      assistantMessageId: UUIDS.assistantMessageId,
      extractedCompletionCommandId: UUIDS.extractedCompletionCommandId,
    },
    messages: [{
      messageId: UUIDS.messageId,
      role: "user" as const,
      text: `Я переезжаю с супругой. ${PRIVATE_SENTINEL}`,
    }] as const,
  };
}

function fixtureBytes(): Uint8Array {
  return encodeFixture(validFixture());
}

function encodeFixture(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function expectFixtureRejected(value: unknown): void {
  expect(() => readOnboardingCanonicalJourneyFixture(encodeFixture(value)))
    .toThrow(OnboardingJourneyTimingError);
}

async function acceptedJourney() {
  return journeyResult();
}

function journeyResult(overrides: Record<string, unknown> = {}): {
  acceptedFrontierHandoff: boolean;
  modelInvocationCount: number;
  modelVersions: unknown;
} & Record<string, unknown> {
  return {
    acceptedFrontierHandoff: true,
    modelInvocationCount: 2,
    modelVersions: ONBOARDING_MODEL_VERSIONS_V3,
    ...overrides,
  };
}

function clock(...values: readonly number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index];
    index += 1;
    if (value === undefined) throw new Error("clock exhausted");
    return value;
  };
}

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "onboarding-journey-timing-test-"));
  temporaryDirectories.push(path);
  return path;
}

async function freshArtifactPath(): Promise<string> {
  return join(await temporaryDirectory(), "timing.json");
}

function deferredTimingLaunchResult() {
  return {
    exitCode: 1 as const,
    stdout: "" as const,
    stderr: "onboarding_live_model_gate_deferred\n" as const,
  };
}

async function failingExecFile(file: string, args: string[]): Promise<{
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

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite canonical value");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  throw new Error("unsupported canonical value");
}

function legacyTimingArtifact(): Record<string, unknown> {
  return {
    schemaVersion: "onboarding-journey-timing@2",
    fixtureVersion: "onboarding-canonical-journey@1",
    fixtureDigest: "0".repeat(64),
    modelVersions: ONBOARDING_MODEL_VERSIONS_V2,
    elapsedMs: 1,
    limitMs: 35_000,
    acceptedFrontierHandoff: true,
    modelInvocationCount: 2,
    rawPromptStored: false,
    rawOutputStored: false,
    transcriptStored: false,
    artifactDigest: "1".repeat(64),
  };
}

function canonicalCallbackReads() {
  return {
    companionParticipantIdReads: 1,
    assistantMessageIdReads: 1,
    extractedCompletionCommandIdReads: 1,
  } as const;
}

function canonicalSession(fixture: ReturnType<typeof validFixture>): OnboardingSessionState {
  return {
    sessionVersion: "onboarding-session@1",
    completionCommandId: fixture.ids.extractedCompletionCommandId,
    messages: [
      fixture.messages[0],
      {
        messageId: fixture.ids.assistantMessageId,
        role: "assistant",
        text: "Спасибо, ответы готовы к проверке.",
      },
    ],
    draft: {
      schemaVersion: "onboarding-draft@1",
      fields: canonicalFieldStates(fixture),
    },
    descriptorBindings: {
      self: fixture.ids.initialParticipantId,
      "companion.0": fixture.ids.companionParticipantId,
    },
  } as unknown as OnboardingSessionState;
}

function canonicalFieldStates(
  fixture: ReturnType<typeof validFixture>,
): Record<string, unknown>[] {
  const selfId = fixture.ids.initialParticipantId;
  const spouseId = fixture.ids.companionParticipantId;
  const roster = [
    { participantId: selfId, relationship: "self" },
    { participantId: spouseId, relationship: "spouse" },
  ];
  return [
    modelField("current_location", { countryCode: "RU", city: "Москва" }),
    modelField("move_horizon", "within_3_months"),
    modelField("moving_party", "with_companions"),
    modelField("participants", roster, {
      previousValue: [{ participantId: selfId, relationship: "self" }],
      proposedValue: roster,
      reasonCode: "explicit_new_information",
      reviewState: "model_overwrite_unreviewed",
    }),
    modelField("savings", { min: "10000", max: "20000", currency: "EUR" }),
    modelField(`participants.${selfId}.citizenships`, ["RU"]),
    modelField(`participants.${selfId}.passport`, { validUntil: "2030-12-31" }),
    modelField(`participants.${selfId}.current_work`, { status: "not_working" }),
    notApplicableField(`participants.${selfId}.remote_continuation`),
    modelField(`participants.${selfId}.monthly_income`, {
      amount: "0",
      currency: "RUB",
      basis: "net",
    }),
    modelField(`participants.${selfId}.education`, { level: "higher", field: "информатика" }),
    modelField(`participants.${selfId}.relevant_experience_years`, 8),
    modelField(`participants.${spouseId}.citizenships`, ["RS"]),
    modelField(`participants.${spouseId}.passport`, { validUntil: "2031-12-31" }),
    modelField(`participants.${spouseId}.current_work`, { status: "not_working" }),
    notApplicableField(`participants.${spouseId}.remote_continuation`),
    modelField(`participants.${spouseId}.monthly_income`, {
      amount: "0",
      currency: "EUR",
      basis: "net",
    }),
    modelField(`participants.${spouseId}.education`, { level: "higher", field: "экономика" }),
    modelField(`participants.${spouseId}.relevant_experience_years`, 6),
    modelField("country_preferences.outside_cis.mode", "required"),
    modelField("country_preferences.outside_cis.importance", 5),
    modelField("country_preferences.outside_cis.target", "required_true"),
    modelField("country_preferences.europe.mode", "weighted"),
    modelField("country_preferences.europe.importance", 4),
    modelField("country_preferences.europe.target", "maximize"),
    modelField("country_preferences.personal_safety.mode", "weighted"),
    modelField("country_preferences.personal_safety.importance", 5),
    modelField("country_preferences.personal_safety.target", "maximize"),
    modelField("country_preferences.infrastructure.mode", "weighted"),
    modelField("country_preferences.infrastructure.importance", 4),
    modelField("country_preferences.infrastructure.target", "maximize"),
    modelField("country_preferences.peace_and_stability.mode", "weighted"),
    modelField("country_preferences.peace_and_stability.importance", 5),
    modelField("country_preferences.peace_and_stability.target", "maximize"),
    modelField("city_preferences.safety.mode", "weighted"),
    modelField("city_preferences.safety.importance", 5),
    modelField("city_preferences.safety.target", "высокий уровень личной безопасности"),
    modelField("city_preferences.long_term_rent.mode", "weighted"),
    modelField("city_preferences.long_term_rent.importance", 4),
    modelField("city_preferences.long_term_rent.target", "доступная долгосрочная аренда"),
    modelField("city_preferences.urban_transit.mode", "weighted"),
    modelField("city_preferences.urban_transit.importance", 4),
    modelField("city_preferences.urban_transit.target", "развитый общественный транспорт"),
    modelField("city_preferences.fixed_broadband.mode", "weighted"),
    modelField("city_preferences.fixed_broadband.importance", 3),
    modelField("city_preferences.fixed_broadband.target", "стабильный быстрый домашний интернет"),
  ];
}

function modelField(
  fieldId: string,
  normalizedValue: unknown,
  overwrite: unknown = null,
): Record<string, unknown> {
  return {
    fieldId,
    applicability: "required",
    rawInput: null,
    normalizedValue,
    origin: "model",
    overwrite,
  };
}

function notApplicableField(fieldId: string): Record<string, unknown> {
  return {
    fieldId,
    applicability: "not_applicable",
    rawInput: null,
    normalizedValue: null,
    origin: "empty",
    overwrite: null,
  };
}
