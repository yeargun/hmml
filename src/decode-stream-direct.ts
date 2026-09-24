import { openSource } from "./input";
import { limit } from "./validation";
import { ByteReader } from "./bytes";
import { FLAG_HAS_CRC } from "./constants";
import { crc32 } from "./crc32";
import { header, metadata, ParseState, textDecoder, textPayload } from "./parse";
import { sourceBytes, StreamReader } from "./source";
import type { DecodeInput, HmmlEvent, DirectStreamDecodeOptions } from "./types";
export type { DecodeInput, HmmlEvent, DirectStreamDecodeOptions } from "./types";

/**
 * Pull-based HMML v2 decoding. MARK is always the first content event. Memory is
 * bounded by text limits, a <=1 MiB DATA chunk, one upstream chunk, and resource
 * IDs. No DOM or resource accumulation. Early return cancels/releases the source.
 * Resource data buffers are owned and safe to transfer without detaching input.
 */
export async function* decodeStream(input: DecodeInput, options: DirectStreamDecodeOptions = {}): AsyncGenerator<HmmlEvent> {
  const chunkSize = limit(options.chunkSize, 64 * 1024, "chunkSize");
  if (!chunkSize) throw new RangeError("chunkSize must be positive");
  const iterator = sourceBytes(openSource(input, options.signal), options.signal);
  const reader = new StreamReader(iterator);
  try {
    const info = header((await reader.exact(12))!);
    const state = new ParseState(info, options);
    yield { type: "header", ...info };
    for (;;) {
      options.signal?.throwIfAborted();
      const head = await reader.exact(9, true);
      if (!head) { state.end(false); return; }
      const { type, flags, length } = state.chunk(head);
      const seed = flags & FLAG_HAS_CRC ? crc32(head) : 0;
      if (type === "DATA") state.data(length);
      const read = (await reader.exact(length))!;
      // The CRC read may resume an upstream iterator that reuses its buffer.
      const payload = flags & FLAG_HAS_CRC ? read.slice() : read;
      if (flags & FLAG_HAS_CRC) {
        const checksum = crc32(payload, seed);
        if (new ByteReader((await reader.exact(4))!).u32() !== checksum) throw new Error(`CRC32 mismatch in chunk "${type}"`);
      }
      if (type === "MARK" || type === "META") {
        const bytes = await textPayload(payload, flags, info.codecId, options, state.maxText);
        options.signal?.throwIfAborted();
        if (type === "MARK") yield { type: "markup", html: textDecoder.decode(bytes) };
        else yield { type: "metadata", meta: metadata(bytes) };
      } else if (type === "RSRC") {
        const { id, mime, byteLength } = state.resource(payload);
        yield { type: "resource-start", id, mime, byteLength };
      } else if (type === "DATA") {
        for (let offset = 0; offset < payload.length; offset += chunkSize) {
          options.signal?.throwIfAborted();
          const data = flags & FLAG_HAS_CRC && offset === 0 && payload.length <= chunkSize
            ? payload : payload.slice(offset, offset + chunkSize);
          // The consumer may transfer this buffer before asking for another event.
          const last = offset + chunkSize >= payload.length;
          yield { type: "resource-data", id: state.current!.id, data };
          if (last) break;
        }
      } else if (type === "REND") {
        yield { type: "resource-end", id: state.resourceEnd().id };
      } else if (type === "ENDF") {
        state.end(true);
        yield { type: "end" };
        return;
      }
    }
  } finally {
    await iterator.return(undefined);
  }
}
