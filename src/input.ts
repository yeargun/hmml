import { sourceBytes } from "./source";
import type { DecodeInput } from "./types";

export async function* openSource(input: DecodeInput, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
  signal?.throwIfAborted();
  if (input instanceof Uint8Array) {
    // Do not pin an additional full-file copy; parser outputs are owned buffers.
    for (let offset = 0; offset < input.length; offset += 65536) {
      signal?.throwIfAborted();
      yield input.subarray(offset, offset + 65536);
    }
  } else if (typeof input === "string" || input instanceof URL) {
    const response = await fetch(input, { signal });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error(`HMML fetch failed: ${response.status}`);
    }
    yield* sourceBytes(response.body, signal);
  } else if (typeof Blob !== "undefined" && input instanceof Blob) {
    yield* sourceBytes(input.stream(), signal);
  } else {
    yield* sourceBytes(input as ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>, signal);
  }
}
