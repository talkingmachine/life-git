import { z } from "zod";

import type { CitySelectionApplication } from "../../../../application/city-selection";

type SelectCity = Pick<CitySelectionApplication, "selectCity">;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  terminalCityShortlistSnapshotId: z.string().min(1),
  cityId: z.string().min(1),
  commandId: z.string().min(1),
  warningCopyVersion: z.literal("city-unknown-risk@1").optional(),
}).strict();

function problem(status: number, code: string, title: string): Response {
  return new Response(JSON.stringify({ code, status, title }), {
    status,
    headers: { "content-type": "application/problem+json; charset=utf-8" },
  });
}

function applicationError(error: unknown): Response {
  const code = error instanceof Error ? error.message : undefined;
  if (code === "city_frontier_not_found" || code === "city_selection_not_found") {
    return problem(404, code, "Городской выбор не найден");
  }
  if (code === "city_catalog_upgrade_required") {
    return problem(409, code, "Городской каталог требует обновления");
  }
  return problem(500, "internal_error", "Не удалось сохранить выбор города");
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

async function application(): Promise<SelectCity> {
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
    const result = await (await application()).selectCity(input);
    return new Response(JSON.stringify(result), {
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      },
    });
  } catch (error) {
    return applicationError(error);
  }
}
