import { z } from "zod";

import type { CountryResolutionApplication } from
  "../../../../application/country-resolution";

type DecideCountryResolution = Pick<CountryResolutionApplication, "decideYellow">;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  resolutionRunId: z.string().min(1),
  expectedRevisionId: z.string().min(1),
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  decision: z.enum(["accepted_at_own_risk", "rejected"]),
  warningCopyVersion: z.literal("yellow-risk@1"),
  commandId: z.string().min(1),
}).strict();

function problem(status: number, code: string, title: string): Response {
  return new Response(JSON.stringify({ code, status, title }), {
    status,
    headers: { "content-type": "application/problem+json; charset=utf-8" },
  });
}

function applicationError(error: unknown): Response {
  const code = error instanceof Error ? error.message : undefined;
  if (code === "resolution_not_found" || code === "snapshot_not_found") {
    return problem(404, "resolution_not_found", "Разрешение не найдено");
  }
  if (code === "stale_resolution_head") {
    return problem(409, code, "Состояние разрешения изменилось");
  }
  if (code === "invalid_resolution_target") {
    return problem(409, code, "Страна больше не ожидает решения");
  }
  return problem(500, "internal_error", "Не удалось сохранить решение");
}

function hasJsonContentType(request: Request): boolean {
  return request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ===
    "application/json";
}

async function parseRequest(request: Request): Promise<z.infer<typeof requestSchema> | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return problem(400, "invalid_json", "Некорректный JSON");
  }
  const parsed = requestSchema.safeParse(body);
  return parsed.success
    ? parsed.data
    : problem(400, "invalid_input", "Запрос не прошёл проверку");
}

async function application(): Promise<DecideCountryResolution> {
  const { getConfirmedLifeApplication } = await import(
    "../../../../infrastructure/composition-root"
  );
  return getConfirmedLifeApplication();
}

export async function POST(request: Request): Promise<Response> {
  if (!hasJsonContentType(request)) {
    return problem(415, "unsupported_media_type", "Неподдерживаемый формат запроса");
  }
  const input = await parseRequest(request);
  if (input instanceof Response) return input;
  try {
    const readModel = await (await application()).decideYellow(input);
    return new Response(JSON.stringify(readModel), {
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (error) {
    return applicationError(error);
  }
}
