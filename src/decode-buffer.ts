import { ByteReader } from "./bytes";
import { FLAG_HAS_CRC } from "./constants";
import { crc32 } from "./crc32";
import { header, metadata, ParseState, textDecoder, textPayload } from "./parse";
import type { DirectDecodeOptions, HmmlDocumentData, HmmlResource } from "./types";

/** In-memory convenience API. Large media should use decodeStream and an incremental sink. */
export async function decodeBuffer(bytes: Uint8Array, options: DirectDecodeOptions = {}): Promise<HmmlDocumentData> {
  options.signal?.throwIfAborted();
  const info = header(bytes.subarray(0, 12));
  const state = new ParseState(info, options);
  const r = new ByteReader(bytes);
  r.pos = 12;
  let html = "";
  let meta: Record<string, unknown> = {};
  const resources = new Map<string, HmmlResource>();
  let parts: Uint8Array[] = [];
  let ended = false;
  while (r.remaining) {
    options.signal?.throwIfAborted();
    const head = r.bytes(9);
    const { type, flags, length } = state.chunk(head);
    if (type === "DATA") state.data(length);
    const payload = r.bytes(length);
    if (flags & FLAG_HAS_CRC) {
      if (r.u32() !== crc32(payload, crc32(head))) throw new Error(`CRC32 mismatch in chunk "${type}"`);
    }
    if (type === "MARK" || type === "META") {
      const text = await textPayload(payload, flags, info.codecId, options, state.maxText);
      if (type === "MARK") {
        html = textDecoder.decode(text);
        await options.onMarkup?.(html);
        options.signal?.throwIfAborted();
      }
      else meta = metadata(text);
    } else if (type === "RSRC") {
      state.resource(payload);
      parts = [];
    } else if (type === "DATA") {
      parts.push(payload);
    } else if (type === "REND") {
      const { id, mime, received } = state.resourceEnd();
      const data = new Uint8Array(received);
      let offset = 0;
      for (const part of parts) { data.set(part, offset); offset += part.length; }
      resources.set(id, { id, mime, data });
      parts = [];
    } else if (type === "ENDF") {
      ended = true;
      break;
    }
  }
  state.end(ended);
  return { ...info, html, resources, meta };
}
