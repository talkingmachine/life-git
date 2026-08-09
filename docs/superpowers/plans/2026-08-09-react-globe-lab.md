# React Globe Research Lab Implementation Plan

**Goal:** Заменить плоский визуал временной `/lab/research-map` на конечный полноэкранный `react-globe.gl`-эксперимент с последовательным случайным исследованием 1–5 городов, 3D-самолётом и HTML-overlay.

**Architecture:** Существующий `ResearchMapLab` сохраняет проверенный controller запуска, последовательности, restart и stale-callback protection. Новый lab-only `ResearchGlobeCanvas` отвечает только за WebGL: globe, arcs, camera, markers и GLTF plane animation. `ResearchMapStage` получает узкий visual slot и остаётся HTML status-overlay и плоским fallback; product callers продолжают использовать default visual без изменения data flow.

**Stack:** Next.js 16 App Router, React 19, TypeScript 6, `react-globe.gl@2.38.0`, `three@0.183.2`, local GLTF, Vitest/Testing Library.

## Global constraints

- Рабочая ветка `design/research-map-lab`; никаких промежуточных commit/stage.
- Не менять production actions, DB, LLM, evidence/source pipeline или правила assessment.
- `/lab/research-map` не делает runtime network requests.
- Один запуск создаёт новый случайный сценарий 1–5 уникальных городов; проверки идут строго последовательно.
- Камера переводится к активному destination; активный route показан светящейся дугой; GLTF-plane летит по сферической дуге и ориентируется по касательной.
- Pending marker серый со spinner/status; terminal markers green/yellow/red остаются до нового запуска.
- Cards/button/copy остаются HTML поверх WebGL.
- Button disabled during run; lab never collapses after completion.
- `prefers-reduced-motion`: no per-frame travel, immediate destination placement/camera, sequence preserved.
- Cancel RAF/model-load side effects on unmount and ignore stale flight callbacks.
- If WebGL is unavailable or renderer initialization fails, show only the existing flat `ResearchMapStage`; no parallel feature system.
- Удалить глобальное toast-представление `[role="alert"]`; semantic inline alerts сохраняются.
- Tests cover launch/restart sequence already owned by controller plus globe cleanup, reduced motion and fallback boundaries. Do not test Three.js internals or visual geometry in jsdom.
- `.pnpm-store` and unrelated dirty files remain untouched.

---

### Task 1: Полный lab-only 3D globe flow

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `src/app/globals.css`
- Modify: `src/experience/components/ResearchMap.tsx`
- Modify: `src/experience/lab/research-map-scenario.ts`
- Modify: `src/experience/lab/ResearchMapLab.tsx`
- Modify: `src/experience/lab/ResearchMapLab.module.css`
- Create: `src/experience/lab/ResearchGlobeCanvas.tsx`
- Create: `src/experience/lab/globe-flight.ts`
- Create: `public/models/research-plane.gltf`
- Modify/Create focused tests under `tests/experience/`

- [ ] Install exact compatible globe/Three dependencies without commit or stage.
- [ ] Add geographic coordinates to all eight synthetic cities and retain existing flat coordinates for fallback.
- [ ] Add a narrow optional visual slot to `ResearchMapStage`; default production output remains the flat map. Make fullscreen canvas fill the viewport and keep status UI as HTML overlay.
- [ ] Delete the global sticky toast CSS block for `[role="alert"]`.
- [ ] Build a client-only dynamically imported globe canvas with a dark stylized material, atmosphere/graticules, `arcsData`, status points/rings and camera `pointOfView` transitions.
- [ ] Load a lightweight local embedded-buffer GLTF plane through `GLTFLoader`; render it through `customLayerData/customThreeObject`.
- [ ] Animate along a great-circle/spherical arc using `getCoords`; update position and tangent orientation per RAF; cancel and invalidate on flight change/unmount.
- [ ] Honor reduced motion and expose a simple `onUnavailable` fallback signal for WebGL/context/renderer failure.
- [ ] Wire the existing complete random 1–5 playback to globe routes while preserving all completed markers and fresh restart replacement.
- [ ] Use TDD for observable controller/globe lifecycle contracts; run focused tests, full relevant regression, typecheck, lint and build. Do not commit.

---

### Task 2: Browser handoff and visual iteration

- [ ] Ask for fresh explicit browser permission.
- [ ] Start the local server and open `/lab/research-map` visibly.
- [ ] Leave final visual assessment to the user; implement only the concrete corrections they request.
- [ ] Do not clean lab dependencies or commit until explicit final visual approval.
