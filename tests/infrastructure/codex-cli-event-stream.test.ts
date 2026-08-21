import { describe, expect, test } from "vitest";

import { parseCodexEventStream } from "../../src/infrastructure/codex-cli/event-stream";

function line(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value)}\n`);
}

async function* streamOf(...chunks: readonly Uint8Array[]): AsyncGenerator<Uint8Array> {
  for (const chunk of chunks) yield chunk;
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

const LIMITS = { maxStdoutBytes: 65_536, maxEvents: 16 };

describe("parseCodexEventStream", () => {
  test("returns the sole completed assistant message", async () => {
    await expect(parseCodexEventStream(streamOf(...completedMessageEvents()), LIMITS))
      .resolves.toBe("completed answer");
  });

  test("accepts the terminal message without reasoning progress", async () => {
    const events = completedMessageEvents().filter((_, index) => index !== 2 && index !== 3);
    await expect(parseCodexEventStream(streamOf(...events), LIMITS)).resolves.toBe("completed answer");
  });

  test.each([
    ["a duplicate terminal message", [
      ...completedMessageEvents().slice(0, 5),
      line({ type: "item.completed", item: { type: "agent_message", text: "second" } }),
      line({ type: "turn.completed" }),
    ]],
    ["an unpaired reasoning item", [
      ...completedMessageEvents().slice(0, 3),
      ...completedMessageEvents().slice(4),
    ]],
    ["an event after completion", [
      ...completedMessageEvents(),
      line({ type: "item.started", item: { type: "reasoning", id: "late" } }),
    ]],
    ["a failed turn", [
      ...completedMessageEvents().slice(0, 5),
      line({ type: "turn.failed" }),
    ]],
    ["an unknown top-level type", [
      ...completedMessageEvents().slice(0, 2),
      line({ type: "turn.progress" }),
    ]],
    ["an unknown item type", [
      ...completedMessageEvents().slice(0, 2),
      line({ type: "item.started", item: { type: "unrecognized" } }),
    ]],
  ])("rejects %s", async (_name, events) => {
    await expect(parseCodexEventStream(streamOf(...events), LIMITS))
      .rejects.toMatchObject({ code: "codex_protocol_invalid" });
  });

  test("rejects a tool call item with the tool-event code", async () => {
    const events = [
      ...completedMessageEvents().slice(0, 2),
      line({ type: "item.completed", item: { type: "command_execution", command: "echo prohibited" } }),
    ];

    await expect(parseCodexEventStream(streamOf(...events), LIMITS))
      .rejects.toMatchObject({ code: "codex_tool_event" });
  });

  test("rejects an event count above the closed limit", async () => {
    await expect(parseCodexEventStream(streamOf(...completedMessageEvents()), {
      maxStdoutBytes: 65_536,
      maxEvents: 4,
    })).rejects.toMatchObject({ code: "codex_event_limit" });
  });

  test("counts UTF-8 bytes before retaining a line", async () => {
    await expect(parseCodexEventStream(streamOf(line({ type: "thread.started", text: "é" })), {
      maxStdoutBytes: 1,
      maxEvents: 16,
    })).rejects.toMatchObject({ code: "codex_output_too_large" });
  });

  test.each([
    ["invalid UTF-8", [new Uint8Array([0xc3, 0x28, 0x0a])]],
    ["invalid JSON", [new TextEncoder().encode("not-json\n")]],
    ["a trailing partial line", [new TextEncoder().encode('{"type":"thread.started"}')]],
  ])("rejects %s", async (_name, chunks) => {
    await expect(parseCodexEventStream(streamOf(...chunks), LIMITS))
      .rejects.toMatchObject({ code: "codex_protocol_invalid" });
  });
});
