import { z } from "zod";

import type {
  PlaceFrontierApplication,
} from "../../../application/place-frontier";
import { createPlaceFrontierStreamResponse } from "./stream-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.union([
  z.object({ profile: z.unknown(), preferences: z.unknown() }).strict(),
  z.object({
    profileId: z.string().min(1),
    preferenceProfileId: z.string().min(1),
  }).strict(),
]);

type PrepareInput = Parameters<PlaceFrontierApplication["preparePlaceFrontier"]>[0];
const EXPECTED_PREPARE_ERRORS = new Set([
  "invalid_monthly_income",
  "profile_not_found",
]);

function problem(status: number, code: string, title: string): Response {
  return new Response(JSON.stringify({ code, status, title }), {
    status,
    headers: { "content-type": "application/problem+json; charset=utf-8" },
  });
}

function hasJsonContentType(request: Request): boolean {
  return request.headers.get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase() === "application/json";
}

function isExpectedPrepareError(error: unknown): boolean {
  return error instanceof z.ZodError ||
    error instanceof Error && EXPECTED_PREPARE_ERRORS.has(error.message);
}

async function parseInput(request: Request): Promise<PrepareInput | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return problem(400, "invalid_json", "Некорректный JSON");
  }
  const parsed = requestSchema.safeParse(body);
  return parsed.success
    ? parsed.data as PrepareInput
    : problem(400, "invalid_input", "Запрос не прошёл проверку");
}

async function application(): Promise<PlaceFrontierApplication> {
  const { getConfirmedLifeApplication } = await import(
    "../../../infrastructure/composition-root"
  );
  return getConfirmedLifeApplication();
}

export async function POST(request: Request): Promise<Response> {
  if (!hasJsonContentType(request)) {
    return problem(415, "unsupported_media_type", "Неподдерживаемый формат запроса");
  }
  const input = await parseInput(request);
  if (input instanceof Response) return input;

  let frontier: PlaceFrontierApplication;
  let response: Response;
  try {
    frontier = await application();
    const prepared = await frontier.preparePlaceFrontier(input);
    response = createPlaceFrontierStreamResponse({
      signal: request.signal,
      prepared,
      runPlaceFrontier: frontier.runPlaceFrontier,
    });
  } catch (error) {
    return isExpectedPrepareError(error)
      ? problem(400, "invalid_input", "Запрос не прошёл проверку")
      : problem(500, "internal_error", "Не удалось запустить проверку");
  }

  return response;
}
