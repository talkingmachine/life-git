import type {
  NarrativeInput,
  NarrativePhraseId,
  NarrativePort,
  NarrativeRead,
  NarrativeTypedValue,
  RunDetails,
  RunDetailsCore,
} from "./contracts";

export const FALLBACK_NARRATIVE: NarrativeRead = Object.freeze({
  headline: "Маршрут показан без недоказанных выводов",
  bullets: Object.freeze([
    "Вывод не расширяет официальные факты.",
    "Пробелы отмечены в паспорте доказательств.",
  ]),
  origin: "fallback",
});

const HEADLINE_COPY = Object.freeze({
  scoped_official_route: "Маршрут показан в границах официальных источников",
});

const BULLET_COPY = Object.freeze({
  official_facts_separated: "Официальные факты отделены от пользовательских данных и допущений.",
  unknowns_explicit: "Неизвестные условия остаются отмеченными в паспорте доказательств.",
});

interface PresentRunPorts {
  readonly loadRunDetailsCore: (runId: string) => Promise<RunDetailsCore>;
  readonly narrative: NarrativePort;
}

function isNarrativeTypedValue(value: unknown): value is NarrativeTypedValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isNarrativeTypedValue);
  if (typeof value !== "object") return false;
  return Object.values(value).every(isNarrativeTypedValue);
}

function narrativeInput(core: RunDetailsCore): NarrativeInput {
  const typedValues: { claimId: string; value: NarrativeTypedValue }[] = [];
  const seen = new Set<string>();
  for (const item of core.evidenceItems) {
    if (item.class !== "official_fact" || item.label.length === 0 || seen.has(item.label)) continue;
    let value: unknown;
    try {
      value = JSON.parse(item.displayValue) as unknown;
    } catch {
      continue;
    }
    if (!isNarrativeTypedValue(value)) continue;
    seen.add(item.label);
    typedValues.push({ claimId: item.label, value });
  }
  return Object.freeze({
    claimIds: Object.freeze(typedValues.map((item) => item.claimId)),
    typedValues: Object.freeze(typedValues.map((item) => Object.freeze(item))),
  });
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function selectedSection(
  value: unknown,
  allowedPhraseIds: ReadonlySet<string>,
  allowedClaimIds: ReadonlySet<string>,
): { readonly phraseId: NarrativePhraseId; readonly claimIds: readonly string[] } | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (!exactKeys(record, ["claimIds", "phraseId"])) return undefined;
  if (typeof record.phraseId !== "string" || !allowedPhraseIds.has(record.phraseId)) return undefined;
  if (
    !Array.isArray(record.claimIds) || record.claimIds.length === 0 || record.claimIds.length > 12 ||
    record.claimIds.some((claimId) => typeof claimId !== "string" || !allowedClaimIds.has(claimId))
  ) return undefined;
  return Object.freeze({
    phraseId: record.phraseId as NarrativePhraseId,
    claimIds: Object.freeze([...record.claimIds] as string[]),
  });
}

function acceptedNarrative(
  value: unknown,
  input: NarrativeInput,
  hasUnknownEvidence: boolean,
): NarrativeRead | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (!exactKeys(record, ["bullets", "headline"]) || !Array.isArray(record.bullets)) return undefined;
  if (record.bullets.length === 0 || record.bullets.length > 3) return undefined;
  const allowedClaimIds = new Set(input.claimIds);
  const headline = selectedSection(
    record.headline,
    new Set(Object.keys(HEADLINE_COPY)),
    allowedClaimIds,
  );
  const bullets = record.bullets.map((bullet) => selectedSection(
    bullet,
    new Set(
      Object.keys(BULLET_COPY).filter((phraseId) =>
        phraseId !== "unknowns_explicit" || hasUnknownEvidence
      ),
    ),
    allowedClaimIds,
  ));
  if (headline === undefined || bullets.some((bullet) => bullet === undefined)) return undefined;
  const exactBullets = bullets as readonly NonNullable<(typeof bullets)[number]>[];
  if (new Set(exactBullets.map((bullet) => bullet.phraseId)).size !== exactBullets.length) return undefined;
  return Object.freeze({
    headline: HEADLINE_COPY[headline.phraseId as keyof typeof HEADLINE_COPY],
    bullets: Object.freeze(exactBullets.map((bullet) =>
      BULLET_COPY[bullet.phraseId as keyof typeof BULLET_COPY]
    )),
    origin: "model" as const,
  });
}

export function createPresentRun(ports: PresentRunPorts) {
  return async function presentRun(runId: string): Promise<RunDetails> {
    if (typeof runId !== "string" || runId.length === 0) throw new Error("invalid_run_id");
    const core = await ports.loadRunDetailsCore(runId);
    return renderRunDetails(core, ports.narrative);
  };
}

export async function renderRunDetails(
  core: RunDetailsCore,
  narrative: NarrativePort,
): Promise<RunDetails> {
  const input = narrativeInput(core);
  let rendered = FALLBACK_NARRATIVE;
  try {
    if (input.claimIds.length > 0) {
      rendered = acceptedNarrative(
        await narrative.select(input),
        input,
        core.evidenceItems.some((item) => item.class === "unknown"),
      ) ?? FALLBACK_NARRATIVE;
    }
  } catch {
    rendered = FALLBACK_NARRATIVE;
  }
  return Object.freeze({ ...core, narrative: rendered });
}
