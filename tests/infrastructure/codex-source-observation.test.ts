import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { createCitySafetyPublicExcerptProjector } from "../../src/application/city-safety-source-observation";
import { CodexRuntimeError } from "../../src/infrastructure/codex-cli/contracts";
import { snapshotOwnedJson } from "../../src/infrastructure/codex-cli/owned-json";
import { createCodexSourceObservation, SOURCE_OBSERVATION_SCHEMA } from "../../src/infrastructure/codex-cli/source-observation";

const DEFINITION = "si-municipal-police-offences-per-100000@1" as const;
const TEXT = `definitionId=${DEFINITION}\nperiodKind=annual\nmunicipalityCode=061\nreferenceYear=2024\noffenceCount=1234\nnumeratorUnit=offences`;
const metadata = (effort: "low" | "medium") => ({ invocationVersion: "codex-cli-invocation@2", protocolVersion: "codex-cli-protocol@2", compatibilityPolicy: "codex-cli-0.149.0-alpha.4-plus@2", cliVersion: "codex-cli 0.149.0-alpha.4", model: "gpt-5.6-terra", reasoningEffort: effort, toolPolicy: "codex-tools-none@2", templateVersion: "city-safety-source-extract@1", schemaVersion: "source-observation-wire@1" } as const);
const wire = () => ({ schemaVersion: "source-observation-wire@1", definitionId: DEFINITION, periodKind: "annual", offenceCount: "1234", referenceYear: 2024, numeratorUnit: "offences", quote: TEXT, ambiguities: [] });
const result = (effort: "low" | "medium", value: unknown = wire(), webSearchCount = 0) => ({ result: { value, metadata: metadata(effort) }, eventProof: { webSearchCount } });

function fixture() {
  const projector = createCitySafetyPublicExcerptProjector(); const bytes = new TextEncoder().encode(TEXT);
  const projection = projector.project({ schemaVersion: "city-safety-public-capture@1", mediaType: "text/plain", sha256: createHash("sha256").update(bytes).digest("hex"), bytes, provenance: { kind: "official_public", authenticated: false, personalized: false, containsPii: false } });
  const request = (overrides: Record<string, unknown> = {}) => ({ schemaVersion: "source-observation-request@1", countryCode: "SI", cityId: "ljubljana", municipalityCode: "061", factKey: "si-city-safety", definitionId: DEFINITION, expectedPeriod: "annual", expectedNumeratorUnit: "offences", parserVersion: "si-city-safety-observation-parser@1", projection, signal: new AbortController().signal, ...overrides } as const);
  return { projector, projection, request };
}

