import { ByteReader } from "./bytes";
import { builtinCodec } from "./codecs";
import {
  CHUNK_ENDF,
  CHUNK_HEADER_SIZE,
  CHUNK_MARK,
  CHUNK_META,
  CHUNK_RSRC,
  FLAG_COMPRESSED,
  FLAG_HAS_CRC,
  SIGNATURE,
} from "./constants";
import { crc32 } from "./crc32";
import { inlineDataUris, inlineObjectUrls } from "./markup";
import type { Codec, DecodeOptions, HmmlDocument, HmmlResource, ResolveMode } from "./types";

const TD = new TextDecoder();

function readTag(r: ByteReader): string {
  const b = r.bytes(4);
  return String.fromCharCode(b[0]!, b[1]!, b[2]!, b[3]!);
}

function decodeResource(payload: Uint8Array): HmmlResource {
  const r = new ByteReader(payload);
  const idLen = r.u16();
  const id = TD.decode(r.bytes(idLen));
  const mimeLen = r.u16();
  const mime = TD.decode(r.bytes(mimeLen));
  const data = r.bytes(r.remaining).slice(); // detach from the file buffer
  return { id, mime, data };
}

/** Parse an HMML buffer into a document with resolvable resources. */
export async function decode(bytes: Uint8Array, options: DecodeOptions = {}): Promise<HmmlDocument> {
  const r = new ByteReader(bytes);

  const sig = r.bytes(SIGNATURE.length);
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (sig[i] !== SIGNATURE[i]) throw new Error("Not an HMML file (bad signature)");
  }
  const major = r.u8();
  const minor = r.u8();
  const codecId = r.u8();

  const codec: Codec | undefined =
    options.codec && options.codec.id === codecId ? options.codec : builtinCodec(codecId);

  let html = "";
  let meta: Record<string, unknown> = {};
  const resources = new Map<string, HmmlResource>();

  while (r.remaining >= CHUNK_HEADER_SIZE) {
    const headStart = r.pos;
    const type = readTag(r);
    const flags = r.u8();
    const len = r.u32();
    if (len > r.remaining) throw new Error(`Truncated HMML chunk "${type}"`);
    const payload = r.bytes(len);

    if (flags & FLAG_HAS_CRC) {
      const stored = r.u32();
      const head = bytes.subarray(headStart, headStart + CHUNK_HEADER_SIZE);
      const actual = crc32(payload, crc32(head));
      if (actual !== stored) throw new Error(`CRC32 mismatch in chunk "${type}"`);
    }

    const compressed = (flags & FLAG_COMPRESSED) !== 0;
    const inflate = async (p: Uint8Array): Promise<Uint8Array> => {
      if (!compressed) return p;
      if (!codec) throw new Error(`Chunk "${type}" is compressed with unknown codec id ${codecId}; pass a matching \`codec\``);
      return codec.inflate(p);
    };

    if (type === CHUNK_MARK) {
      html = TD.decode(await inflate(payload));
    } else if (type === CHUNK_META) {
      meta = JSON.parse(TD.decode(await inflate(payload))) as Record<string, unknown>;
    } else if (type === CHUNK_RSRC) {
      const res = decodeResource(payload);
      resources.set(res.id, res);
    } else if (type === CHUNK_ENDF) {
      break;
    }
    // Unknown chunk types are skipped (already consumed) for forward compatibility.
  }

  return {
    version: { major, minor },
    codecId,
    html,
    resources,
    meta,
    toHTML(opts?: { resolve?: ResolveMode }) {
      const mode = opts?.resolve ?? "datauri";
      return mode === "keep" ? html : inlineDataUris(html, resources);
    },
    createObjectUrls() {
      return inlineObjectUrls(html, resources);
    },
  };
}
