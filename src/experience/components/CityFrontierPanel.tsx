"use client";

import type { CityFrontierReadModel } from "../../application/city-frontier-contracts";
import type { CityFrontierView } from "../city-frontier-view-model";

interface CityFrontierPanelProps {
  readonly canRetry: boolean;
  readonly continuing: boolean;
  readonly onContinue: () => void;
  readonly onReload: () => void;
  readonly readModel: CityFrontierReadModel;
  readonly requestError?: string;
  readonly view: CityFrontierView;
}

export function CityFrontierPanel({
  canRetry,
  continuing,
  onContinue,
  onReload,
  readModel,
  requestError,
  view,
}: CityFrontierPanelProps) {
  if (view.requiresVerifiedReload) {
    return (
      <section className="country-resolution-panel country-resolution-panel--continuation">
        <p role="alert">
          Обновление сохранено, но завершение потока не подтверждено. Перезагрузите страницу,
          чтобы проверить актуальное состояние.
        </p>
        <button onClick={onReload} type="button">Перезагрузить</button>
      </section>
    );
  }

  if (readModel.catalog.rulesVersion === "city-catalog@1") {
    return (
      <section className="country-resolution-panel country-resolution-panel--continuation">
        <p>
          Исторический подбор доступен только для просмотра. Чтобы продолжить или выбрать город,
          начните новый поиск с обновлённым каталогом.
        </p>
      </section>
    );
  }

  return (
    <section className="country-resolution-panel country-resolution-panel--continuation">
      {view.transportError === undefined ? null : <p role="alert">{view.transportError}</p>}
      {requestError === undefined ? null : <p role="alert">{requestError}</p>}
      {view.sourceUnavailable ? (
        <p role="status">Официальный источник недоступен, факт не подтверждён.</p>
      ) : null}
      {view.source !== undefined && view.source.status !== "yellow" ? (
        <p>
          {view.sourceReplaced ? "Официальный источник автоматически заменён. " : null}
          Источник: <a href={view.source.sourceUrl!}>{view.source.publisherName}</a>
          {" · "}{view.source.checkedAt}
        </p>
      ) : null}
      {canRetry ? (
        <button disabled={continuing} onClick={onContinue} type="button">
          Повторить проверку
        </button>
      ) : view.canContinue ? (
        <button disabled={continuing} onClick={onContinue} type="button">
          Продолжить проверку
        </button>
      ) : readModel.revision.kind === "working" && continuing ? (
        <p>Проверяем следующий город из сохранённого рейтинга.</p>
      ) : null}
      <p className="visually-hidden">Revision: {readModel.revision.id}</p>
    </section>
  );
}
