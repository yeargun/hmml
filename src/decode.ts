import { defaultRuntime } from "./decoder-runtime";
import { decodeWith } from "./decode-operation";
import type { DecodeInput, DecodeOptions, HmmlDocument } from "./types";
export { disposeDecoder } from "./decoder-runtime";
export type { DecodeInput, DecodeOptions, Decoder, DecoderOptions, HmmlDocument } from "./types";

/** Decode with a shared worker when available, or choose worker:false / worker:true explicitly. */
export function decode(input: DecodeInput, options?: DecodeOptions): Promise<HmmlDocument> {
  return decodeWith(defaultRuntime(), input, options);
}
