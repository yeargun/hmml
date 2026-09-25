import type { DecoderRuntime } from "./decoder-runtime";
import type { DecodeInput, DecodeOptions, HmmlDocument } from "./types";

/** Complete-document behavior is only reachable from the complete-document API. */
export async function decodeWith(runtime: DecoderRuntime, input: DecodeInput, call: DecodeOptions = {}): Promise<HmmlDocument> {
  for await (const { reply, signal } of runtime.run(input, "document", call)) {
    signal.throwIfAborted();
    if (!reply) {
      const { decode } = await import("./decode-direct");
      return await decode(input, { ...call, signal });
    }
    if ("event" in reply && reply.event.type === "markup") await call.onMarkup?.(reply.event.html);
    if ("document" in reply) {
      const { documentFromData } = await import("./document");
      signal.throwIfAborted();
      return documentFromData(reply.document);
    }
  }
  throw new Error("HMML worker returned no document");
}
