import { ByteWriter } from "./bytes";
import { FLAG_COMPRESSED, FLAG_HAS_CRC, SIGNATURE, VERSION_MAJOR, VERSION_MINOR } from "./constants";
import { crc32 } from "./crc32";
import { sourceBytes } from "./source";
import { limit, MAX_DATA_BYTES, validateResource } from "./validation";
import type { ByteSource, EncodeOptions, HmmlStreamInput } from "./types";
export type { EncodeOptions, HmmlStreamInput, HmmlStreamResource } from "./types";

const TE = /* @__PURE__ */ new TextEncoder();

function* chunk(type: string, payload: Uint8Array, compressed: boolean, crc: boolean) {
  if (payload.length > 0xffffffff) throw new RangeError("HMML chunk exceeds u32 length");
  const head = new ByteWriter(9).bytes(TE.encode(type))
    .u8((compressed ? FLAG_COMPRESSED : 0) | (crc ? FLAG_HAS_CRC : 0)).u32(payload.length).finish();
  // Compute before yielding, so a transferred/reused payload cannot change CRC.
  const checksum = crc ? crc32(payload, crc32(head)) : 0;
  yield head;
  if (payload.length) yield payload;
  if (crc) yield new ByteWriter(4).u32(checksum).finish();
}

/** Coalesce tiny upstream fragments; keep at most one DATA payload under construction. */
async function* dataChunks(source: ByteSource | Uint8Array, size: number): AsyncGenerator<Uint8Array> {
  if (source instanceof Uint8Array) {
    for (let offset = 0; offset < source.length; offset += size) {
      yield offset === 0 && source.length <= size ? source : source.subarray(offset, offset + size);
    }
    return;
  }
  let buffer: Uint8Array | undefined;
  let filled = 0;
  for await (const bytes of sourceBytes(source)) {
    let offset = 0;
    while (offset < bytes.length) {
      if (!filled && bytes.length - offset >= size) {
        yield bytes.subarray(offset, offset + size);
        offset += size;
      } else {
        buffer ??= new Uint8Array(size);
        const count = Math.min(size - filled, bytes.length - offset);
        buffer.set(bytes.subarray(offset, offset + count), filled);
        filled += count;
        offset += count;
        if (filled === size) { yield buffer; buffer = undefined; filled = 0; }
      }
    }
  }
  if (filled) yield buffer!.subarray(0, filled);
}

/**
 * HMML v2: MARK, optional META, then RSRC / bounded DATA* / REND per resource,
 * and ENDF. Accepts unknown-length streams and media larger than 4 GiB. Text
 * compression is retained only if smaller. Yielded views must not be mutated.
 */
export async function* encodeStream(input: HmmlStreamInput, options: EncodeOptions = {}): AsyncGenerator<Uint8Array> {
  const codec = options.codec;
  const codecId = codec?.id ?? 0;
  if (!Number.isInteger(codecId) || codecId < 0 || codecId > 255) throw new Error(`Codec id must be an integer in 0..255 (got ${codecId})`);
  const chunkSize = limit(options.chunkSize, 64 * 1024, "chunkSize");
  if (!chunkSize || chunkSize > MAX_DATA_BYTES) throw new RangeError("chunkSize must be 1..1048576");
  const crc = options.crc ?? false;
  yield new ByteWriter(12).bytes(SIGNATURE).u8(VERSION_MAJOR).u8(VERSION_MINOR).u8(codecId).finish();

  async function* text(type: string, value: string, compress: boolean) {
    let payload: Uint8Array = TE.encode(value);
    let compressed = false;
    if (codec && codecId !== 0 && compress) {
      const candidate = await codec.deflate(payload);
      if (candidate.length < payload.length) { payload = candidate; compressed = true; }
    }
    yield* chunk(type, payload, compressed, crc);
  }

  yield* text("MARK", input.html, options.compressMarkup ?? true);
  if (input.meta && Object.keys(input.meta).length) yield* text("META", JSON.stringify(input.meta), options.compressMeta ?? true);
  const ids = new Set<string>();
  for await (const resource of input.resources ?? []) {
    validateResource(resource.id, resource.mime);
    if (ids.has(resource.id)) throw new Error(`Duplicate resource id: ${resource.id}`);
    ids.add(resource.id);
    const id = TE.encode(resource.id);
    const mime = TE.encode(resource.mime);
    if (id.length > 0xffff || mime.length > 0xffff) throw new Error("Resource id or MIME exceeds u16 length");
    const size = resource.data instanceof Uint8Array ? resource.data.length : (resource as { byteLength?: number }).byteLength;
    if (size !== undefined && (!Number.isSafeInteger(size) || size < 0)) throw new RangeError("Invalid resource byteLength");
    const descriptor = new ByteWriter(12 + id.length + mime.length)
      .u16(id.length).bytes(id).u16(mime.length).bytes(mime)
      .u32(size === undefined ? 0xffffffff : size % 2 ** 32)
      .u32(size === undefined ? 0xffffffff : Math.floor(size / 2 ** 32)).finish();
    yield* chunk("RSRC", descriptor, false, crc);
    let total = 0;
    for await (const bytes of dataChunks(resource.data, chunkSize)) {
      total += bytes.length;
      if (!Number.isSafeInteger(total) || (size !== undefined && total > size)) throw new Error("Resource exceeds declared byteLength");
      yield* chunk("DATA", bytes, false, crc);
    }
    if (size !== undefined && total !== size) throw new Error("Resource shorter than declared byteLength");
    yield* chunk("REND", new Uint8Array(0), false, crc);
  }
  yield* chunk("ENDF", new Uint8Array(0), false, crc);
}
