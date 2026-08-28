import { describe, expect, test, vi } from "vitest";

import {
  OfficialSourceDiscoveryError,
  type OfficialSourceDiscoveryRequest,
} from "../../src/application/official-source-discovery";
import {
  createCodexOfficialSourceDiscovery,
  OFFICIAL_SOURCE_CANDIDATES_SCHEMA,
} from "../../src/infrastructure/codex-cli/official-source-discovery";
import {
  CODEX_CLI_COMPATIBILITY_POLICY,
  CODEX_CLI_PROTOCOL_VERSION,
  CODEX_CLI_VERSION,
  CODEX_INVOCATION_VERSION,
  CODEX_MODEL,
  CodexRuntimeError,
  type CodexJsonInvocation,
  type CodexJsonResult,
} from "../../src/infrastructure/codex-cli/contracts";
import type { CodexCliModelAdapter } from "../../src/infrastructure/codex-cli/model-adapter";

function request(): OfficialSourceDiscoveryRequest {
  return {
    schemaVersion: "official-source-discovery-request@1",
    entity: { entityId: "country-rs", kind: "country", countryCode: "RS", displayName: "Serbia" },
    fact: { factKey: "residence.permit", definitionId: "residence-permit@1", description: "Residence permit requirements" },
    failedSource: { url: "https://www.mup.gov.rs/", reason: "stale" },
    authorityRoots: [{ publisherName: "Ministry of Interior", url: "https://www.mup.gov.rs/" }],
    localeHints: ["en", "sr"],
    round: 1,
    signal: new AbortController().signal,
  };
}

function metadata(): CodexJsonResult["metadata"] {
  return {
    invocationVersion: CODEX_INVOCATION_VERSION, protocolVersion: CODEX_CLI_PROTOCOL_VERSION,
    compatibilityPolicy: CODEX_CLI_COMPATIBILITY_POLICY, cliVersion: CODEX_CLI_VERSION,
    model: CODEX_MODEL, reasoningEffort: "medium", toolPolicy: "codex-tools-web-search@1",
    templateVersion: "official-source-discover@1", schemaVersion: "official-source-candidates@1",
  };
}

function runtime(value: unknown, resultMetadata: unknown = metadata(), webSearchCount = 1): { runtime: CodexCliModelAdapter; invoke: ReturnType<typeof vi.fn> } {
  const invoke = vi.fn(async (input: CodexJsonInvocation) => {
    void input;
    return { result: { value, metadata: resultMetadata }, eventProof: { webSearchCount } };
  });
  return { runtime: { invokeJsonWithEventProof: invoke } as unknown as CodexCliModelAdapter, invoke };
}

