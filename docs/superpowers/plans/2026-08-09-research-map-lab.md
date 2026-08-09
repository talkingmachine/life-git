# Research Map Lab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить временную `/lab/research-map`, которая автоматически проигрывает полноэкранное исследование 1–5 случайных городов и позволяет утвердить финальный визуал до очистки лабораторного кода.

**Architecture:** Продуктовый `ResearchMapStage` отвечает только за развёрнутую карту, markers и активный полёт. Lab-only генератор заранее создаёт синтетический сценарий, а `ResearchMapLab` последовательно переводит города `hidden → pending → terminal`. Существующий `ResearchMap` остаётся совместимым wrapper: terminal green по-прежнему показывает collapsed summary, остальные состояния используют shared stage.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 6, CSS, Vitest 4, Testing Library.

## Global Constraints

- Рабочая ветка: `design/research-map-lab`, основана на `feat/vs1-confirmed-life`.
- `/lab/research-map` не обращается к сети, LLM, server actions или SQLite.
- Один запуск заранее выбирает 1–5 уникальных городов из фиксированного пула из восьми записей.
- Один город проходит `pending` 900–1600 мс, затем получает `green`, `yellow` или `red`; только после этого начинается следующий.
- Карта лаборатории занимает `100svh`, не сворачивается и сохраняет завершённые markers до нового запуска.
- Во время проигрывания кнопка отключена; после завершения показывает `Запустить заново`.
- Marker всегда имеет цвет, отдельную icon/spinner semantics и текст.
- `prefers-reduced-motion` убирает перемещение, но не последовательность состояний.
- Никаких промежуточных коммитов. Первый коммит разрешён только после визуального утверждения, удаления lab-only кода и успешного parity-gate.
- Существующие `.pnpm-store/v11/*` не принадлежат задаче: не изменять и не добавлять в git.

---

### Task 1: Детерминируемый генератор лабораторного сценария

**Files:**
- Create: `src/experience/lab/research-map-scenario.ts`
- Create: `tests/experience/research-map-scenario.test.ts`

**Interfaces:**
- Consumes: `CandidateState` из `src/experience/components/ResearchMap.tsx`.
- Produces:

```ts
export interface LabResearchCity {
  readonly id: string;
  readonly destination: string;
  readonly point: { readonly x: number; readonly y: number };
  readonly terminalStatus: Exclude<CandidateState, "pending">;
  readonly delayMs: number;
}

export function createResearchMapScenario(
  random?: () => number,
): readonly LabResearchCity[];
```

- [ ] **Step 1: Прочитать правила хороших тестов**

Read fully: `superpowers:test-driven-development/writing-good-tests.md` относительно каталога TDD-skill.

- [ ] **Step 2: Написать failing generator tests**

Проверить реальный public API:

```ts
it("creates one to five unique cities from an injected random sequence", () => {
  const values = [0.4, 0.9, 0.1, 0.7, 0.3, 0.2, 0.8, 0.5, 0.6, 0.4];
  let cursor = 0;
  const scenario = createResearchMapScenario(() => values[cursor++ % values.length]!);

  expect(scenario).toHaveLength(3);
  expect(new Set(scenario.map((city) => city.id)).size).toBe(3);
  expect(scenario.every((city) => city.delayMs >= 900 && city.delayMs <= 1600)).toBe(true);
  expect(scenario.every((city) => ["green", "yellow", "red"].includes(city.terminalStatus))).toBe(true);
});
```

Добавить отдельный boundary-test с RNG `() => 0` для одного города и `() => 0.999999` для пяти.

- [ ] **Step 3: Запустить тест и подтвердить RED**

Run: `pnpm test tests/experience/research-map-scenario.test.ts`
Expected: FAIL, модуль `research-map-scenario` отсутствует.

- [ ] **Step 4: Реализовать минимальный pure generator**

Создать frozen pool из восьми городов и Fisher–Yates selection без повторов. Количество:

```ts
const count = 1 + Math.floor(random() * 5);
```

Задержка:

```ts
const delayMs = 900 + Math.floor(random() * 701);
```

Terminal status выбирать индексом из `(["green", "yellow", "red"] as const)`. Нормализовать значение RNG в диапазон `[0, 1)`, чтобы переданная функция не могла создать индекс за границей.

