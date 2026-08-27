import { describe, expect, test, vi } from "vitest";

import { MAX_CODEX_EVENTS, MAX_CODEX_STDOUT_BYTES } from "../../src/infrastructure/codex-cli/contracts";
import {
  CODEX_STARTUP_NOTICES,
  fingerprintCodexNoticeMessage,
  parseCodexEventStream,
  parseCodexEventStreamWithProof,
} from "../../src/infrastructure/codex-cli/event-stream";

const CODE_MODE_HOST_DISABLED_MESSAGE =
  "Code Mode is unavailable because code-mode host is disabled. Code mode will fail closed; enable `features.code_mode_host` and install `codex-code-mode-host`.";
const APPROVAL_POLICY_NOTICE_SHA256 = "dc04a3e848ff580847de6950e6415fe72d1daab7d83336461b55b6fc8355e177";
const INVALID_APPROVAL_POLICY_MESSAGE = "p".repeat(277);

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

function startupNotice(
  id: string,
  message: string,
  itemOverrides: Readonly<Record<string, unknown>> = {},
  eventOverrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    type: "item.completed",
    item: {
      type: "error",
      id,
      message,
      ...itemOverrides,
    },
    ...eventOverrides,
  };
}

function hostNoticeLine(
  itemOverrides: Readonly<Record<string, unknown>> = {},
  eventOverrides: Readonly<Record<string, unknown>> = {},
): Uint8Array {
  return line(startupNotice("item_1", CODE_MODE_HOST_DISABLED_MESSAGE, itemOverrides, eventOverrides));
}

const LIMITS = { maxStdoutBytes: 65_536, maxEvents: 16 };

