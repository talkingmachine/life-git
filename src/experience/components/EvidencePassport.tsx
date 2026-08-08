import type { EvidenceReadItem } from "../../application/contracts";

interface EvidencePassportProps {
  items: readonly EvidenceReadItem[];
}

const classes = [
  ["official_fact", "Официальный факт"],
  ["user_fact", "Факт пользователя"],
  ["calculation", "Расчёт"],
  ["assumption", "Допущение"],
  ["projection", "Проекция"],
  ["unknown", "Неизвестно"],
] as const;

function EvidenceItem({ item }: { item: EvidenceReadItem }) {
  if (item.class === "official_fact") {
    return (
      <article>
        <h4>{item.label}</h4>
        <p>{item.displayValue}</p>
        <dl>
          <div><dt>Область</dt><dd>{item.scope}</dd></div>
          <div><dt>Период</dt><dd>{item.sourcePeriod}</dd></div>
          <div><dt>Якорь</dt><dd>{item.anchor}</dd></div>
          <div><dt>Целостность</dt><dd>проверена</dd></div>
        </dl>
        <a href={item.resolvedUrl} rel="noreferrer noopener" target="_blank">
          Проверенный официальный источник
        </a>
      </article>
    );
  }
  if (item.class === "calculation") {
    return (
      <article>
        <h4>{item.label}</h4>
        <p>{item.displayValue}</p>
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
      </article>
    );
  }
  if (item.class === "unknown" && item.provenance === "source_unavailable") {
    return (
      <article>
        <h4>{item.label}</h4>
        <p>Блокер: {item.blockerKind}</p>
        <a
          href={item.resolvedUrl ?? item.navigationUrl}
          rel="noreferrer noopener"
          target="_blank"
        >
          Открыть официальный источник для повторной проверки
        </a>
      </article>
    );
  }
  return (
    <article>
      <h4>{item.label}</h4>
      {"displayValue" in item && item.displayValue !== undefined ? <p>{item.displayValue}</p> : null}
      <p>{item.provenance === "confirmed_profile" ? "Подтверждённый профиль" : item.provenance === "scenario" ? "Сценарий" : "Не моделируется"}</p>
    </article>
  );
}

export function EvidencePassport({ items }: EvidencePassportProps) {
  return (
    <details className="evidence-passport">
      <summary>
        <span>Паспорт доказательств</span>
        <small>Компактный технический срез · раскрыть шесть классов</small>
      </summary>
      <div className="evidence-passport__grid">
        {classes.map(([className, title]) => (
          <section aria-labelledby={`evidence-${className}`} key={className}>
            <h3 id={`evidence-${className}`}>{title}</h3>
            <div>
              {items.filter((item) => item.class === className).map((item, index) => (
                <EvidenceItem item={item} key={`${item.label}:${index}`} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </details>
  );
}
