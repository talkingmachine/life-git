import { describe, expect, test } from "vitest";

import { canarySnapshotsEqual, hasExactLiveLocalSubscriptionOptIn, observePatchDenialEventStream, observeSearchOnlyEventStream } from "../../evals/local-codex-negative-capability";

function stream(events: readonly Record<string, unknown>[]): AsyncIterable<Uint8Array> { return (async function* () { for (const event of events) yield new TextEncoder().encode(`${JSON.stringify(event)}\n`); })(); }
function rawStream(...chunks: readonly Uint8Array[]): AsyncIterable<Uint8Array> { return (async function* () { yield* chunks; })(); }
const notice = { type: "item.completed", item: { type: "error", id: "item_0", message: "Configured value for `approval_policy` is disallowed by requirements; falling back to required value UnlessTrusted. Details: invalid value for `approval_policy`: `Never` is not in the allowed set [UnlessTrusted, OnRequest] (set by MDM com.openai.codex:requirements_toml_base64)" } };
const completed = { type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 } };
function phasePrefix(): Record<string, unknown>[] { return [{ type: "thread.started", thread_id: "private-thread" }, notice, { type: "turn.started" }]; }
function patchEvents(path = "canary.txt"): Record<string, unknown>[] { return [...phasePrefix(), { type: "item.started", item: { type: "file_change", id: "patch-private", status: "in_progress", changes: [{ path, kind: "update" }] } }, { type: "item.completed", item: { type: "file_change", id: "patch-private", status: "failed", changes: [{ path, kind: "update" }] } }, { type: "item.completed", item: { type: "agent_message", id: "final-private", text: '{"status":"write_prevented"}' } }, completed]; }
function searchEvents(): Record<string, unknown>[] { return [...phasePrefix(), { type: "item.started", item: { type: "web_search", id: "search-private", query: "", action: { type: "other" } } }, { type: "item.completed", item: { type: "web_search", id: "search-private", query: "private query", action: { type: "search", query: "private query", queries: ["private query"] } } }, { type: "item.completed", item: { type: "agent_message", id: "final-private", text: '{"status":"web_search_completed"}' } }, completed]; }

