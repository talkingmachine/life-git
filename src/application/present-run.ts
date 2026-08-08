import type {
  NarrativeInput,
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

function immutableNarrative(value: NarrativeRead): NarrativeRead {
  return Object.freeze({
    headline: value.headline,
    bullets: Object.freeze([...value.bullets]),
    origin: value.origin,
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
  let rendered: NarrativeRead;
  try {
    rendered = await narrative.render(narrativeInput(core));
  } catch {
    rendered = FALLBACK_NARRATIVE;
  }
  return Object.freeze({ ...core, narrative: immutableNarrative(rendered) });
}
