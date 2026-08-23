import { afterEach, describe, expect, test, vi } from "vitest";

import type {
  CompleteOnboardingResult,
  OnboardingConfirmationReadPort,
  OnboardingModelPort,
  OnboardingModelVersions,
} from "../../src/application/onboarding-contracts";

type ExtractionPorts = Parameters<
  typeof import("../../src/application/onboarding").extractMessage
>[1];
type CompletionPorts = Parameters<
  typeof import("../../src/application/onboarding").completeOnboarding
>[1];

const MODEL_VERSIONS: OnboardingModelVersions = Object.freeze({
  invocation: "codex-cli-invocation@1",
  cliVersion: "codex-cli 0.148.0-alpha.15",
  extractionPrompt: "onboarding-extract@1",
  reviewPrompt: "onboarding-review@1",
  extractionSchema: "onboarding-model-output@1",
  reviewSchema: "onboarding-review-output@1",
});

describe("production onboarding composition", () => {
  afterEach(() => {
    vi.doUnmock("../../src/application/onboarding");
    vi.doUnmock("../../src/infrastructure/codex-cli/runtime");
    vi.doUnmock("../../src/infrastructure/codex-cli/onboarding-model");
    vi.doUnmock("../../src/infrastructure/place-frontier-composition");
    vi.restoreAllMocks();
    vi.resetModules();
  });

  test("owns one lazy model and one confirmation store behind exact role-specific seams", async () => {
    vi.resetModules();
    let extractionPorts: ExtractionPorts | undefined;
    let completionPorts: CompletionPorts | undefined;
    let onboardingConfirmations: OnboardingConfirmationReadPort | undefined;

    const extractMessage = vi.fn(async (
      command: Parameters<typeof import("../../src/application/onboarding").extractMessage>[0],
      ports: ExtractionPorts,
    ) => {
      extractionPorts = ports;
      return command.session;
    });
    const completeOnboarding = vi.fn(async (
      command: Parameters<typeof import("../../src/application/onboarding").completeOnboarding>[0],
      ports: CompletionPorts,
    ): Promise<CompleteOnboardingResult> => {
      completionPorts = ports;
      return {
        kind: "blocked",
        session: command.session,
        issues: [{ fieldId: "current_location", reasonCode: "required_empty" }],
        followUpQuestion: "Заполните выделенные поля.",
      };
    });
    vi.doMock("../../src/application/onboarding", () => ({
      extractMessage,
      completeOnboarding,
    }));

    const runtimeAdapter = Object.freeze({ invokeJson: vi.fn() });
    const getCodexCliModelAdapter = vi.fn(() => runtimeAdapter);
    vi.doMock("../../src/infrastructure/codex-cli/runtime", () => ({
      getCodexCliModelAdapter,
    }));

    const model = Object.freeze({
      versions: MODEL_VERSIONS,
      extract: vi.fn(),
      review: vi.fn(),
    }) satisfies OnboardingModelPort;
    const createCodexOnboardingModel = vi.fn(() => model);
    vi.doMock("../../src/infrastructure/codex-cli/onboarding-model", () => ({
      createCodexOnboardingModel,
    }));

    const placeFrontier = Object.freeze({
      preparePlaceFrontier: vi.fn(),
      prepareFromOnboardingReceipt: vi.fn(),
      runPlaceFrontier: vi.fn(),
      presentPlaceFrontier: vi.fn(),
    });
    const createPlaceFrontierComposition = vi.fn((options: {
      readonly onboardingConfirmations?: OnboardingConfirmationReadPort;
    }) => {
      if (options.onboardingConfirmations !== undefined) {
        onboardingConfirmations = options.onboardingConfirmations;
      }
      return placeFrontier;
    });
    vi.doMock("../../src/infrastructure/place-frontier-composition", () => ({
      createPlaceFrontierComposition,
    }));

    const [{ createConfirmedLifeComposition }, { openEvidenceDatabase }, { SqliteOnboardingStore }] =
      await Promise.all([
        import("../../src/infrastructure/composition-root"),
        import("../../src/infrastructure/sqlite/db"),
        import("../../src/infrastructure/sqlite/onboarding-store"),
      ]);
    const database = openEvidenceDatabase(":memory:");
    try {
      const application = createConfirmedLifeComposition({
        database,
        hmacKey: "onboarding-composition-test-key",
      });

      expect(Object.keys(application).filter((key) =>
        key === "extractMessage" || key.includes("Onboarding")
      )).toEqual([
        "extractOnboardingMessage",
        "completeOnboarding",
      ]);
      expect(getCodexCliModelAdapter).not.toHaveBeenCalled();
      expect(createCodexOnboardingModel).not.toHaveBeenCalled();

      const signal = new AbortController().signal;
      await application.extractOnboardingMessage({ session: Object.freeze({}) } as never, signal);
      await application.completeOnboarding({ session: Object.freeze({}) } as never, signal);

      expect(getCodexCliModelAdapter).toHaveBeenCalledOnce();
      expect(createCodexOnboardingModel).toHaveBeenCalledOnce();
      expect(createCodexOnboardingModel).toHaveBeenCalledWith(runtimeAdapter);
      expect(createPlaceFrontierComposition.mock.calls.filter(([options]) =>
        options.onboardingConfirmations !== undefined
      )).toEqual([[expect.objectContaining({
        onboardingConfirmations: completionPorts?.completion,
      })]]);
      expect(extractionPorts?.model).toBe(model);
      expect(completionPorts?.model).toBe(model);
      expect(completionPorts?.completion).toBeInstanceOf(SqliteOnboardingStore);
      expect(onboardingConfirmations).toBe(completionPorts?.completion);
      expect(completionPorts?.frontier).toBe(placeFrontier);

      const idCallbacks = [
        extractionPorts?.nextParticipantId,
        extractionPorts?.nextAssistantMessageId,
        extractionPorts?.nextCompletionCommandId,
      ];
      expect(idCallbacks.every((callback) => callback !== undefined)).toBe(true);
      expect(new Set(idCallbacks).size).toBe(3);
      const ids = idCallbacks.map((callback) => callback?.());
      expect(new Set(ids).size).toBe(3);
      for (const id of ids) {
        expect(id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
      }
    } finally {
      database.close();
    }
  });
});