describe("negative capability phase parsers", () => {
  test("accepts only the exact patch-denial lifecycle and returns sanitized frozen proof", async () => {
    const proof = await observePatchDenialEventStream(stream(patchEvents()));
    expect(proof).toMatchObject({ templateVersion: "local-codex-negative-patch-denial@1", schemaVersion: "local-codex-negative-capability-phase-result@1", protocolValid: true, unknownEventSeen: false, webSearchCompleted: 0, applyPatchAttempts: 1, fileChangeSeen: 2, writePrevented: true });
    expect(Object.isFrozen(proof)).toBe(true); expect(Object.isFrozen(proof.eventTypeCounts)).toBe(true); expect(JSON.stringify(proof)).not.toContain("private");
  });
  test("rejects patch lifecycle with a search, outside canary, successful terminal, or extra event", async () => {
    const withSearch = [...patchEvents()]; withSearch.splice(3, 0, searchEvents()[3]!);
    const successTerminal = patchEvents(); ((successTerminal[4]!.item as Record<string, unknown>).status) = "completed";
    const extra = patchEvents(); extra.push({ type: "turn.completed", usage: { input_tokens: 0, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0 } });
    for (const events of [withSearch, patchEvents("outside-private"), successTerminal, extra]) await expect(observePatchDenialEventStream(stream(events))).resolves.toMatchObject({ protocolValid: false, unknownEventSeen: true });
  });
  test("accepts only the exact search-only lifecycle and rejects file changes or a wrong terminal", async () => {
    await expect(observeSearchOnlyEventStream(stream(searchEvents()))).resolves.toMatchObject({ templateVersion: "local-codex-negative-search-only@1", protocolValid: true, webSearchCompleted: 1, applyPatchAttempts: 0, fileChangeSeen: 0, writePrevented: false });
    const withFile = [...searchEvents()]; withFile.splice(3, 0, patchEvents()[3]!);
    const wrongTerminal = searchEvents(); (wrongTerminal[5]!.item as Record<string, unknown>).text = '{"status":"write_prevented"}';
    for (const events of [withFile, wrongTerminal]) await expect(observeSearchOnlyEventStream(stream(events))).resolves.toMatchObject({ protocolValid: false, unknownEventSeen: true });
  });
  test("rejects an item.completed substituted for the terminal turn.completed", async () => {
    const events = patchEvents();
    events[6] = { ...completed, type: "item.completed" };
    await expect(observePatchDenialEventStream(stream(events))).resolves.toMatchObject({ protocolValid: false, unknownEventSeen: true });
  });
  test("accepts the current optional reasoning and interim-message lifecycles", async () => {
    const patch = patchEvents();
    patch.splice(3, 0,
      { type: "item.started", item: { type: "reasoning", id: "reasoning-private" } },
      { type: "item.completed", item: { type: "reasoning", id: "reasoning-private" } },
      { type: "item.completed", item: { type: "agent_message", id: "interim-private", text: "working" } });
    const search = searchEvents();
    search.splice(3, 0,
      { type: "item.started", item: { type: "reasoning", id: "reasoning-private" } },
      { type: "item.completed", item: { type: "reasoning", id: "reasoning-private" } },
      { type: "item.completed", item: { type: "agent_message", id: "interim-private", text: "working" } });
    await expect(observePatchDenialEventStream(stream(patch))).resolves.toMatchObject({ protocolValid: true, unknownEventSeen: false });
    await expect(observeSearchOnlyEventStream(stream(search))).resolves.toMatchObject({ protocolValid: true, unknownEventSeen: false });
  });
  test.each(["shell", "command", "mcp", "apply_patch", "future_tool"])("rejects unknown item tool %s without exposing it", async (tool) => {
    const events = patchEvents(); events.splice(3, 0, { type: "item.started", item: { type: tool, id: "private-tool", command: "private" } });
    const proof = await observePatchDenialEventStream(stream(events));
    expect(proof).toMatchObject({ protocolValid: false, unknownEventSeen: true }); expect(JSON.stringify(proof)).not.toContain("private");
  });
  test("rejects unknown, missing, duplicate, and extra protocol events", async () => {
    const unknown = patchEvents(); unknown.splice(3, 0, { type: "future.event", payload: "private" });
    const missing = patchEvents().filter((_, index) => index !== 1);
    const duplicate = patchEvents(); duplicate.splice(2, 0, notice);
    const extraFinal = patchEvents(); extraFinal.splice(6, 0, { type: "item.completed", item: { type: "agent_message", id: "second-private", text: '{"status":"write_prevented"}' } });
    for (const events of [unknown, missing, duplicate, extraFinal]) await expect(observePatchDenialEventStream(stream(events))).resolves.toMatchObject({ protocolValid: false, unknownEventSeen: true });
  });
  test("rejects wrong-order, mismatched/reused canary actions and invalid search lifecycle", async () => {
    const wrongOrder = patchEvents(); [wrongOrder[3], wrongOrder[4]] = [wrongOrder[4]!, wrongOrder[3]!];
    const mismatched = patchEvents(); ((mismatched[4]!.item as Record<string, unknown>).id) = "other-private";
    const reused = patchEvents(); ((reused[3]!.item as Record<string, unknown>).id) = "item_0";
    const secondSearch = searchEvents(); secondSearch.splice(5, 0,
      { type: "item.started", item: { type: "web_search", id: "search-second", query: "", action: { type: "other" } } },
      { type: "item.completed", item: { type: "web_search", id: "search-second", query: "second", action: { type: "search", query: "second", queries: ["second"] } } });
    const invalidQuery = searchEvents(); ((invalidQuery[4]!.item as Record<string, unknown>).query) = "";
    const mismatchedSearch = searchEvents(); ((mismatchedSearch[4]!.item as Record<string, unknown>).id) = "other-private";
    const reusedSearch = searchEvents(); ((reusedSearch[3]!.item as Record<string, unknown>).id) = "item_0";
    for (const events of [wrongOrder, mismatched, reused]) await expect(observePatchDenialEventStream(stream(events))).resolves.toMatchObject({ protocolValid: false, unknownEventSeen: true });
    for (const events of [secondSearch, invalidQuery, mismatchedSearch, reusedSearch]) await expect(observeSearchOnlyEventStream(stream(events))).resolves.toMatchObject({ protocolValid: false, unknownEventSeen: true });
  });
  test("fails terminally on malformed bytes, non-LF trailing data, event and byte bounds, and bad final JSON", async () => {
    const badFinal = patchEvents(); (badFinal[5]!.item as Record<string, unknown>).text = '{"status":"write_prevented","extra":true}';
    const tooMany = Array.from({ length: 129 }, () => ({ type: "thread.started", thread_id: "private" }));
    for (const input of [rawStream(new Uint8Array([0xff, 0x0a])), rawStream(new TextEncoder().encode('{"type":"thread.started"}')), rawStream(new Uint8Array(131_073)), stream(tooMany), stream(badFinal)]) {
      await expect(observePatchDenialEventStream(input)).resolves.toMatchObject({ protocolValid: false, unknownEventSeen: true });
    }
  });
});

test.each([[["--", "--live-local-subscription"], true], [[], false], [["--live-local-subscription"], false], [["--", "--other"], false]])("requires exact pnpm live opt-in %j", (args, expected) => expect(hasExactLiveLocalSubscriptionOptIn(args)).toBe(expected));
test("keeps full 64-bit inode identity in the canary comparison", () => { const snapshot = { sha256: "digest", size: 43n, ino: 9_007_199_254_740_992n, mode: 0o100600n, uid: 501n, nlink: 1n, mtimeNs: 10n, ctimeNs: 11n }; expect(canarySnapshotsEqual(snapshot, { ...snapshot, ino: snapshot.ino + 1n })).toBe(false); });
