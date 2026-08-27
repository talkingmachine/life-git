import { reconstructContinueOnboardingCommand } from "../../../../application/onboarding";
import { createPlaceFrontierStreamResponse } from "../../place-frontier/stream-response";
import {
  onboardingAbortReason,
  onboardingJsonResponse,
  onboardingProblemResponse,
  onboardingRequestErrorResponse,
  readBoundedOnboardingJson,
} from "../route-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let input: unknown;
  try {
    input = await readBoundedOnboardingJson(request, request.signal);
  } catch (error) {
    if (request.signal.aborted) throw onboardingAbortReason(request.signal);
    return onboardingRequestErrorResponse(error);
  }

  let command;
  try {
    command = reconstructContinueOnboardingCommand(input);
  } catch {
    return onboardingProblemResponse(400, "invalid_input", "Запрос не прошёл проверку");
  }

  try {
    const { getConfirmedLifeApplication } = await import(
      "../../../../infrastructure/composition-root"
    );
    const application = getConfirmedLifeApplication();
    const result = await application.completeOnboarding(command, request.signal);
    if (result.kind === "blocked") return onboardingJsonResponse(result);
    return createPlaceFrontierStreamResponse({
      signal: request.signal,
      prepared: result.prepared,
      runPlaceFrontier: application.runPlaceFrontier,
    });
  } catch {
    if (request.signal.aborted) throw onboardingAbortReason(request.signal);
    return onboardingProblemResponse(500, "internal_error", "Не удалось продолжить анкету");
  }
}
