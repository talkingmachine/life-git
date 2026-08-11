import { ColdStartJourney } from "../experience/components/ColdStartJourney";
import { ColdStartStart } from "../experience/components/ColdStartStart";
import { Vs1Journey } from "../experience/components/Vs1Journey";
import { Vs1Start } from "../experience/components/Vs1Start";

export const dynamic = "force-dynamic";

interface PageProps {
  readonly searchParams: Promise<{
    readonly flow?: string | readonly string[];
    readonly profile?: string | readonly string[];
    readonly run?: string | readonly string[];
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

  if (runId === undefined) {
    return <Vs1Start />;
  }

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