describe("Codex source observation", () => {
  it("uses exact Terra low and zero tools/search on success", async () => {
    const { projector, request } = fixture(); const invoke = vi.fn().mockResolvedValue(result("low"));
    const port = createCodexSourceObservation({ invokeJsonWithEventProof: invoke } as never, projector);
    await expect(port.observe(request())).resolves.toMatchObject({ definitionId: DEFINITION, periodKind: "annual", offenceCount: "1234" });
    const invocation = invoke.mock.calls[0]![0];
    expect([invocation.capability, invocation.reasoningEffort, invocation.toolPolicy]).toEqual(["source.extract", "low", "codex-tools-none@2"]);
  });

  it("accepts the actual null-prototype runtime JSON snapshot", async () => {
    const { projector, request } = fixture(); const value = snapshotOwnedJson(wire());
    expect(Object.getPrototypeOf(value)).toBeNull();
    const invoke = vi.fn().mockResolvedValue(result("low", value));
    await expect(createCodexSourceObservation({ invokeJsonWithEventProof: invoke } as never, projector).observe(request())).resolves.toMatchObject({ offenceCount: "1234" });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("retries an ordinary extra model key as a schema error", async () => {
    const { projector, request } = fixture(); const invoke = vi.fn().mockResolvedValueOnce(result("low", { ...wire(), extra: "ordinary" })).mockResolvedValueOnce(result("medium"));
    await expect(createCodexSourceObservation({ invokeJsonWithEventProof: invoke } as never, projector).observe(request())).resolves.toMatchObject({ offenceCount: "1234" });
    expect(invoke.mock.calls.map(([call]) => call.reasoningEffort)).toEqual(["low", "medium"]);
  });

  it("retries declared ambiguity and parser mismatch once at medium then closes invalid", async () => {
    for (const bad of [{ ...wire(), ambiguities: ["multiple"] }, { ...wire(), offenceCount: "999" }, { ...wire(), definitionId: `${DEFINITION}-wrong` }, { ...wire(), periodKind: "monthly" }]) {
      const { projector, request } = fixture(); const invoke = vi.fn().mockResolvedValueOnce(result("low", bad)).mockResolvedValueOnce(result("medium", bad));
      const port = createCodexSourceObservation({ invokeJsonWithEventProof: invoke } as never, projector);
      await expect(port.observe(request())).rejects.toMatchObject({ code: "source_observation_invalid" });
      expect(invoke.mock.calls.map(([call]) => call.reasoningEffort)).toEqual(["low", "medium"]);
    }
  });

  it("retries a real parser mismatch at medium and accepts the corrected proposal", async () => {
    const current = fixture(); const invoke = vi.fn().mockResolvedValueOnce(result("low", { ...wire(), offenceCount: "999" })).mockResolvedValueOnce(result("medium"));
    await expect(createCodexSourceObservation({ invokeJsonWithEventProof: invoke } as never, current.projector).observe(current.request())).resolves.toMatchObject({ offenceCount: "1234" });
    expect(invoke.mock.calls.map(([call]) => call.reasoningEffort)).toEqual(["low", "medium"]);
  });

  it("retries trusted invalid JSON once but not tool/protocol failures", async () => {
    const first = fixture(); const invalid = vi.fn().mockRejectedValue(new CodexRuntimeError("codex_json_invalid"));
    await expect(createCodexSourceObservation({ invokeJsonWithEventProof: invalid } as never, first.projector).observe(first.request())).rejects.toMatchObject({ code: "source_observation_invalid" });
    expect(invalid).toHaveBeenCalledTimes(2);
    for (const code of ["codex_tool_event", "codex_protocol_invalid", "codex_rate_limited", "codex_provider_transient", "codex_timeout"] as const) {
      const current = fixture(); const invoke = vi.fn().mockRejectedValue(new CodexRuntimeError(code));
      await expect(createCodexSourceObservation({ invokeJsonWithEventProof: invoke } as never, current.projector).observe(current.request())).rejects.toMatchObject({ code: "source_observation_runtime_failed" });
      expect(invoke).toHaveBeenCalledTimes(1);
    }
  });

  it("fails hostile wire ownership immediately without a retry", async () => {
    const cases: unknown[] = [];
    cases.push(new Proxy(wire(), {}));
    const accessor = wire(); Object.defineProperty(accessor, "quote", { enumerable: true, get: () => TEXT }); cases.push(accessor);
    const symbol = wire(); Object.defineProperty(symbol, Symbol("hidden"), { value: "secret" }); cases.push(symbol);
    const extraArray = ["x"]; Object.defineProperty(extraArray, "extra", { value: "secret", enumerable: true }); cases.push({ ...wire(), ambiguities: extraArray });
    const sparse = new Array<string>(1); cases.push({ ...wire(), ambiguities: sparse });
    const accessorArray = ["x"]; Object.defineProperty(accessorArray, "0", { enumerable: true, get: () => "x" }); cases.push({ ...wire(), ambiguities: accessorArray });
    const cyclic = wire() as Record<string, unknown>; cyclic.quote = cyclic; cases.push(cyclic);
    for (const hostile of cases) {
      const current = fixture(); const invoke = vi.fn().mockResolvedValue(result("low", hostile));
      await expect(createCodexSourceObservation({ invokeJsonWithEventProof: invoke } as never, current.projector).observe(current.request())).rejects.toMatchObject({ code: "source_observation_integrity_failed" });
      expect(invoke).toHaveBeenCalledTimes(1);
    }
  });

  it("requires metadata effort to equal the attempt", async () => {
    const first = fixture(); const initialSwap = vi.fn().mockResolvedValue({ result: { value: wire(), metadata: metadata("medium") }, eventProof: { webSearchCount: 0 } });
    await expect(createCodexSourceObservation({ invokeJsonWithEventProof: initialSwap } as never, first.projector).observe(first.request())).rejects.toMatchObject({ code: "source_observation_integrity_failed" });
    expect(initialSwap).toHaveBeenCalledTimes(1);
    const second = fixture(); const retrySwap = vi.fn()
      .mockResolvedValueOnce(result("low", { schemaVersion: "bad" }))
      .mockResolvedValueOnce({ result: { value: wire(), metadata: metadata("low") }, eventProof: { webSearchCount: 0 } });
    await expect(createCodexSourceObservation({ invokeJsonWithEventProof: retrySwap } as never, second.projector).observe(second.request())).rejects.toMatchObject({ code: "source_observation_integrity_failed" });
    expect(retrySwap).toHaveBeenCalledTimes(2);
  });

  it("rejects fabricated or modified projections before any runtime call", async () => {
    const { projector, projection, request } = fixture(); const invoke = vi.fn(); const port = createCodexSourceObservation({ invokeJsonWithEventProof: invoke } as never, projector);
    await expect(port.observe(request({ projection: { ...projection, text: `${projection.text}\nx=1` } }))).rejects.toMatchObject({ code: "source_observation_integrity_failed" });
    await expect(port.observe(request({ projection: { ...projection, sourceSha256: "0".repeat(64) } }))).rejects.toMatchObject({ code: "source_observation_integrity_failed" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects a structural fake projector at factory construction", () => {
    const invoke = vi.fn(); const fake = Object.freeze({ project: vi.fn(), requireVerified: vi.fn((value) => value) });
    expect(() => createCodexSourceObservation({ invokeJsonWithEventProof: invoke } as never, fake as never)).toThrow("source_observation_integrity_failed");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("uses every semantic field in the outer flight identity", async () => {
    const { projector, request } = fixture(); const resolvers: Array<() => void> = [];
    const invoke = vi.fn().mockImplementation((invocation) => new Promise((resolve) => resolvers.push(() => resolve({ result: { value: wire(), metadata: metadata(invocation.reasoningEffort) }, eventProof: { webSearchCount: 1 } }))));
    const port = createCodexSourceObservation({ invokeJsonWithEventProof: invoke } as never, projector);
    const a = port.observe(request()); const b = port.observe(request({ cityId: "maribor", municipalityCode: "070" }));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    resolvers.splice(0).forEach((resolve) => resolve()); await Promise.allSettled([a, b]);
  });

  it("does not start a late medium attempt after waiter abort", async () => {
    const { projector, request } = fixture(); let release!: () => void;
    const invoke = vi.fn().mockImplementation(() => new Promise((_resolve, reject) => { release = () => reject(new CodexRuntimeError("codex_json_invalid")); }));
    const controller = new AbortController(); shadowAbortMethods(controller.signal); const port = createCodexSourceObservation({ invokeJsonWithEventProof: invoke } as never, projector);
    const pending = port.observe(request({ signal: controller.signal }));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1)); controller.abort(); release();
    await expect(pending).rejects.toMatchObject({ code: "source_observation_aborted" });
    await Promise.resolve(); expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("shares one deadline and does not start medium after it expires", async () => {
    const { projector, request } = fixture(); const invoke = vi.fn().mockRejectedValue(new CodexRuntimeError("codex_json_invalid"));
    const ticks = [0, 10, 60_001]; const port = createCodexSourceObservation({ invokeJsonWithEventProof: invoke } as never, projector, { monotonicNowMs: () => ticks.shift() ?? 60_001 });
    await expect(port.observe(request())).rejects.toMatchObject({ code: "source_observation_runtime_failed" });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("keeps one outer leader when one shadowed waiter aborts and another survives", async () => {
    const { projector, request } = fixture(); let release!: () => void;
    const invoke = vi.fn().mockImplementation(() => new Promise((resolve) => { release = () => resolve(result("low")); }));
    const port = createCodexSourceObservation({ invokeJsonWithEventProof: invoke } as never, projector);
    const firstController = new AbortController(); shadowAbortMethods(firstController.signal);
    const secondController = new AbortController(); shadowAbortMethods(secondController.signal);
    const first = port.observe(request({ signal: firstController.signal })); const second = port.observe(request({ signal: secondController.signal }));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1)); firstController.abort(new DOMException("detached", "AbortError"));
    await expect(first).rejects.toMatchObject({ code: "source_observation_aborted" }); release();
    await expect(second).resolves.toMatchObject({ offenceCount: "1234" }); expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("omits raw ignored fields and source hashes from prompt and deeply freezes schema", async () => {
    const projector = createCitySafetyPublicExcerptProjector(); const raw = JSON.stringify({ definitionId: DEFINITION, periodKind: "annual", municipalityCode: "061", referenceYear: 2024, offenceCount: "1234", numeratorUnit: "offences", ignored: "RAW_PRIVATE_MARKER" }); const bytes = new TextEncoder().encode(raw);
    const projection = projector.project({ schemaVersion: "city-safety-public-capture@1", mediaType: "application/json", sha256: createHash("sha256").update(bytes).digest("hex"), bytes, provenance: { kind: "official_public", authenticated: false, personalized: false, containsPii: false } });
    const invoke = vi.fn().mockResolvedValue(result("low")); const port = createCodexSourceObservation({ invokeJsonWithEventProof: invoke } as never, projector);
    await port.observe(fixtureRequest(projection)); const prompt = invoke.mock.calls[0]![0].prompt as string;
    expect(prompt).not.toContain("RAW_PRIVATE_MARKER"); expect(prompt).not.toContain(projection.sourceSha256); expectDeepFrozen(SOURCE_OBSERVATION_SCHEMA);
  });
});

function fixtureRequest(projection: ReturnType<ReturnType<typeof createCitySafetyPublicExcerptProjector>["project"]>) { return { schemaVersion: "source-observation-request@1", countryCode: "SI", cityId: "ljubljana", municipalityCode: "061", factKey: "si-city-safety", definitionId: DEFINITION, expectedPeriod: "annual", expectedNumeratorUnit: "offences", parserVersion: "si-city-safety-observation-parser@1", projection, signal: new AbortController().signal } as const; }
function shadowAbortMethods(signal: AbortSignal): void { Object.defineProperties(signal, { aborted: { value: false }, reason: { get: () => { throw new Error("shadow reason"); } }, addEventListener: { value: () => undefined }, removeEventListener: { value: () => undefined } }); }
function expectDeepFrozen(value: unknown): void { if (value === null || typeof value !== "object") return; expect(Object.isFrozen(value)).toBe(true); for (const child of Object.values(value)) expectDeepFrozen(child); }
