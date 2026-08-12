export const FINITE_NDJSON_MAX_LINE_BYTES = 256 * 1024;

function abortReason(signal?: AbortSignal): unknown {
  return signal?.reason ?? new DOMException("The operation was aborted", "AbortError");
}

export async function* readFiniteNdjson(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<unknown> {
  const reader = stream.getReader();
  let decoder = new TextDecoder("utf-8", { fatal: true });
  let line = "";
  let lineBytes = 0;
  let reachedEof = false;
  let abortRequested = false;
  const cancelForAbort = () => {
    abortRequested = true;
    void reader.cancel(abortReason(signal)).catch(() => undefined);
  };
  if (signal?.aborted === true) cancelForAbort();
  else signal?.addEventListener("abort", cancelForAbort, { once: true });

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (abortRequested) throw abortReason(signal);
      if (done) {
        reachedEof = true;
        break;
      }
      let segmentStart = 0;
      for (let index = 0; index < value.length; index += 1) {
        if (value[index] !== 0x0a) continue;
        const segment = value.subarray(segmentStart, index);
        lineBytes += segment.byteLength;
        if (lineBytes > FINITE_NDJSON_MAX_LINE_BYTES) throw new Error("line_too_large");
        line += decoder.decode(segment, { stream: true });
        line += decoder.decode();
        yield JSON.parse(line) as unknown;
        decoder = new TextDecoder("utf-8", { fatal: true });
        line = "";
        lineBytes = 0;
        segmentStart = index + 1;
      }
      const remainder = value.subarray(segmentStart);
      lineBytes += remainder.byteLength;
      if (lineBytes > FINITE_NDJSON_MAX_LINE_BYTES) throw new Error("line_too_large");
      line += decoder.decode(remainder, { stream: true });
    }

    line += decoder.decode();
    if (lineBytes > 0 || line.length > 0) throw new Error("trailing_partial_line");
  } finally {
    signal?.removeEventListener("abort", cancelForAbort);
    if (!reachedEof && !abortRequested) {
      try {
        await reader.cancel("finite_ndjson_reader_stopped");
      } catch {
        // Preserve the stream, JSON or consumer error.
      }
    }
    try {
      reader.releaseLock();
    } catch {
      // Releasing an invalidated reader must not mask the original error.
    }
  }
}
