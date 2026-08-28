import { ColdStartJourney } from "../experience/components/ColdStartJourney";
import { ColdStartStart } from "../experience/components/ColdStartStart";
import { CityFrontierJourney } from "../experience/components/CityFrontierJourney";
import { PlaceFrontierJourney } from "../experience/components/PlaceFrontierJourney";
import { PlaceFrontierStart } from "../experience/components/PlaceFrontierStart";
import { OnboardingStart } from "../experience/components/OnboardingStart";
import { Vs1Journey } from "../experience/components/Vs1Journey";
import { Vs1Start } from "../experience/components/Vs1Start";

export const dynamic = "force-dynamic";

interface PageProps {
  readonly searchParams: Promise<{
    readonly flow?: string | readonly string[];
    readonly profile?: string | readonly string[];
    readonly run?: string | readonly string[];
    readonly source?: string | readonly string[];
    readonly country?: string | readonly string[];
  }>;
}

function one(value: string | readonly string[] | undefined): string | undefined {
  if (typeof value === "string" || value === undefined) return value;
  return value[0];
}

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const flow = one(params.flow);
  const runId = one(params.run);
  const profileId = one(params.profile);

  if (flow === "city-frontier") {
    const exactRunId = typeof params.run === "string" ? params.run : undefined;
    const sourceRevisionId = typeof params.source === "string" ? params.source : undefined;
    const countryCode = typeof params.country === "string" ? params.country : undefined;
    const application = async () => {
      const { getConfirmedLifeApplication } = await import("../infrastructure/composition-root");
      return getConfirmedLifeApplication();
    };

    if (exactRunId !== undefined && params.source === undefined && params.country === undefined) {
      try {
        const readModel = await (await application()).presentCityFrontier(exactRunId);
        return <CityFrontierJourney mode={{ kind: "stored", readModel }} />;
      } catch (error) {
        if (error instanceof Error && (error.message === "city_frontier_not_found" ||
          error.message === "snapshot_not_found")) return <MissingCityFrontier />;
        return <UnavailableCityFrontier />;
      }
    }

    if (params.run === undefined && sourceRevisionId !== undefined && countryCode !== undefined) {
      try {
        const setup = await (await application()).presentCityFrontierSetup({
          resolvedCountryShortlistRevisionId: sourceRevisionId,
          countryCode,
        });
        return <CityFrontierJourney mode={{ kind: "setup", setup }} />;
      } catch (error) {
        if (error instanceof Error && error.message === "city_catalog_upgrade_required") {
          return <CityCatalogUpgradeRequired />;
        }
        if (error instanceof Error && (error.message === "city_package_not_ready" ||
          error.message === "city_package_not_installed")) return <UnavailableCityPackage />;
        if (error instanceof Error && error.message === "resolution_not_found") {
          return <MissingCityFrontierSetup />;
        }
        return <UnavailableCityFrontier />;
      }
    }
    return <MissingCityFrontierSetup />;
  }

  if (flow === "country-resolution") {
    if (runId === undefined) return <MissingCountryResolution />;
    try {
      const { getConfirmedLifeApplication } = await import("../infrastructure/composition-root");
      const readModel = await getConfirmedLifeApplication().presentCountryResolution(runId);
      return <PlaceFrontierJourney mode={{ kind: "resolution-stored", readModel }} />;
    } catch (error) {
      if (error instanceof Error && (error.message === "resolution_not_found" ||
        error.message === "snapshot_not_found")) {
        return <MissingCountryResolution />;
      }
      return <UnavailableCountryResolution />;
    }
  }

  if (flow === "place-frontier") {
    if (runId === undefined) return <PlaceFrontierStart />;
    try {
      const { getConfirmedLifeApplication } = await import("../infrastructure/composition-root");
      const readModel = await getConfirmedLifeApplication().presentPlaceFrontier(runId);
      return <PlaceFrontierJourney initialReadModel={readModel} mode="stored" runId={runId} />;
    } catch (error) {
      if (error instanceof Error && error.message === "snapshot_not_found") {
        return <PlaceFrontierJourney mode="interrupted" runId={runId} />;
      }
      return <UnavailablePlaceFrontier />;
    }
  }

  if (flow === "cold-start") {
    if (runId === undefined && profileId === undefined) return <ColdStartStart />;
    if (runId === undefined || profileId === undefined) return <UnavailableColdStart />;

    try {
      const { getConfirmedLifeApplication } = await import("../infrastructure/composition-root");
      const readModel = await getConfirmedLifeApplication().present({ runId, profileId });
      return (
        <ColdStartJourney
          initialReadModel={readModel}
          profileId={profileId}
          runId={runId}
        />
      );
    } catch (error) {
      if (error instanceof Error && error.message === "evidence_not_found") {
        return <ColdStartJourney interrupted profileId={profileId} runId={runId} />;
      }
      return <UnavailableColdStart />;
    }
  }

  if (flow === undefined && runId === undefined && profileId === undefined) {
    return <OnboardingStart />;
  }

  if (runId === undefined) return <Vs1Start />;

  try {
    const { getConfirmedLifeApplication } = await import("../infrastructure/composition-root");
    const details = await getConfirmedLifeApplication().presentRun(runId);
    return <Vs1Journey details={details} />;
  } catch {
    return (
      <main className="landing landing--error">
        <section className="landing__copy">
          <p className="eyebrow">Запуск недоступен</p>
          <h1>Снимок не удалось открыть</h1>
          <p>Проверьте идентификатор и серверную конфигурацию. Никакие сохранённые данные не изменены.</p>
        </section>
      </main>
    );
  }
}

