import { createDecoderRuntime } from "./decoder-runtime";
import { decodeWith } from "./decode-operation";
import { decodeStreamWith } from "./decode-stream-operation";
import type { Decoder, DecoderOptions } from "./types";
export { disposeDecoder } from "./decoder-runtime";
export type { Decoder, DecoderOptions } from "./types";

/** One lazy, reusable dedicated worker per decoder instance. Nothing starts on import. */
export function createDecoder(options: DecoderOptions = {}): Decoder {
  const runtime = createDecoderRuntime(options);
  return {
    decode: (input, call) => decodeWith(runtime, input, call),
    decodeStream: (input, call) => decodeStreamWith(runtime, input, call),
    dispose: () => runtime.dispose(),
  };
}
