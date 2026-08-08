import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

import type {
  NarrativeInput,
  NarrativePort,
} from "../application/contracts";

const MODEL = "gpt-5.6" as const;
const TIMEOUT_MS = 8_000;
const INSTRUCTIONS = [
  "Выбери только допустимые идентификаторы готовых фраз для краткого русского вывода.",
  "Не создавай и не возвращай свободный текст.",
  "Каждую выбранную фразу свяжи только с claimIds из входа.",
].join(" ");

const referencedTextSchema = z.object({
  phraseId: z.enum([
    "scoped_official_route",
    "official_facts_separated",
    "unknowns_explicit",
  ]),
  claimIds: z.array(z.string().min(1)).min(1).max(12),
}).strict();

const narrativeSchema = z.object({
  headline: referencedTextSchema.extend({
    phraseId: z.literal("scoped_official_route"),
  }).strict(),
  bullets: z.array(referencedTextSchema).min(1).max(3),
}).strict();

interface NarrativeRequestBody {
  readonly model: typeof MODEL;
  readonly instructions: string;
  readonly input: string;
  readonly text: {
    readonly format: ReturnType<typeof zodTextFormat<typeof narrativeSchema>>;
  };
  readonly store: false;
  readonly tools: [];
}

interface NarrativeRequestOptions {
  readonly timeout: number;
  readonly maxRetries: 0;
}

export type NarrativeParse = (
  body: NarrativeRequestBody,
  options: NarrativeRequestOptions,
) => Promise<unknown>;

interface OpenAiNarrativeOptions {
  readonly apiKey?: string;
  readonly parse?: NarrativeParse;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function containsRefusal(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.output)) return false;
  return value.output.some((item) => {
    if (!isRecord(item) || item.type !== "message" || !Array.isArray(item.content)) return false;
    return item.content.some((content) => isRecord(content) && content.type === "refusal");
  });
}

function parsedOutput(value: unknown): unknown {
  return isRecord(value) ? value.output_parsed : undefined;
}

export function createOpenAiNarrative(options: OpenAiNarrativeOptions): NarrativePort {
  return Object.freeze({
    async select(input: NarrativeInput): Promise<unknown> {
      if (options.apiKey === undefined || options.apiKey.trim().length === 0 || input.claimIds.length === 0) {
        return undefined;
      }
      const body: NarrativeRequestBody = {
        model: MODEL,
        instructions: INSTRUCTIONS,
        input: JSON.stringify(input),
        text: { format: zodTextFormat(narrativeSchema, "confirmed_life_narrative") },
        store: false,
        tools: [],
      };
      const requestOptions: NarrativeRequestOptions = { timeout: TIMEOUT_MS, maxRetries: 0 };
      try {
        const response = options.parse === undefined
          ? await new OpenAI({ apiKey: options.apiKey }).responses.parse(body, requestOptions)
          : await options.parse(body, requestOptions);
        if (containsRefusal(response)) return undefined;
        const parsed = narrativeSchema.safeParse(parsedOutput(response));
        return parsed.success ? parsed.data : undefined;
      } catch {
        return undefined;
      }
    },
  });
}
