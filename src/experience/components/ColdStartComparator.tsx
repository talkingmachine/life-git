"use client";

import { useLayoutEffect, useRef, useState } from "react";

import type { ColdStartReadModel } from "../../application/cold-start";
import { UiIcon } from "./UiIcon";

interface ColdStartComparatorProps {
  readonly onRetry?: () => void;
  readonly readModel: ColdStartReadModel;
  readonly retryPending?: boolean;
}

const PERSONAL_FIT_LABELS: Readonly<Record<
  ColdStartReadModel["comparator"]["personalFit"],
  string
>> = {
  verified_veto: "Подтверждён обязательный запрет",
  research_incomplete: "Исследование не завершено",
  personal_evidence_missing: "Не хватает данных профиля",
  route_compatible_city_unverified: "Маршрут совместим, город не проверен",
};

export function ColdStartComparator({
  onRetry,
  readModel,
  retryPending = false,
}: ColdStartComparatorProps) {
  const [reasonsOpen, setReasonsOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const isRed = readModel.comparator.marker === "red";
  const detailId = `cold-start-reasons-${readModel.runId}`;

  useLayoutEffect(() => {
    if (reasonsOpen) heading.current?.focus();
  }, [reasonsOpen]);

  const closeReasons = () => {
    setReasonsOpen(false);
    trigger.current?.focus();
  };

  return (
    <section
      aria-label="Сравнение релокационного сценария"
      className={`cold-start-comparator cold-start-comparator--${readModel.comparator.marker}`}
      data-marker={readModel.comparator.marker}
    >
      <header className="cold-start-comparator__header">
        <UiIcon
          className="cold-start-comparator__status-icon"
          name={isRed ? "status-red" : "status-yellow"}
          weight="duotone"
        />
        <div>
          <p className="eyebrow">Персональное сравнение</p>
          <h2>{isRed ? "Не подходит" : "Нужно уточнить"}</h2>
        </div>
      </header>

      <dl className="cold-start-comparator__facts">
        <div><dt>Уровень проверки</dt><dd>Страна</dd></div>
        <div><dt>Город</dt><dd>Город не проверен</dd></div>
        <div>
          <dt>Покрытие</dt>
          <dd>{readModel.coverage.verified} / {readModel.coverage.required}</dd>
        </div>
        <div><dt>Проверено</dt><dd>{readModel.checkedAt}</dd></div>
        <div>
          <dt>Досье</dt>
          <dd>{readModel.dossier?.label ?? "Досье не опубликовано"}</dd>
        </div>
        <div>
          <dt>Персональная совместимость</dt>
          <dd>{PERSONAL_FIT_LABELS[readModel.comparator.personalFit]}</dd>
        </div>
        <div><dt>Контекст выдачи</dt><dd>исследовано отдельно от top-5</dd></div>
        <div><dt>Снимок</dt><dd>{readModel.evidenceSnapshotId}</dd></div>
      </dl>

      <details className="cold-start-comparator__sources">
        <summary>Проверенные официальные источники</summary>
        {readModel.sourceNavigation.length === 0 ? (
          <p>Для этого вывода нет доступных проверенных ссылок.</p>
        ) : (
          <ul>
            {readModel.sourceNavigation.map((source) => (
              <li key={source.url}>
                <a href={source.url}>Открыть официальный ресурс: {source.label}</a>
              </li>
            ))}
          </ul>
        )}
      </details>

      {isRed ? (
        <>
          <button
            aria-controls={detailId}
            aria-expanded={reasonsOpen}
            className="cold-start-comparator__reason-trigger"
            onClick={() => setReasonsOpen((open) => !open)}
            ref={trigger}
            type="button"
          >
            Почему не подходит
          </button>
          {reasonsOpen ? (
            <section
              aria-labelledby={`${detailId}-heading`}
              className="cold-start-comparator__reasons"
              id={detailId}
              onKeyDown={(event) => {
                if (event.key === "Escape") closeReasons();
              }}
              role="dialog"
            >
              <button
                aria-label="Закрыть причины"
                className="cold-start-comparator__close"
                onClick={closeReasons}
                type="button"
              >
                <UiIcon name="close" />
              </button>
              <h3 id={`${detailId}-heading`} ref={heading} tabIndex={-1}>
                Проверенный запрет
              </h3>
              <ReasonList reasons={readModel.comparator.reasons} />
              {readModel.comparator.formula === undefined ? null : (
                <dl className="cold-start-comparator__formula">
                  <div><dt>Формула</dt><dd>{readModel.comparator.formula.expression}</dd></div>
                  <div><dt>Доход RUB</dt><dd>{readModel.comparator.formula.monthlyIncomeRub}</dd></div>
                  <div><dt>EUR/RUB</dt><dd>{readModel.comparator.formula.eurRub}</dd></div>
                  <div><dt>Доход EUR</dt><dd>{readModel.comparator.formula.incomeEur}</dd></div>
                  <div><dt>Порог EUR</dt><dd>{readModel.comparator.formula.thresholdEur}</dd></div>
                  <div><dt>Округление</dt><dd>{readModel.comparator.formula.rounding}</dd></div>
                  <div>
                    <dt>Claim IDs</dt>
                    <dd>{readModel.comparator.formula.sourceClaimIds.join(" · ")}</dd>
                  </div>
                </dl>
              )}
            </section>
          ) : null}
        </>
      ) : (
        <section className="cold-start-comparator__blockers">
          <h3>Что нужно подтвердить</h3>
          <ReasonList reasons={readModel.comparator.reasons} />
          {onRetry === undefined ? null : (
            <button disabled={retryPending} onClick={onRetry} type="button">
              <UiIcon name="retry" />
              {retryPending ? "Проверяем…" : "Проверить ещё раз"}
            </button>
          )}
        </section>
      )}
    </section>
  );
}

function ReasonList({
  reasons,
}: {
  readonly reasons: ColdStartReadModel["comparator"]["reasons"];
}) {
  return (
    <ol className="cold-start-comparator__reason-list">
      {reasons.map((reason, reasonIndex) => (
        <li key={`${reason.code}-${reasonIndex}`}>
          <p>{reason.summary}</p>
          {reason.claimIds.length === 0 ? null : (
            <p>Claim IDs: {reason.claimIds.join(" · ")}</p>
          )}
          {reason.officialUrls.map((url, urlIndex) => (
            <a href={url} key={url}>
              Официальный источник для причины {reasonIndex + 1}.{urlIndex + 1}
            </a>
          ))}
        </li>
      ))}
    </ol>
  );
}
