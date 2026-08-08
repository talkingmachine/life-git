import { Vs1Journey } from "../experience/components/Vs1Journey";

export const dynamic = "force-dynamic";

interface PageProps {
  readonly searchParams: Promise<{
    readonly run?: string | readonly string[];
  }>;
}

function one(value: string | readonly string[] | undefined): string | undefined {
  if (typeof value === "string" || value === undefined) return value;
  return value[0];
}

export default async function Page({ searchParams }: PageProps) {
  const runId = one((await searchParams).run);
  if (runId === undefined) {
    return (
      <main className="landing">
        <section className="landing__copy">
          <p className="eyebrow">VS-1 · подтверждённая жизнь</p>
          <h1>Один маршрут.<br />Проверяемые основания.</h1>
          <p>
            Здесь рассматривается один заранее выбранный кандидат: переезд из России в Тирану.
            Это не мировой поиск, не рейтинг и не подборка лучших вариантов.
          </p>
          <p className="landing__instruction">
            Чтобы открыть сохранённый запуск, передайте его идентификатор в параметре <code>?run=…</code>.
          </p>
        </section>
        <figure className="landing__map">
          <img alt="Схема единственного маршрута Россия — Тирана" src="/world-map.svg" />
          <figcaption><span aria-hidden="true">✈</span> Россия → Тирана</figcaption>
        </figure>
      </main>
    );
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
