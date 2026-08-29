import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, test, vi } from "vitest";

import { MAX_CODEX_EVENTS, MAX_CODEX_STDOUT_BYTES } from "../../src/infrastructure/codex-cli/contracts";
import {
  parseCodexEventStream,
  parseCodexEventStreamWithProof,
} from "../../src/infrastructure/codex-cli/event-stream";

const LIMITS = { maxStdoutBytes: 65_536, maxEvents: 16 };

async function fixture(name: string): Promise<AsyncIterable<Uint8Array>> {
  return streamOf(new TextEncoder().encode(await readFile(resolve("tests/fixtures/codex-cli", name), "utf8")));
}

function line(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value)}\n`);
}

async function* streamOf(...chunks: readonly Uint8Array[]): AsyncGenerator<Uint8Array> {
  yield* chunks;
}

function completedMessageEvents(message = "completed answer"): Uint8Array[] {
  return [
    line({ type: "thread.started", thread_id: "thread-1" }),
    line({ type: "turn.started" }),
    line({ type: "item.started", item: { type: "reasoning", id: "reasoning-1" } }),
    line({ type: "item.completed", item: { type: "reasoning", id: "reasoning-1" } }),
    line({ type: "item.completed", item: { type: "agent_message", text: message } }),
    line({ type: "turn.completed" }),
  ];
}

const REVIEWED_NOTICES = [
  {
    id: "item_0",
    message: "Configured value for `approval_policy` is disallowed by requirements; falling back to required value UnlessTrusted. Details: invalid value for `approval_policy`: `Never` is not in the allowed set [UnlessTrusted, OnRequest] (set by MDM com.openai.codex:requirements_toml_base64)",
  },
  {
    id: "item_1",
    message: "Code Mode is unavailable because code-mode host is disabled. Code mode will fail closed; enable `features.code_mode_host` and install `codex-code-mode-host`.",
  },
] as const;

function proofEvents(message = "completed answer"): Uint8Array[] {
  return [
    line({ type: "thread.started", thread_id: "thread-1" }),
    ...REVIEWED_NOTICES.map((notice) => line({ type: "item.completed", item: { ...notice, type: "error" } })),
    line({ type: "turn.started" }),
    line({ type: "item.started", item: { type: "reasoning", id: "reasoning-1" } }),
    line({ type: "item.completed", item: { type: "reasoning", id: "reasoning-1" } }),
    line({ type: "item.completed", item: { type: "agent_message", id: "item_2", text: message } }),
    line({ type: "turn.completed", usage: validUsage() }),
  ];
}

function validUsage(): Record<string, number> {
  return {
    input_tokens: 1,
    cached_input_tokens: 0,
    cache_write_input_tokens: 0,
    output_tokens: 1,
    reasoning_output_tokens: 0,
  };
}

function webProofEvents(message = "completed answer"): Uint8Array[] {
  const events = proofEvents(message);
  return [events[0]!, events[1]!, ...events.slice(3)];
}

function webPrefix(): Uint8Array[] {
  return [
    line({ type: "thread.started", thread_id: "thread-1" }),
    line({ type: "item.completed", item: { ...REVIEWED_NOTICES[0], type: "error" } }),
    line({ type: "turn.started" }),
  ];
}

function webSearch(id: string, query: string): Uint8Array[] {
  const queries = [query, `${query} official`, `${query} current`, `${query} documentation`];
  return [
    line({ type: "item.started", item: { type: "web_search", id, query: "", action: { type: "other" } } }),
    line({ type: "item.completed", item: { type: "web_search", id, query, action: { type: "search", query, queries } } }),
  ];
}

function webTerminal(): Uint8Array[] {
  return [line({ type: "turn.completed", usage: validUsage() })];
}

describe("parseCodexEventStream", () => {
  test("returns the sole completed assistant message under the zero-tool policy", async () => {
    await expect(parseCodexEventStream(streamOf(...completedMessageEvents('{"schemaVersion":"fixture@1"}')), LIMITS))
      .resolves.toBe('{"schemaVersion":"fixture@1"}');
  });

  test("rejects a decorated Uint8Array subclass without executing its accessor", async () => {
    const getter = vi.fn(() => 1);
    class DecoratedChunk extends Uint8Array {}
    const chunk = new DecoratedChunk(line({ type: "thread.started" }));
    Object.defineProperty(chunk, "byteLength", { enumerable: true, get: getter });

    await expect(parseCodexEventStream(streamOf(chunk), LIMITS))
      .rejects.toMatchObject({ code: "codex_protocol_invalid" });
    expect(getter).not.toHaveBeenCalled();
  });

  test("rejects an event count above the closed limit", async () => {
    await expect(parseCodexEventStream(streamOf(...completedMessageEvents()), {
      maxStdoutBytes: 65_536,
      maxEvents: 4,
    })).rejects.toMatchObject({ code: "codex_event_limit" });
  });

  test.each([
    ["a missing action queries array", { type: "search", query: "synthetic-query" }],
    ["an extra action field", { type: "search", query: "synthetic-query", queries: ["synthetic-query"], extra: true }],
    ["more than four action queries", { type: "search", query: "synthetic-query", queries: ["synthetic-query", "other", "third", "fourth", "fifth"] }],
    ["duplicate action queries", { type: "search", query: "synthetic-query", queries: ["synthetic-query", "synthetic-query"] }],
    ["an empty action query", { type: "search", query: "", queries: [""] }],
    ["a mismatched action queries value", { type: "search", query: "synthetic-query", queries: ["other"] }],
  ])("rejects %s without retaining query text", async (_name, action) => {
    await expect(parseCodexEventStreamWithProof(streamOf(
      ...webPrefix(),
      ...webSearch("search-1", "synthetic-query").slice(0, 1),
      line({ type: "item.completed", item: { type: "web_search", id: "search-1", query: "synthetic-query", action } }),
    ), LIMITS, "codex-tools-web-search@2")).rejects.toMatchObject({ code: "codex_tool_event" });
  });

  test.each([
    ["invalid UTF-8", [new Uint8Array([0xc3, 0x28, 0x0a])]],
    ["invalid JSON", [new TextEncoder().encode("not-json\n")]],
    ["a trailing partial line", [new TextEncoder().encode('{"type":"thread.started"}')]],
  ])("rejects %s", async (_name, chunks) => {
    await expect(parseCodexEventStream(streamOf(...chunks), LIMITS))
      .rejects.toMatchObject({ code: "codex_protocol_invalid" });
  });

  test("counts UTF-8 bytes before retaining a line", async () => {
    await expect(parseCodexEventStream(streamOf(line({ type: "thread.started", text: "é" })), {
      maxStdoutBytes: 1,
      maxEvents: 16,
    })).rejects.toMatchObject({ code: "codex_output_too_large" });
  });

  test.each([
    ["stdout", { maxStdoutBytes: MAX_CODEX_STDOUT_BYTES + 1, maxEvents: 16 }],
    ["events", { maxStdoutBytes: 65_536, maxEvents: MAX_CODEX_EVENTS + 1 }],
  ])("rejects a %s limit above the global cap", async (_name, limits) => {
    await expect(parseCodexEventStream(streamOf(...completedMessageEvents()), limits))
      .rejects.toMatchObject({ code: "codex_protocol_invalid" });
  });
});

describe("parseCodexEventStreamWithProof", () => {
  test("accepts the observed alpha.4 agent ID and final usage shape without retaining either", async () => {
    const proof = await parseCodexEventStreamWithProof(
      streamOf(...proofEvents()), LIMITS, "codex-tools-none@2",
    );

    expect(proof.finalMessage).toBe("completed answer");
    expect(JSON.stringify(proof)).not.toContain("item_2");
    expect(JSON.stringify(proof)).not.toContain("input_tokens");
  });

  test.each([
    ["missing agent ID", [
      ...proofEvents().slice(0, 6),
      line({ type: "item.completed", item: { type: "agent_message", text: "completed answer" } }),
      proofEvents()[7]!,
    ]],
    ["a reused agent ID", [
      ...proofEvents().slice(0, 6),
      line({ type: "item.completed", item: { type: "agent_message", id: "item_1", text: "completed answer" } }),
      proofEvents()[7]!,
    ]],
    ["missing final usage", [...proofEvents().slice(0, 7), line({ type: "turn.completed" })]],
    ["a mutated final usage value", [
      ...proofEvents().slice(0, 7),
      line({ type: "turn.completed", usage: { ...validUsage(), output_tokens: -1 } }),
    ]],
    ["an extra final usage key", [
      ...proofEvents().slice(0, 7),
      line({ type: "turn.completed", usage: { ...validUsage(), future_tokens: 0 } }),
    ]],
  ])("rejects proof with %s", async (_name, events) => {
    await expect(parseCodexEventStreamWithProof(
      streamOf(...events), LIMITS, "codex-tools-none@2",
    )).rejects.toMatchObject({ code: "codex_protocol_invalid" });
  });

  test("rejects a web-search startup lifecycle under the zero-tool startup policy", async () => {
    await expect(parseCodexEventStreamWithProof(
      await fixture("protocol-v2-web-search.jsonl"), LIMITS, "codex-tools-none@2",
    )).rejects.toMatchObject({ code: "codex_protocol_invalid" });
  });

  test("classifies a new-shape web-search start after a valid no-tool prefix as a tool event", async () => {
    const events = [
      ...proofEvents().slice(0, 4),
      line({ type: "item.started", item: { type: "web_search", id: "search-1", query: "", action: { type: "other" } } }),
    ];
    await expect(parseCodexEventStreamWithProof(
      streamOf(...events), LIMITS, "codex-tools-none@2",
    )).rejects.toMatchObject({ code: "codex_tool_event" });
  });

  test("proves the reviewed discovery lifecycle without retaining its query", async () => {
    const proof = await parseCodexEventStreamWithProof(
      await fixture("protocol-v2-web-search.jsonl"), LIMITS, "codex-tools-web-search@2",
    );

    expect(proof).toEqual({
      finalMessage: '{"schemaVersion":"fixture@1"}',
      eventTypes: [
        "thread.started", "item.completed", "turn.started", "item.started", "item.completed",
        "item.completed", "item.started", "item.completed", "item.completed", "turn.completed",
      ],
      webSearchCount: 1,
      toolPolicyProven: true,
    });
    expect(JSON.stringify(proof)).not.toContain("official municipal source");
    expect(JSON.stringify(proof)).not.toContain("approval_policy");
    expect(JSON.stringify(proof)).not.toContain("code-mode host");
  });

  test("accepts an other completion without counting a real search", async () => {
    const proof = await parseCodexEventStreamWithProof(streamOf(
      ...webPrefix(),
      line({ type: "item.started", item: { type: "web_search", id: "search-1", query: "", action: { type: "other" } } }),
      line({ type: "item.completed", item: { type: "web_search", id: "search-1", query: "", action: { type: "other" } } }),
      line({ type: "item.completed", item: { type: "agent_message", id: "item_2", text: "final" } }),
      ...webTerminal(),
    ), LIMITS, "codex-tools-web-search@2");
    expect(proof.webSearchCount).toBe(0);
  });

  test("counts two matched searches and retains only the final candidate", async () => {
    const proof = await parseCodexEventStreamWithProof(streamOf(
      ...webPrefix(),
      line({ type: "item.completed", item: { type: "agent_message", id: "item_2", text: "first" } }),
      ...webSearch("search-1", "synthetic-query-one"),
      line({ type: "item.completed", item: { type: "agent_message", id: "item_3", text: "second" } }),
      ...webSearch("search-2", "synthetic-query-two"),
      line({ type: "item.completed", item: { type: "agent_message", id: "item_4", text: "final" } }),
      ...webTerminal(),
    ), LIMITS, "codex-tools-web-search@2");
    expect(proof).toMatchObject({ finalMessage: "final", webSearchCount: 2 });
    expect(JSON.stringify(proof)).not.toContain("synthetic-query");
  });

  test.each([
    ["a start/completion ID mismatch", [
      ...webPrefix(),
      ...webSearch("search-1", "synthetic-query").slice(0, 1),
      line({ type: "item.completed", item: { type: "web_search", id: "search-2", query: "synthetic-query", action: { type: "search", query: "synthetic-query", queries: ["synthetic-query"] } } }),
    ]],
    ["an item/action query mismatch", [
      ...webPrefix(),
      ...webSearch("search-1", "synthetic-query").slice(0, 1),
      line({ type: "item.completed", item: { type: "web_search", id: "search-1", query: "synthetic-query", action: { type: "search", query: "different-query", queries: ["different-query"] } } }),
    ]],
    ["a candidate cleared by a second search without a later candidate", [
      ...webPrefix(),
      line({ type: "item.completed", item: { type: "agent_message", id: "item_2", text: "first" } }),
      ...webSearch("search-1", "synthetic-query-one"),
      line({ type: "item.completed", item: { type: "agent_message", id: "item_3", text: "second" } }),
      ...webSearch("search-2", "synthetic-query-two"),
      ...webTerminal(),
    ]],
  ])("rejects %s", async (_name, events) => {
    await expect(parseCodexEventStreamWithProof(
      streamOf(...events), LIMITS, "codex-tools-web-search@2",
    )).rejects.toMatchObject({ code: _name === "an item/action query mismatch" ? "codex_tool_event" : "codex_protocol_invalid" });
  });

  test.each([
    ["a web-search completion without a start", [
      ...completedMessageEvents().slice(0, 4),
      line({ type: "item.completed", item: { type: "web_search", id: "search-1", query: "official municipal source" } }),
      ...completedMessageEvents().slice(4),
    ]],
    ["a duplicate web-search ID", [
      ...completedMessageEvents().slice(0, 4),
      line({ type: "item.started", item: { type: "web_search", id: "search-1", query: "official municipal source" } }),
      line({ type: "item.completed", item: { type: "web_search", id: "search-1", query: "official municipal source" } }),
      line({ type: "item.started", item: { type: "web_search", id: "search-1", query: "official municipal source" } }),
      line({ type: "item.completed", item: { type: "web_search", id: "search-1", query: "official municipal source" } }),
      ...completedMessageEvents().slice(4),
    ]],
    ["a duplicate reasoning ID", [
      ...completedMessageEvents().slice(0, 4),
      line({ type: "item.started", item: { type: "reasoning", id: "reasoning-1" } }),
      line({ type: "item.completed", item: { type: "reasoning", id: "reasoning-1" } }),
      ...completedMessageEvents().slice(4),
    ]],
    ["a web-search result after the agent message", [
      ...completedMessageEvents().slice(0, 5),
      line({ type: "item.started", item: { type: "web_search", id: "search-1", query: "official municipal source" } }),
      line({ type: "item.completed", item: { type: "web_search", id: "search-1", query: "official municipal source" } }),
      line({ type: "turn.completed" }),
    ]],
    ["an unknown item type", [
      ...completedMessageEvents().slice(0, 2),
      line({ type: "item.started", item: { type: "unrecognized", id: "unknown-1" } }),
    ]],
    ["an unknown event type", [
      ...completedMessageEvents().slice(0, 2),
      line({ type: "turn.progress" }),
    ]],
  ])("rejects %s", async (_name, events) => {
    await expect(parseCodexEventStreamWithProof(
      streamOf(...events), LIMITS, "codex-tools-web-search@2",
    )).rejects.toMatchObject({ code: "codex_protocol_invalid" });
  });

  test.each([
    ["a missing notice", proofEvents().filter((_event, index) => index !== 1)],
    ["swapped notices", [proofEvents()[0]!, proofEvents()[2]!, proofEvents()[1]!, ...proofEvents().slice(3)]],
    ["a mutated notice message", [
      proofEvents()[0]!,
      line({ type: "item.completed", item: { id: "item_0", type: "error", message: "mutated" } }),
      ...proofEvents().slice(2),
    ]],
    ["a mutated notice key", [
      proofEvents()[0]!,
      line({ type: "item.completed", item: { id: "item_0", type: "error", message: REVIEWED_NOTICES[0].message, extra: true } }),
      ...proofEvents().slice(2),
    ]],
    ["a mutated notice ID", [
      proofEvents()[0]!,
      line({ type: "item.completed", item: { id: "other", type: "error", message: REVIEWED_NOTICES[0].message } }),
      ...proofEvents().slice(2),
    ]],
    ["a third pre-turn error", [
      ...proofEvents().slice(0, 3),
      line({ type: "item.completed", item: { id: "item_2", type: "error", message: "unexpected" } }),
      ...proofEvents().slice(3),
    ]],
    ["an error after turn start", [
      ...proofEvents().slice(0, 4),
      line({ type: "item.completed", item: { id: "item_2", type: "error", message: "unexpected" } }),
      ...proofEvents().slice(4),
    ]],
  ])("rejects %s from the reviewed notice prefix", async (_name, events) => {
    await expect(parseCodexEventStreamWithProof(
      streamOf(...events), LIMITS, "codex-tools-web-search@2",
    )).rejects.toMatchObject({ code: "codex_protocol_invalid" });
  });

  test.each(["shell", "command_execution", "mcp_tool_call", "browser", "app", "plugin", "skill", "image", "file_change", "code", "program", "program_output", "code_mode", "exec", "wait", "request_user_input", "update_plan"])(
    "rejects the prohibited %s item with the tool-event code",
    async (type) => {
      const events = [
        ...webProofEvents().slice(0, 3),
        line({ type: "item.started", item: { type, id: "tool-1" } }),
      ];
      await expect(parseCodexEventStreamWithProof(
        streamOf(...events), LIMITS, "codex-tools-web-search@2",
      )).rejects.toMatchObject({ code: "codex_tool_event" });
    },
  );

  test("rejects a web-search item with any unreviewed key", async () => {
    const events = [
      ...webProofEvents().slice(0, 5),
      line({ type: "item.started", item: { type: "web_search", id: "search-1", query: "", action: { type: "other" }, result: "no" } }),
      ...webProofEvents().slice(5),
    ];
    await expect(parseCodexEventStreamWithProof(
      streamOf(...events), LIMITS, "codex-tools-web-search@2",
    )).rejects.toMatchObject({ code: "codex_tool_event" });
  });
});
