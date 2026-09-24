import type { DecoderRuntime } from "./decoder-runtime";
import type { DecodeInput, HmmlEvent, StreamDecodeOptions } from "./types";

/** Event-only behavior has no dependency on collectors or document URL helpers. */
export async function* decodeStreamWith(runtime: DecoderRuntime, input: DecodeInput, call: StreamDecodeOptions = {}): AsyncGenerator<HmmlEvent> {
  for await (const { reply, signal } of runtime.run(input, "stream", call)) {
    signal.throwIfAborted();
    if (!reply) {
      const { decodeStream } = await import("./decode-stream-direct");
      yield* decodeStream(input, { ...call, signal });
    } else if ("event" in reply) yield reply.event;
  }
}
