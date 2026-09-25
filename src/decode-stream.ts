import { defaultRuntime } from "./decoder-runtime";
import { decodeStreamWith } from "./decode-stream-operation";
import type { DecodeInput, HmmlEvent, StreamDecodeOptions } from "./types";
export { disposeDecoder } from "./decoder-runtime";
export type { ByteSource, DecodeInput, HmmlEvent, StreamDecodeOptions } from "./types";

/** Stream via the same shared worker as decode(); worker:false always uses the calling thread. */
export function decodeStream(input: DecodeInput, options?: StreamDecodeOptions): AsyncGenerator<HmmlEvent> {
  return decodeStreamWith(defaultRuntime(), input, options);
}
