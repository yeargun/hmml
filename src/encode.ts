import { ByteWriter } from "./bytes";
import { storeCodec } from "./codecs";
import {
  CHUNK_ENDF,
  CHUNK_MARK,
  CHUNK_META,
  CHUNK_RSRC,
  FLAG_COMPRESSED,
  FLAG_HAS_CRC,
  SIGNATURE,
  VERSION_MAJOR,
  VERSION_MINOR,
} from "./constants";
import { crc32 } from "./crc32";
import type { EncodeOptions, HmmlInput } from "./types";

const TE = new TextEncoder();

function tag4(s: string): Uint8Array {
  const b = new Uint8Array(4);
  for (let i = 0; i < 4; i++) b[i] = s.charCodeAt(i);
  return b;
}

function writeChunk(w: ByteWriter, type: string, payload: Uint8Array, compressed: boolean, crc: boolean): void {
  let flags = 0;
  if (compressed) flags |= FLAG_COMPRESSED;
  if (crc) flags |= FLAG_HAS_CRC;

  const head = new ByteWriter(9).bytes(tag4(type)).u8(flags).u32(payload.length).finish();
  w.bytes(head).bytes(payload);
  if (crc) w.u32(crc32(payload, crc32(head)));
}

/** Serialize markup + resources + metadata into the HMML binary format. */
export async function encode(input: HmmlInput, options: EncodeOptions = {}): Promise<Uint8Array> {
  const codec = options.codec ?? storeCodec;
  const crc = options.crc ?? false;
  const canCompress = codec.id !== 0;
  const compressMarkup = options.compressMarkup ?? canCompress;
  const compressMeta = options.compressMeta ?? canCompress;

  if (codec.id < 0 || codec.id > 255 || !Number.isInteger(codec.id)) {
    throw new Error(`Codec id must be an integer in 0..255 (got ${codec.id})`);
  }

  const w = new ByteWriter(4096);
  w.bytes(SIGNATURE).u8(VERSION_MAJOR).u8(VERSION_MINOR).u8(codec.id);

  // META (optional)
  if (input.meta && Object.keys(input.meta).length > 0) {
    let payload: Uint8Array = TE.encode(JSON.stringify(input.meta));
    let compressed = false;
    if (compressMeta && canCompress) {
      payload = await codec.deflate(payload);
      compressed = true;
    }
    writeChunk(w, CHUNK_META, payload, compressed, crc);
  }

  // MARK (exactly one)
  {
    let payload: Uint8Array = TE.encode(input.html ?? "");
    let compressed = false;
    if (compressMarkup && canCompress) {
      payload = await codec.deflate(payload);
      compressed = true;
    }
    writeChunk(w, CHUNK_MARK, payload, compressed, crc);
  }

  // RSRC (zero or more) — raw bytes, never compressed (images are already compressed).
  for (const r of input.resources ?? []) {
    const idB = TE.encode(r.id);
    const mimeB = TE.encode(r.mime);
    if (idB.length > 0xffff) throw new Error(`Resource id too long: ${r.id}`);
    if (mimeB.length > 0xffff) throw new Error(`Resource mime too long: ${r.mime}`);
    const payload = new ByteWriter(idB.length + mimeB.length + r.data.length + 4)
      .u16(idB.length)
      .bytes(idB)
      .u16(mimeB.length)
      .bytes(mimeB)
      .bytes(r.data)
      .finish();
    writeChunk(w, CHUNK_RSRC, payload, false, crc);
  }

  // ENDF
  writeChunk(w, CHUNK_ENDF, new Uint8Array(0), false, crc);

  return w.finish();
}