describe("parseCodexEventStream", () => {
  test("returns the sole completed assistant message", async () => {
    await expect(parseCodexEventStream(streamOf(...completedMessageEvents()), LIMITS))
      .resolves.toBe("completed answer");
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

  test("accepts the terminal message without reasoning progress", async () => {
    const events = completedMessageEvents().filter((_, index) => index !== 2 && index !== 3);
    await expect(parseCodexEventStream(streamOf(...events), LIMITS)).resolves.toBe("completed answer");
  });

  test("still rejects the exact Code Mode startup notice without the proof opt-in", async () => {
    const events = [
      completedMessageEvents()[0],
      hostNoticeLine(),
      ...completedMessageEvents().slice(1),
    ];

    await expect(parseCodexEventStream(streamOf(...events), LIMITS))
      .rejects.toMatchObject({ code: "codex_protocol_invalid" });
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

  test("rejects a completed reasoning item with a different ID", async () => {
    const events = [
      line({ type: "thread.started", thread_id: "thread-1" }),
      line({ type: "turn.started" }),
      line({ type: "item.started", item: { type: "reasoning", id: "reasoning-a" } }),
      line({ type: "item.completed", item: { type: "reasoning", id: "reasoning-b" } }),
      line({ type: "item.completed", item: { type: "agent_message", text: "completed answer" } }),
      line({ type: "turn.completed" }),
    ];

    await expect(parseCodexEventStream(streamOf(...events), LIMITS))
      .rejects.toMatchObject({ code: "codex_protocol_invalid" });
  });

  test("rejects reasoning progress after the terminal assistant message", async () => {
    const events = [
      ...completedMessageEvents().slice(0, 5),
      line({ type: "item.started", item: { type: "reasoning", id: "late" } }),
      line({ type: "item.completed", item: { type: "reasoning", id: "late" } }),
      line({ type: "turn.completed" }),
    ];

    await expect(parseCodexEventStream(streamOf(...events), LIMITS))
      .rejects.toMatchObject({ code: "codex_protocol_invalid" });
  });

  test.each([
    ["stdout", { maxStdoutBytes: MAX_CODEX_STDOUT_BYTES + 1, maxEvents: 16 }],
    ["events", { maxStdoutBytes: 65_536, maxEvents: MAX_CODEX_EVENTS + 1 }],
  ])("rejects a %s limit above the global cap", async (_name, limits) => {
    await expect(parseCodexEventStream(streamOf(...completedMessageEvents()), limits))
      .rejects.toMatchObject({ code: "codex_protocol_invalid" });
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

describe("parseCodexEventStreamWithProof", () => {
  test("pins the only closed startup-notice proof tuple", () => {
    expect(CODEX_STARTUP_NOTICES).toEqual([
      "approval_policy_never_to_unless_trusted",
      "code_mode_host_disabled",
    ]);
  });

  test("fingerprints raw decoded UTF-8 without normalization", () => {
    expect(fingerprintCodexNoticeMessage("abc")).toEqual({
      utf8ByteLength: 3,
      sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    });
    const composed = fingerprintCodexNoticeMessage("é");
    const decomposed = fingerprintCodexNoticeMessage("e\u0301");
    expect(composed.utf8ByteLength).toBe(2);
    expect(decomposed.utf8ByteLength).toBe(3);
    expect(composed.sha256).not.toBe(decomposed.sha256);

    const unavailablePolicy = fingerprintCodexNoticeMessage(INVALID_APPROVAL_POLICY_MESSAGE);
    expect(unavailablePolicy.utf8ByteLength).toBe(277);
    expect(unavailablePolicy.sha256).not.toBe(APPROVAL_POLICY_NOTICE_SHA256);
  });

  test("pins the exact Code Mode host notice's fixed 157-byte message", () => {
    expect(fingerprintCodexNoticeMessage(CODE_MODE_HOST_DISABLED_MESSAGE).utf8ByteLength).toBe(157);
  });

  test.each([
    ["omitted notices", completedMessageEvents()],
    ["only the host notice", [
      completedMessageEvents()[0],
      hostNoticeLine(),
      ...completedMessageEvents().slice(1),
    ]],
    ["only an invalid policy notice", [
      completedMessageEvents()[0],
      line(startupNotice("item_0", INVALID_APPROVAL_POLICY_MESSAGE)),
      ...completedMessageEvents().slice(1),
    ]],
    ["an invalid policy notice followed by the host notice", [
      completedMessageEvents()[0],
      line(startupNotice("item_0", INVALID_APPROVAL_POLICY_MESSAGE)),
      hostNoticeLine(),
      ...completedMessageEvents().slice(1),
    ]],
    ["reordered notices", [
      completedMessageEvents()[0],
      hostNoticeLine(),
      line(startupNotice("item_0", INVALID_APPROVAL_POLICY_MESSAGE)),
      ...completedMessageEvents().slice(1),
    ]],
    ["a duplicate host notice", [
      completedMessageEvents()[0],
      hostNoticeLine(),
      hostNoticeLine(),
      ...completedMessageEvents().slice(1),
    ]],
    ["a mutated host message", [
      completedMessageEvents()[0],
      hostNoticeLine({ message: `${CODE_MODE_HOST_DISABLED_MESSAGE} ` }),
      ...completedMessageEvents().slice(1),
    ]],
    ["an extra host event key", [
      completedMessageEvents()[0],
      hostNoticeLine({}, { unexpected: true }),
      ...completedMessageEvents().slice(1),
    ]],
    ["an extra host item key", [
      completedMessageEvents()[0],
      hostNoticeLine({ unexpected: true }),
      ...completedMessageEvents().slice(1),
    ]],
    ["a wrong host id", [
      completedMessageEvents()[0],
      line(startupNotice("item_0", CODE_MODE_HOST_DISABLED_MESSAGE)),
      ...completedMessageEvents().slice(1),
    ]],
    ["a wrong host event type", [
      completedMessageEvents()[0],
      hostNoticeLine({}, { type: "item.started" }),
      ...completedMessageEvents().slice(1),
    ]],
    ["a wrong host item type", [
      completedMessageEvents()[0],
      hostNoticeLine({ type: "warning" }),
      ...completedMessageEvents().slice(1),
    ]],
    ["a pre-thread host notice", [hostNoticeLine(), ...completedMessageEvents()]],
    ["a post-turn-start host notice", [
      ...completedMessageEvents().slice(0, 2),
      hostNoticeLine(),
      ...completedMessageEvents().slice(2),
    ]],
    ["a post-turn host notice", [...completedMessageEvents(), hostNoticeLine()]],
    ["a failed turn", [
      ...completedMessageEvents().slice(0, 5),
      line({ type: "turn.failed" }),
    ]],
  ])("rejects %s", async (_name, events) => {
    await expect(parseCodexEventStreamWithProof(streamOf(...events), LIMITS))
      .rejects.toMatchObject({ code: "codex_protocol_invalid" });
  });
});