- [ ] **Step 5: Запустить test и typecheck**

Run: `pnpm test tests/experience/research-map-scenario.test.ts`
Expected: PASS.

Run: `pnpm typecheck`
Expected: PASS.

Не коммитить.

---

### Task 2: Shared полноэкранный `ResearchMapStage`

**Files:**
- Modify: `src/experience/components/ResearchMap.tsx`
- Modify: `src/experience/lab/research-map-scenario.ts`
- Modify: `src/experience/view-model.ts`
- Modify: `src/experience/components/Vs1Journey.tsx`
- Modify: `src/app/globals.css`
- Modify: `tests/integration/experience.test.tsx`

**Interfaces:**
- Consumes: structural coordinates из `LabResearchCity`.
- Produces:

```ts
export interface MapPoint {
  readonly x: number;
  readonly y: number;
}

export interface ResearchFlight {
  readonly key: string;
  readonly from: MapPoint;
  readonly to: MapPoint;
  readonly label: string;
}

export interface ResearchCandidate {
  readonly id: string;
  readonly origin: string;
  readonly destination: string;
  readonly status: CandidateState;
  readonly point?: MapPoint;
  readonly reason?: {
    readonly summary: string;
    readonly officialUrl?: string;
  };
}

export interface ResearchMapStageProps {
  readonly candidates: readonly ResearchCandidate[];
  readonly flight?: ResearchFlight;
  readonly fullscreen?: boolean;
}

export function ResearchMapStage(props: ResearchMapStageProps): React.JSX.Element;
```

- [ ] **Step 1: Написать failing shared-stage test**

В `tests/integration/experience.test.tsx` импортировать `ResearchMapStage` и проверить:

```tsx
render(
  <ResearchMapStage
    fullscreen
    flight={{
      key: "moscow-lisbon",
      from: { x: 67, y: 28 },
      to: { x: 45, y: 43 },
      label: "Самолёт летит из России в Лиссабон",
    }}
    candidates={[
      { id: "lisbon", origin: "Россия", destination: "Лиссабон", status: "green", point: { x: 45, y: 43 } },
      { id: "vienna", origin: "Лиссабон", destination: "Вена", status: "pending", point: { x: 54, y: 36 } },
    ]}
  />,
);

const map = screen.getByRole("region", { name: /карта проверки маршрута/i });
expect(map.getAttribute("data-fullscreen")).toBe("true");
expect(within(map).getAllByRole("listitem")).toHaveLength(2);
expect(within(map).getByRole("img", { name: /россии в лиссабон/i })).toBeTruthy();
expect(within(map).getByRole("status", { name: /идёт проверка/i })).toBeTruthy();
```

- [ ] **Step 2: Запустить focused test и подтвердить RED**

Run: `pnpm test tests/integration/experience.test.tsx -t "shared full-screen research stage"`
Expected: FAIL, export `ResearchMapStage` отсутствует.

- [ ] **Step 3: Выделить stage без изменения существующей семантики wrapper**

- Экспортировать `MapPoint` из production component boundary и заменить structural type в
  `LabResearchCity` на type-only import. Product code после этого не зависит от lab.
- `ResearchMapStage` рендерит art, coordinate pins, status rail и активный самолёт.
- Inline CSS variables содержат только проценты координат и угол маршрута.
- `ResearchMap` при `mode === "green"` сохраняет текущий collapsed markup.
- Для `pending`, `yellow`, `red` wrapper вызывает `ResearchMapStage`; retry UI остаётся внутри wrapper.
- Candidate без `point` продолжает отображаться в status rail, поэтому старые callers не ломаются.
- `createJourneyView` добавляет Тиране фиксированную display-coordinate; это presentation metadata, не evidence claim.

- [ ] **Step 4: Реализовать CSS stage**

Добавить:

- `research-map--fullscreen { min-height: 100svh; border-radius: 0; }` для lab route;
- coordinate pins через `left/top` в процентах;
- flight через `--flight-from-x/y`, `--flight-to-x/y`, `--flight-angle`;
- status rail, в котором видны все появившиеся города;
- reduced-motion override, фиксирующий самолёт у destination без движения.

