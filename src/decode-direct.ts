import { decodeBuffer } from "./decode-buffer";
import { documentFromData } from "./document";
import type { DecodeInput, DirectDecodeOptions, HmmlDocument } from "./types";
export type { DecodeInput, DirectDecodeOptions, HmmlDocument } from "./types";

/** Worker-free entry. Its runtime dependency graph never includes worker support. */
export async function decode(input: DecodeInput, options: DirectDecodeOptions = {}): Promise<HmmlDocument> {
  options.signal?.throwIfAborted();
  if (input instanceof Uint8Array) return documentFromData(await decodeBuffer(input, options));
  const [{ collectDocument }, { decodeStream }] = await Promise.all([import("./collect"), import("./decode-stream-direct")]);
  return documentFromData(await collectDocument(decodeStream(input, options), options.onMarkup));
}
