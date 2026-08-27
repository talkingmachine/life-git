import type {
  PlaceFrontierApplication,
  PlaceFrontierPrepared,
} from "../../../application/place-frontier";
import {
  canonicalPlaceFrontierValue,
  initialPlaceFrontierEventState,
  reducePlaceFrontierEvent,
} from "../../../experience/place-frontier-stream";

export function createPlaceFrontierStreamResponse(input: {
  readonly signal: AbortSignal;
  readonly prepared: PlaceFrontierPrepared;
  readonly runPlaceFrontier: PlaceFrontierApplication["runPlaceFrontier"];
}): Response {
  const headers = responseHeaders(input.prepared);
  return new Response(placeFrontierStream(input), { headers });
}

function responseHeaders(prepared: PlaceFrontierPrepared): Headers {
  if (
    !isHeaderSafeIdentifier(prepared.runId) ||
    !isHeaderSafeIdentifier(prepared.profileId) ||
    !isHeaderSafeIdentifier(prepared.preferenceProfileId) ||
    prepared.rankingSnapshotId !== `${prepared.runId}:ranking`
  ) throw new Error("invalid_prepared_frontier");
  return new Headers({
    "cache-control": "no-store, no-transform",
    "content-type": "application/x-ndjson; charset=utf-8",
    "x-content-type-options": "nosniff",
    "x-life-run-id": prepared.runId,
    "x-life-profile-id": prepared.profileId,
    "x-life-preference-profile-id": prepared.preferenceProfileId,
  });
}

function placeFrontierStream(input: {
  readonly signal: AbortSignal;
  readonly prepared: PlaceFrontierPrepared;
  readonly runPlaceFrontier: PlaceFrontierApplication["runPlaceFrontier"];
}): ReadableStream<Uint8Array> {
  const linked = new AbortController();
  const encoder = new TextEncoder();
  let cancelled = false;
  const requestAborted = (): void => abort(linked, input.signal.reason);
  if (input.signal.aborted) requestAborted();
  else input.signal.addEventListener("abort", requestAborted, { once: true });

  return new ReadableStream<Uint8Array>({
    start(controller): void {
      const pump = async (): Promise<void> => {
        let state = initialPlaceFrontierEventState();
        try {
          const returned = await input.runPlaceFrontier(
            input.prepared,
            async (rawEvent) => {
              if (cancelled || linked.signal.aborted) throw abortError(linked.signal);
              state = reducePlaceFrontierEvent(state, rawEvent);
              if (state.runId !== input.prepared.runId) throw new Error("changed_run_id");
              const event = state.events.at(-1)!;
              if (cancelled || linked.signal.aborted) throw abortError(linked.signal);
              controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
            },
            linked.signal,
          );
          if (cancelled) return;
          if (linked.signal.aborted) throw abortError(linked.signal);
          if (state.terminal === undefined) throw new Error("missing_terminal_event");
          if (
            canonicalPlaceFrontierValue(returned) !==
            canonicalPlaceFrontierValue(state.terminal)
          ) throw new Error("terminal_return_mismatch");
          controller.close();
        } catch (error) {
          if (!cancelled) controller.error(error);
        } finally {
          input.signal.removeEventListener("abort", requestAborted);
        }
      };
      void pump();
    },
    cancel(reason): void {
      cancelled = true;
      abort(linked, reason);
    },
  });
}

function isHeaderSafeIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

function abort(controller: AbortController, reason: unknown): void {
  if (controller.signal.aborted) return;
  if (reason === undefined) controller.abort();
  else controller.abort(reason);
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}