Не добавлять lab toolbar или random styles в shared selectors.

- [ ] **Step 5: Запустить focused и существующие visual tests**

Run: `pnpm test tests/integration/experience.test.tsx`
Expected: все tests PASS, включая pending map, green collapse и yellow/red reason.

Run: `pnpm typecheck`
Expected: PASS.

Не коммитить.

---

### Task 3: Автоматический lab playback и route

**Files:**
- Create: `src/experience/lab/ResearchMapLab.tsx`
- Create: `src/experience/lab/ResearchMapLab.module.css`
- Create: `src/app/lab/research-map/page.tsx`
- Create: `tests/experience/research-map-lab.test.tsx`

**Interfaces:**
- Consumes: `createResearchMapScenario`, `LabResearchCity`, `ResearchMapStage`, `ResearchCandidate`, `ResearchFlight` и lab CSS module.
- Produces:

```ts
interface ResearchMapLabProps {
  readonly createScenario?: () => readonly LabResearchCity[];
  readonly schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  readonly cancel?: (handle: ReturnType<typeof setTimeout>) => void;
}

export function ResearchMapLab(props: ResearchMapLabProps): React.JSX.Element;
```

Production route uses defaults; injected functions exist only to make sequencing deterministic in tests.

- [ ] **Step 1: Написать failing playback test**

Использовать controlled scheduler, который складывает callbacks в очередь. Проверить:

1. До запуска карта пустая, кнопка `Запустить исследование` активна.
2. После click первый город pending, второй ещё отсутствует, кнопка disabled.
3. После первого callback первый terminal и второй pending.
4. После последнего callback оба terminal, кнопка показывает `Запустить заново` и снова активна.

Assert делать по доступным ролям и тексту, не по React state и не по private timers.

- [ ] **Step 2: Запустить test и подтвердить RED**

Run: `pnpm test tests/experience/research-map-lab.test.tsx`
Expected: FAIL, `ResearchMapLab` отсутствует.

- [ ] **Step 3: Реализовать один cancellable scheduler**

State лаборатории:

```ts
type PlaybackState =
  | { readonly phase: "idle"; readonly visible: readonly ResearchCandidate[] }
  | { readonly phase: "running"; readonly scenario: readonly LabResearchCity[]; readonly index: number; readonly visible: readonly ResearchCandidate[] }
  | { readonly phase: "complete"; readonly visible: readonly ResearchCandidate[] };
```

На старте создать сценарий ровно один раз. Для первого города добавить pending candidate и flight из фиксированной точки России. Callback заменяет pending на terminal и либо добавляет следующий pending с flight от предыдущего города, либо завершает run. Хранить один timeout handle в `useRef`; отменять его перед новым run и при unmount.

- [ ] **Step 4: Создать lab route и изолированные стили**

`src/app/lab/research-map/page.tsx` только рендерит `<ResearchMapLab />` и не импортирует composition root/actions.

Lab toolbar оформляется через `ResearchMapLab.module.css`, находится поверх карты, имеет явную
synthetic label и не меняет размеры shared stage. В `globals.css` не добавлять lab-only selectors.

- [ ] **Step 5: Запустить lab tests и regression suite**

Run: `pnpm test tests/experience/research-map-lab.test.tsx tests/experience/research-map-scenario.test.ts tests/integration/experience.test.tsx`
Expected: PASS.

Run: `pnpm typecheck`
Expected: PASS.

Run: `pnpm lint`
Expected: PASS.

Не коммитить.

---

### Task 4: Открыть лабораторию и провести визуальные итерации

**Files:**
- Modify as approved: `src/experience/components/ResearchMap.tsx`
- Modify as approved: `src/app/globals.css`
- Modify only if behavior changes: `tests/integration/experience.test.tsx`

**Interfaces:**
- Consumes: `/lab/research-map` from Task 3.
- Produces: пользовательское визуальное утверждение shared map.

- [ ] **Step 1: Получить отдельное явное разрешение на browser use**

Перед запуском браузерной автоматизации сообщить пользователю точный локальный URL и дождаться разрешения согласно `AGENTS.md`.

- [ ] **Step 2: Запустить dev server с isolated config**

