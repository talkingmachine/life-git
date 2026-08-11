import type {
  EvidenceReadItem,
  NarrativeRead,
  RunDetails,
  RunDetailsCore,
} from "./contracts";

const NO_FACTS_HEADLINE = "Маршрут показан без недоказанных выводов";
const OFFICIAL_HEADLINE = "Маршрут показан в границах официальных источников";
const SAFE_BULLET = "Вывод не расширяет официальные факты.";
const OFFICIAL_BULLET = "Официальные факты отделены от пользовательских данных и допущений.";
const UNKNOWNS_BULLET = "Неизвестные условия остаются отмеченными в паспорте доказательств.";

interface PresentRunPorts {
  readonly loadRunDetailsCore: (runId: string) => Promise<RunDetailsCore>;
}

export function projectNarrative(
  evidenceItems: readonly Pick<EvidenceReadItem, "class">[],
): NarrativeRead {
  const hasOfficialFacts = evidenceItems.some((item) => item.class === "official_fact");
  const hasUnknowns = evidenceItems.some((item) => item.class === "unknown");
  const bullets = [hasOfficialFacts ? OFFICIAL_BULLET : SAFE_BULLET];
  if (hasUnknowns) bullets.push(UNKNOWNS_BULLET);
  return Object.freeze({
    headline: hasOfficialFacts ? OFFICIAL_HEADLINE : NO_FACTS_HEADLINE,
    bullets: Object.freeze(bullets),
  });
}

export function renderRunDetails(core: RunDetailsCore): RunDetails {
  return Object.freeze({ ...core, narrative: projectNarrative(core.evidenceItems) });
}

export function createPresentRun(ports: PresentRunPorts) {
  return async function presentRun(runId: string): Promise<RunDetails> {
    if (typeof runId !== "string" || runId.length === 0) throw new Error("invalid_run_id");
    return renderRunDetails(await ports.loadRunDetailsCore(runId));
  };
}