describe("Codex official source discovery", () => {
  test("uses one bounded search invocation and returns only frozen untrusted URL candidates", async () => {
    const { runtime: adapter, invoke } = runtime({ candidates: [{
      url: "https://www.mup.gov.rs/wps/portal/en/", claimedPublisher: "Ministry of Interior",
      expectedCoverage: "Residence permits", rationale: "First-party immigration guidance",
    }] });

    const result = await createCodexOfficialSourceDiscovery(adapter).discover(request());

    expect(invoke).toHaveBeenCalledTimes(1);
    const call = invoke.mock.calls[0][0] as CodexJsonInvocation;
    expect(call).toMatchObject({ capability: "source.discover", reasoningEffort: "medium", toolPolicy: "codex-tools-web-search@1", templateVersion: "official-source-discover@1", schemaVersion: "official-source-candidates@1" });
    expect(call.outputSchema).toEqual(OFFICIAL_SOURCE_CANDIDATES_SCHEMA);
    expect(JSON.parse(call.prompt)).toEqual(expect.objectContaining({ untrustedData: true }));
    expect(call.prompt).not.toContain("signal");
    expect(result.candidates[0]).toEqual({ url: "https://www.mup.gov.rs/wps/portal/en/", claimedPublisher: "Ministry of Interior", expectedCoverage: "Residence permits", rationale: "First-party immigration guidance" });
    expect(Object.keys(result.candidates[0])).toEqual(["url", "claimedPublisher", "expectedCoverage", "rationale"]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.candidates)).toBe(true);
    expect(Object.isFrozen(result.candidates[0])).toBe(true);
  });

  test("rejects a source discovery result that did not prove a real web search", async () => {
    const { runtime: adapter } = runtime({ candidates: [] }, metadata(), 0);
    await expect(createCodexOfficialSourceDiscovery(adapter).discover(request())).rejects.toMatchObject({
      code: "official_source_discovery_runtime_failed", runtimeCode: "codex_tool_event",
    });
  });

  test.each([
    { candidates: Array.from({ length: 6 }, () => ({ url: "https://example.com/", claimedPublisher: "A", expectedCoverage: "B", rationale: "C" })) },
    { candidates: [{ url: "https://example.com/", claimedPublisher: "A", expectedCoverage: "B", rationale: "C" }, { url: "https://example.com/", claimedPublisher: "D", expectedCoverage: "E", rationale: "F" }] },
    { candidates: [{ url: "http://example.com/", claimedPublisher: "A", expectedCoverage: "B", rationale: "C" }] },
    { candidates: [{ url: "https://[::1]/", claimedPublisher: "A", expectedCoverage: "B", rationale: "C" }] },
    { candidates: [{ url: "https://localhost./", claimedPublisher: "A", expectedCoverage: "B", rationale: "C" }] },
    { candidates: [{ url: "https://api.localhost./", claimedPublisher: "A", expectedCoverage: "B", rationale: "C" }] },
    { candidates: [{ url: "https://localhost../", claimedPublisher: "A", expectedCoverage: "B", rationale: "C" }] },
    { candidates: [{ url: "https://api.localhost../", claimedPublisher: "A", expectedCoverage: "B", rationale: "C" }] },
    { candidates: [{ url: "https://official.example./", claimedPublisher: "A", expectedCoverage: "B", rationale: "C" }] },
    { candidates: [{ url: "https://official..example/", claimedPublisher: "A", expectedCoverage: "B", rationale: "C" }] },
    { candidates: [{ url: "https://example.com/", claimedPublisher: "A", expectedCoverage: "B", rationale: "C", official: true }] },
  ])("fails closed for invalid model candidates", async (value) => {
    const { runtime: adapter } = runtime(value);
    await expect(createCodexOfficialSourceDiscovery(adapter).discover(request())).rejects.toBeInstanceOf(OfficialSourceDiscoveryError);
  });

  test.each([
    new Proxy(request(), {}),
    { ...request(), entity: new Proxy(request().entity, {}) },
    { ...request(), fact: Object.defineProperty(request().fact, "description", { enumerable: true, get: () => "trap" }) },
    { ...request(), failedSource: { ...request().failedSource as object, extra: true } },
  ])("rejects malformed request before the adapter call", async (input) => {
    const { runtime: adapter, invoke } = runtime({ candidates: [] });
    await expect(createCodexOfficialSourceDiscovery(adapter).discover(input as never)).rejects.toBeInstanceOf(OfficialSourceDiscoveryError);
    expect(invoke).not.toHaveBeenCalled();
  });

  test.each([
    new Proxy(metadata(), {}),
    { ...metadata(), extra: true },
    { ...metadata(), toolPolicy: "codex-tools-none@2" },
  ])("rejects malformed or mismatched metadata without candidates", async (resultMetadata) => {
    const { runtime: adapter } = runtime({ candidates: [] }, resultMetadata);
    await expect(createCodexOfficialSourceDiscovery(adapter).discover(request())).rejects.toMatchObject({
      code: "official_source_discovery_integrity_failed",
    });
  });

  test("does not decode a deferred result after the caller aborts", async () => {
    const controller = new AbortController();
    let finish: ((value: CodexJsonResult) => void) | undefined;
    const invoke = vi.fn(() => new Promise<CodexJsonResult>((resolve) => { finish = resolve; }));
    const adapter = { invokeJsonWithEventProof: invoke } as unknown as CodexCliModelAdapter;
    const discovery = createCodexOfficialSourceDiscovery(adapter).discover({ ...request(), signal: controller.signal });
    controller.abort();
    finish?.({ result: { value: { candidates: [] }, metadata: new Proxy(metadata(), {}) }, eventProof: { webSearchCount: 1 } } as never);
    await expect(discovery).rejects.toMatchObject({ code: "official_source_discovery_aborted" });
  });

  test("contains an error prototype spoof without exposing its message", async () => {
    const spoof = Object.setPrototypeOf(new Error("private trap text"), OfficialSourceDiscoveryError.prototype);
    const invoke = vi.fn(async () => { throw spoof; });
    const adapter = { invokeJsonWithEventProof: invoke } as unknown as CodexCliModelAdapter;
    await expect(createCodexOfficialSourceDiscovery(adapter).discover(request())).rejects.toMatchObject({
      code: "official_source_discovery_invalid",
      message: "official_source_discovery_invalid",
    });
  });

  test("maps a genuine typed runtime failure without its message", async () => {
    const invoke = vi.fn(async () => { throw new CodexRuntimeError("codex_timeout"); });
    const adapter = { invokeJsonWithEventProof: invoke } as unknown as CodexCliModelAdapter;
    await expect(createCodexOfficialSourceDiscovery(adapter).discover(request())).rejects.toMatchObject({
      code: "official_source_discovery_runtime_failed",
      runtimeCode: "codex_timeout",
      message: "official_source_discovery_runtime_failed",
    });
  });
});