Использовать отдельный временный `DATABASE_PATH` и локальный непроизводственный HMAC key, хотя lab route не должен к ним обращаться. Открыть `/lab/research-map`.

- [ ] **Step 3: Проверить 1–5-city playback**

Несколько раз нажать кнопку и подтвердить:

- каждый run содержит 1–5 уникальных городов;
- одновременно pending только текущий город;
- завершённые markers остаются;
- самолёт меняет маршрут перед следующим городом;
- кнопка disabled во время run и снова активна после;
- карта остаётся `100svh` после завершения;
- browser console не содержит warn/error.

- [ ] **Step 4: Итеративно менять только shared visual**

Каждое изменение разметки/стилей сопровождается focused test, typecheck и повторным просмотром lab page. Lab controls не адаптировать под production beyond необходимой читаемости.

- [ ] **Step 5: Остановиться на visual approval**

Не удалять лабораторию и не коммитить, пока пользователь явно не утвердит вариант.

---

### Task 5: Удалить лабораторию и выполнить parity-gate

**Precondition:** пользователь явно утвердил визуал из Task 4.

**Files:**
- Delete: `src/app/lab/research-map/page.tsx`
- Delete: `src/experience/lab/ResearchMapLab.tsx`
- Delete: `src/experience/lab/ResearchMapLab.module.css`
- Delete: `src/experience/lab/research-map-scenario.ts`
- Delete: `tests/experience/research-map-lab.test.tsx`
- Delete: `tests/experience/research-map-scenario.test.ts`
- Modify: `src/experience/components/ResearchMap.tsx`
- Modify: `src/experience/view-model.ts`
- Modify: `src/experience/components/Vs1Journey.tsx`
- Modify: `src/app/globals.css`
- Modify: `tests/integration/experience.test.tsx`
- Modify: `docs/superpowers/specs/2026-08-09-research-map-lab-design.md`
- Modify: `docs/superpowers/plans/2026-08-09-research-map-lab.md`

**Interfaces:**
- Consumes: утверждённый shared visual и настоящий product candidate.
- Produces: production-only map без lab route/control/random/timers.

- [ ] **Step 1: Зафиксировать утверждённый reference вне git**

Снять screenshot при согласованном viewport. Выполнить:

```bash
shasum -a 256 src/experience/components/ResearchMap.tsx src/app/globals.css public/world-map.svg
```

Сохранить точный output в рабочем отчёте сессии. Не добавлять screenshot или hash manifest в git.

- [ ] **Step 2: Удалить lab-only файлы и selectors**

Удалить route, controller, generator, CSS module и их tests. Не изменять shared stage, `globals.css`, coordinate pins, flight или reduced-motion styles.

- [ ] **Step 3: Проверить hash parity**

Повторить `shasum`. Hash `ResearchMap.tsx`, `globals.css` и `world-map.svg` должен точно совпасть с
утверждённым набором. При любом различии остановиться и снова показать визуал пользователю.
Проверить staged diff: строк `lab`, `synthetic`, random generator и toolbar быть не должно.

- [ ] **Step 4: Выполнить все automated gates**

Run: `git diff --check`
Expected: no output.

Run: `pnpm test`
Expected: all tests PASS.

Run: `pnpm typecheck`
Expected: PASS.

Run: `pnpm lint`
Expected: PASS.

Run: `pnpm build`
Expected: PASS. После build удалить только generated Next files/changes через `apply_patch`, не трогая пользовательские файлы.

- [ ] **Step 5: Проверить настоящий browser flow**

После нового явного разрешения на browser use пройти настоящий `pending → terminal` flow при том же viewport. Сравнить геометрию, markers, полёт и reduced-motion с утверждённым reference; console warn/error должен быть пуст. Lab route должен возвращать 404.

- [ ] **Step 6: Проверить финальный staged scope**

В staging разрешены только production component/style/test/docs changes. `.pnpm-store`, lab route, generator, scheduler, synthetic copy и временные screenshots запрещены.

- [ ] **Step 7: Создать первый коммит и push**

Только после успешного parity-gate:

```bash
git commit -m "feat: refine research map journey"
git push -u origin design/research-map-lab
```

PR и merge не создавать без отдельного запроса пользователя.
