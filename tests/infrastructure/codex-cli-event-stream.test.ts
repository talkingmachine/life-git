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

describe("parseCodexEventStream", () => {
  test("returns the sole completed assistant message under the zero-tool policy", async () => {
    await expect(parseCodexEventStream(await fixture("protocol-v2-no-tools.jsonl"), LIMITS))
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
  test("rejects the reviewed discovery lifecycle under the zero-tool policy", async () => {
    await expect(parseCodexEventStreamWithProof(
      await fixture("protocol-v2-web-search.jsonl"), LIMITS, "codex-tools-none@2",
    )).rejects.toMatchObject({ code: "codex_tool_event" });
  });

  test("proves the reviewed discovery lifecycle without retaining its query", async () => {
    const proof = await parseCodexEventStreamWithProof(
      await fixture("protocol-v2-web-search.jsonl"), LIMITS, "codex-tools-web-search@1",
    );

    expect(proof).toEqual({
      finalMessage: '{"schemaVersion":"fixture@1"}',
      eventTypes: [
        "thread.started", "turn.started", "item.started", "item.completed",
        "item.started", "item.completed", "item.completed", "turn.completed",
      ],
      webSearchCount: 1,
      toolPolicyProven: true,
    });
    expect(JSON.stringify(proof)).not.toContain("official municipal source");
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
      streamOf(...events), LIMITS, "codex-tools-web-search@1",
    )).rejects.toMatchObject({ code: "codex_protocol_invalid" });
  });

  test.each(["shell", "command_execution", "mcp_tool_call", "browser", "app", "plugin", "skill", "image", "file_change"])(
    "rejects the prohibited %s item with the tool-event code",
    async (type) => {
      const events = [
        ...completedMessageEvents().slice(0, 2),
        line({ type: "item.started", item: { type, id: "tool-1" } }),
      ];
      await expect(parseCodexEventStreamWithProof(
        streamOf(...events), LIMITS, "codex-tools-web-search@1",
      )).rejects.toMatchObject({ code: "codex_tool_event" });
    },
  );

  test("rejects a web-search item with any unreviewed key", async () => {
    const events = [
      ...completedMessageEvents().slice(0, 4),
      line({ type: "item.started", item: { type: "web_search", id: "search-1", query: "official municipal source", result: "no" } }),
      ...completedMessageEvents().slice(4),
    ];
    await expect(parseCodexEventStreamWithProof(
      streamOf(...events), LIMITS, "codex-tools-web-search@1",
    )).rejects.toMatchObject({ code: "codex_tool_event" });
  });
});
