import { Vs1Journey } from "../experience/components/Vs1Journey";
import { Vs1Start } from "../experience/components/Vs1Start";

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
