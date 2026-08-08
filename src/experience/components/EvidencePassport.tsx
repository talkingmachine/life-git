import type { EvidenceReadItem } from "../../application/contracts";

interface EvidencePassportProps {
  companionMode: "staged" | "none" | "separate";
  items: readonly EvidenceReadItem[];
}

type OfficialFact = Extract<EvidenceReadItem, { readonly class: "official_fact" }>;

const classes = [
  ["official_fact", "Официальный факт"],
  ["user_fact", "Факт пользователя"],
  ["calculation", "Расчёт"],
  ["assumption", "Допущение"],
  ["projection", "Проекция"],
  ["unknown", "Неизвестно"],
] as const;

const sourceCopy: Readonly<Record<string, { readonly title: string; readonly summary: string }>> = Object.freeze({
  "al-law-79": Object.freeze({
    title: "Закон № 79: цифровой работник и семейный маршрут",
    summary: "Официальные условия для цифрового работника и семейного маршрута подтверждены источником.",
  }),
  "al-decision-858": Object.freeze({
    title: "Решение № 858: доступные средства",
    summary: "Официальное правило о доступных средствах подтверждено источником.",
  }),
  "cbr-eur": Object.freeze({
    title: "Банк России: курс EUR/RUB",
    summary: "Официальный курс EUR/RUB подтверждён на дату оценки.",
  }),
  "boa-eur": Object.freeze({
    title: "Банк Албании: курс EUR/ALL",
    summary: "Официальный курс EUR/ALL подтверждён на дату оценки.",
  }),
  "tirana-urban-lines": Object.freeze({
    title: "Муниципалитет Тираны: городские маршруты",
    summary: "Публикация муниципальной карты городских маршрутов подтверждена источником.",
  }),
});

const blockerCopy: Readonly<Record<string, string>> = Object.freeze({
  timeout: "Источник не ответил вовремя.",
  deadline: "Источник не ответил в отведённый срок.",
  rate_limited: "Источник временно ограничил доступ.",
  server_error: "Источник временно недоступен.",
  http_error: "Источник вернул ошибку.",
  wrong_media_type: "Источник вернул неподдерживаемый формат.",
  too_large: "Источник вернул слишком большой документ.",
  navigation_mismatch: "Официальный адрес источника не подтверждён.",
  integrity_mismatch: "Источник не прошёл проверку целостности.",
  semantic_mismatch: "Источник не прошёл смысловую проверку.",
  stale: "Данные источника устарели для даты оценки.",
  conflict: "Источник содержит конфликтующие данные.",
});

function sourceTitle(sourceId: string): string {
  return sourceCopy[sourceId]?.title ?? "Официальный источник";
}

function OfficialSource({ items }: { readonly items: readonly OfficialFact[] }) {
  const first = items[0];
  if (first === undefined) return null;
  const copy = sourceCopy[first.sourceId] ?? {
    title: "Официальный источник",
    summary: "Факт подтверждён официальным источником.",
  };
  const rawValues = [...new Set(items.map((item) => item.displayValue))];
  const sourcePeriods = [...new Set(items.map((item) => item.sourcePeriod))];

  return (
    <article>
      <h4>{copy.title}</h4>
      <p>{copy.summary}</p>
      <p>Период источника: {sourcePeriods.join(", ")}</p>
      <a href={first.resolvedUrl} rel="noreferrer noopener" target="_blank">
        Проверенный официальный источник
      </a>
      <details className="evidence-passport__technical">
        <summary>Технические данные и якоря</summary>
        {rawValues.map((value) => <pre key={value}><code>{value}</code></pre>)}
        <ul>
          {items.map((item) => (
            <li key={item.label}>
              <code>{item.label}</code>
              <span>{item.sourcePeriod} · {item.anchor} · целостность проверена</span>
            </li>
          ))}
        </ul>
      </details>
    </article>
  );
}

function EvidenceItem({ item }: { item: EvidenceReadItem }) {
  if (item.class === "calculation") {
    return (
      <article>
        <h4>{item.label}</h4>
        <p>{item.displayValue}</p>
        <details className="evidence-passport__technical">
          <summary>Технические данные расчёта</summary>
          <p>{item.formulaId}, версия {item.formulaVersion}</p>
          <ul>
            {item.inputs.map((input) => (
              <li key={`${input.binding}:${input.ref}`}>
                {input.binding}: {input.value} {input.unit} · {input.provenance} · {input.ref}
              </li>
            ))}
          </ul>
          <p>Округление: {item.rounding}</p>
          <code>{item.outputHash}</code>
        </details>
      </article>
    );
  }
  if (item.class === "unknown" && item.provenance === "source_unavailable") {
    return (
      <article>
        <h4>{sourceTitle(item.sourceId)}: требуется повторная проверка</h4>
        <p>{blockerCopy[item.blockerKind] ?? "Источник недоступен для проверки."}</p>
        <a
          href={item.resolvedUrl ?? item.navigationUrl}
          rel="noreferrer noopener"
          target="_blank"
        >
          Открыть официальный источник для повторной проверки
        </a>
        <details className="evidence-passport__technical">
          <summary>Технические данные блокера</summary>
          <p><code>{item.sourceId}</code></p>
          <p><code>{item.blockerKind}</code></p>
        </details>
      </article>
    );
  }
  if (item.class === "official_fact") return null;
  return (
    <article>
      <h4>{item.label}</h4>
      {"displayValue" in item && item.displayValue !== undefined ? <p>{item.displayValue}</p> : null}
      <p>{item.provenance === "confirmed_profile" ? "Подтверждённый профиль" : item.provenance === "scenario" ? "Сценарий" : "Не моделируется"}</p>
    </article>
  );
}

function officialGroups(items: readonly EvidenceReadItem[]): readonly (readonly OfficialFact[])[] {
  const groups = new Map<string, OfficialFact[]>();
  for (const item of items) {
    if (item.class !== "official_fact") continue;
    const group = groups.get(item.sourceId) ?? [];
    group.push(item);
    groups.set(item.sourceId, group);
  }
  return [...groups.values()];
}

export function EvidencePassport({ companionMode, items }: EvidencePassportProps) {
  const groupedOfficialFacts = officialGroups(items);
  return (
    <details className="evidence-passport">
      <summary>
        <span>Паспорт доказательств</span>
        <small>Понятный срез · раскрыть шесть классов</small>
      </summary>
      <div className="evidence-passport__grid">
        {classes.map(([className, title]) => {
          const classItems = items.filter((item) => item.class === className);
          return (
            <section aria-labelledby={`evidence-${className}`} key={className}>
              <h3 id={`evidence-${className}`}>{title}</h3>
              <div>
                {className === "official_fact"
                  ? groupedOfficialFacts.map((group) => (
                    <OfficialSource items={group} key={group[0]?.sourceId} />
                  ))
                  : classItems.map((item, index) => (
                    <EvidenceItem item={item} key={`${item.label}:${index}`} />
                  ))}
                {className === "projection" && companionMode === "none" && classItems.length === 0
                  ? (
                    <article>
                      <h4>Без спутника</h4>
                      <p>Сценарий без спутника: отдельная семейная проекция не требуется.</p>
                    </article>
                  )
                  : null}
              </div>
            </section>
          );
        })}
      </div>
    </details>
  );
}
