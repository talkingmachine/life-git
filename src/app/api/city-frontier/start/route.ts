import { z } from "zod";

import type { CityFrontierApplication } from "../../../../application/city-frontier";

type StartCityFrontier = Pick<CityFrontierApplication, "startCityFrontier">;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const criterionSchema = z.object({
  criterionId: z.enum(["safety", "long_term_rent", "urban_transit", "fixed_broadband"]),
  definitionId: z.string().min(1),
  mode: z.enum(["required", "weighted"]),
  importance: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  target: z.string().min(1),
}).strict();

const requestSchema = z.object({
  resolvedCountryShortlistRevisionId: z.string().min(1),
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  criteria: z.tuple([criterionSchema, criterionSchema, criterionSchema, criterionSchema]).refine(
    (criteria) => new Set(criteria.map(({ criterionId }) => criterionId)).size === 4,
  ),
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
  if (code === "resolution_not_found") {
    return problem(404, code, "Разрешение стран не найдено");
  }
  if (code === "city_package_not_ready" || code === "city_package_not_installed" ||
    code === "city_catalog_upgrade_required") {
    return problem(409, code, "Городской каталог недоступен");
  }
  return problem(500, "internal_error", "Не удалось начать проверку городов");
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
  return parsed.success ? parsed.data : problem(400, "invalid_input", "Запрос не прошёл проверку");
}

async function application(): Promise<StartCityFrontier> {
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
    const readModel = await (await application()).startCityFrontier({
      resolvedCountryShortlistRevisionId: input.resolvedCountryShortlistRevisionId,
      countryCode: input.countryCode,
      criteriaDraft: input.criteria,
      commandId: input.commandId,
    });
    return new Response(JSON.stringify(readModel), {
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      },
    });
  } catch (error) {
    return applicationError(error);
  }
}
