import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

import {
  FALLBACK_NARRATIVE,
} from "../application/present-run";
import type {
  NarrativeInput,
  NarrativePort,
  NarrativeRead,
} from "../application/contracts";

export { FALLBACK_NARRATIVE };

const MODEL = "gpt-5.6" as const;
const TIMEOUT_MS = 8_000;
const DIGIT = /\p{Decimal_Number}/u;
const INSTRUCTIONS = [
  "Составь краткий русский вывод только по переданным типизированным фактам.",
  "Не добавляй числа, имена, советы или сведения вне указанных claimIds.",
  "Каждое утверждение свяжи с claimIds из входа.",
].join(" ");

const referencedTextSchema = z.object({
  text: z.string().trim().min(1).max(180),
  claimIds: z.array(z.string().min(1)).min(1).max(12),
}).strict();

const narrativeSchema = z.object({
  headline: referencedTextSchema,
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

function acceptedNarrative(
  output: z.infer<typeof narrativeSchema>,
  allowedClaimIds: ReadonlySet<string>,
): NarrativeRead | undefined {
  const sections = [output.headline, ...output.bullets];
  if (
    sections.some((section) =>
      DIGIT.test(section.text) ||
      section.claimIds.some((claimId) => !allowedClaimIds.has(claimId))
    )
  ) return undefined;
  return Object.freeze({
    headline: output.headline.text,
    bullets: Object.freeze(output.bullets.map((bullet) => bullet.text)),
    origin: "model" as const,
  });
}

export function createOpenAiNarrative(options: OpenAiNarrativeOptions): NarrativePort {
  return Object.freeze({
    async render(input: NarrativeInput): Promise<NarrativeRead> {
      if (options.apiKey === undefined || options.apiKey.trim().length === 0 || input.claimIds.length === 0) {
        return FALLBACK_NARRATIVE;
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
        if (containsRefusal(response)) return FALLBACK_NARRATIVE;
        const parsed = narrativeSchema.safeParse(parsedOutput(response));
        if (!parsed.success) return FALLBACK_NARRATIVE;
        return acceptedNarrative(parsed.data, new Set(input.claimIds)) ?? FALLBACK_NARRATIVE;
      } catch {
        return FALLBACK_NARRATIVE;
      }
    },
  });
}
