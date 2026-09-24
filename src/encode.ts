import { encodeStream } from "./encode-stream";
import type { EncodeOptions, HmmlInput } from "./types";
export type { EncodeOptions, HmmlInput } from "./types";

/** Serialize into one allocation for the file. Use encodeStream to avoid that allocation. */
export async function encode(input: HmmlInput, options: EncodeOptions = {}): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  let length = 0;
  for await (const part of encodeStream(input, options)) { parts.push(part); length += part.length; }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