function MissingCityFrontierSetup() {
  return (
    <main className="landing landing--error">
      <section className="landing__copy">
        <p className="eyebrow">Поиск городов недоступен</p>
        <h1>Исходная страна не найдена</h1>
        <p>Откройте сохранённый результат поиска стран и выберите страну снова.</p>
      </section>
    </main>
  );
}

function MissingCityFrontier() {
  return (
    <main className="landing landing--error">
      <section className="landing__copy">
        <p className="eyebrow">Запуск недоступен</p>
        <h1>Поиск городов не найден</h1>
        <p>Проверьте идентификатор запуска. Доменный вывод не показан.</p>
      </section>
    </main>
  );
}

function UnavailableCityFrontier() {
  return (
    <main className="landing landing--error">
      <section className="landing__copy">
        <p className="eyebrow">Запуск недоступен</p>
        <h1>Снимок не удалось открыть</h1>
        <p>Доменный вывод не показан.</p>
      </section>
    </main>
  );
}

function UnavailableCityPackage() {
  return (
    <main className="landing landing--error">
      <section className="landing__copy">
        <p className="eyebrow">Каталог недоступен</p>
        <h1>Для этой страны нет готового пакета городов</h1>
        <p>Поиск городов не запущен.</p>
      </section>
    </main>
  );
}

function CityCatalogUpgradeRequired() {
  return (
    <main className="landing landing--error">
      <section className="landing__copy">
        <p className="eyebrow">Каталог недоступен</p>
        <h1>Каталог городов нужно обновить, чтобы начать новый поиск.</h1>
      </section>
    </main>
  );
}

function UnavailableColdStart() {
  return (
    <main className="landing landing--error">
      <section className="landing__copy">
        <p className="eyebrow">Запуск недоступен</p>
        <h1>Снимок не удалось открыть</h1>
        <p>Проверьте пару идентификаторов запуска и профиля. Доменный вывод не показан.</p>
      </section>
    </main>
  );
}

function UnavailablePlaceFrontier() {
  return (
    <main className="landing landing--error">
      <section className="landing__copy">
        <p className="eyebrow">Запуск недоступен</p>
        <h1>Снимок не удалось открыть</h1>
        <p>Проверьте идентификатор запуска. Доменный вывод не показан.</p>
      </section>
    </main>
  );
}

function MissingCountryResolution() {
  return (
    <main className="landing landing--error">
      <section className="landing__copy">
        <p className="eyebrow">Разрешение недоступно</p>
        <h1>Разрешение не найдено</h1>
        <p>Откройте сохранённый автоматический результат и начните разрешение снова.</p>
        <a href="?flow=place-frontier">Открыть поиск стран</a>
      </section>
    </main>
  );
}

function UnavailableCountryResolution() {
  return (
    <main className="landing landing--error">
      <section className="landing__copy">
        <p className="eyebrow">Запуск недоступен</p>
        <h1>Снимок не удалось открыть</h1>
        <p>Проверьте идентификатор разрешения. Доменный вывод не показан.</p>
      </section>
    </main>
  );
}
