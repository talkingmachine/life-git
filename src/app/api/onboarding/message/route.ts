import { reconstructExtractOnboardingMessageCommand } from "../../../../application/onboarding";
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
    command = reconstructExtractOnboardingMessageCommand(input);
  } catch {
    return onboardingProblemResponse(400, "invalid_input", "Запрос не прошёл проверку");
  }

  try {
    const { getConfirmedLifeApplication } = await import(
      "../../../../infrastructure/composition-root"
    );
    const session = await getConfirmedLifeApplication()
      .extractOnboardingMessage(command, request.signal);
    return onboardingJsonResponse(session);
  } catch {
    if (request.signal.aborted) throw onboardingAbortReason(request.signal);
    return onboardingProblemResponse(500, "internal_error", "Не удалось обработать сообщение");
  }
}
