import { ByteReader } from "./bytes";
import { SIGNATURE, VERSION_MAJOR, VERSION_MINOR, FLAG_COMPRESSED, FLAG_HAS_CRC } from "./constants";
import type { DecodeOptions } from "./types";

import { limit, MAX_DATA_BYTES, validateResource } from "./validation";

export const textDecoder = /* @__PURE__ */ new TextDecoder("utf-8", { fatal: true });
export function header(bytes: Uint8Array) {
  if (bytes.length !== 12 || !SIGNATURE.every((b, i) => bytes[i] === b)) {
    throw new Error("Not an HMML file (bad signature)");
  }
  if (bytes[9] !== VERSION_MAJOR || bytes[10] !== VERSION_MINOR) {
    throw new Error(`Unsupported HMML version ${bytes[9]}.${bytes[10]}; expected 2.0`);
  }
  return { version: { major: bytes[9]!, minor: bytes[10]! }, codecId: bytes[11]! };
}

export interface ResourceState {
  id: string;
  mime: string;
  byteLength?: number;
  received: number;
}

export class ParseState {
  readonly maxText: number;
  readonly maxResource: number;
  readonly maxResources: number;
  current?: ResourceState;
  private chunks = 0;
  private mark = false;
  private meta = false;
  private ids = new Set<string>();

  constructor(readonly info: ReturnType<typeof header>, options: DecodeOptions) {
    this.maxText = limit(options.maxTextBytes, 16 * 1024 * 1024, "maxTextBytes");
    this.maxResource = limit(options.maxResourceBytes, Number.MAX_SAFE_INTEGER, "maxResourceBytes");
    this.maxResources = limit(options.maxResources, 100_000, "maxResources");
  }

  chunk(bytes: Uint8Array) {
    const r = new ByteReader(bytes);
    const type = String.fromCharCode(...r.bytes(4));
    const flags = r.u8();
    const length = r.u32();
    if (this.chunks++ === 0 && type !== "MARK") throw new Error("HMML requires MARK first");
    if (!["MARK", "META", "RSRC", "DATA", "REND", "ENDF"].includes(type)) throw new Error(`Unknown HMML chunk: ${type}`);
    if (flags & ~(FLAG_COMPRESSED | FLAG_HAS_CRC)) throw new Error(`Unsupported flags in ${type}`);
    if (flags & FLAG_COMPRESSED && (this.info.codecId === 0 || (type !== "MARK" && type !== "META"))) {
      throw new Error(`Invalid compression flag in ${type}`);
    }
    if (this.current && type !== "DATA" && type !== "REND") throw new Error(`Expected DATA or REND, got ${type}`);
    if (!this.current && (type === "DATA" || type === "REND")) throw new Error(`${type} outside a resource`);
    if (type === "MARK" || type === "META") {
      if (length > this.maxText) throw new Error(`${type} exceeds maxTextBytes`);
      if (type === "MARK") {
        if (this.mark) throw new Error("Duplicate MARK chunk");
        this.mark = true;
      } else {
        if (this.meta) throw new Error("Duplicate META chunk");
        this.meta = true;
      }
    }
    if (type === "DATA" && (!length || length > MAX_DATA_BYTES)) throw new Error("DATA length must be 1..1048576 bytes");
    if (type === "RSRC" && (length < 12 || length > 12 + 2 * 0xffff)) throw new Error("Invalid RSRC descriptor length");
    if ((type === "ENDF" || type === "REND") && length !== 0) throw new Error(`${type} must be empty`);
    return { type, flags, length };
  }

  resource(payload: Uint8Array): ResourceState {
    const r = new ByteReader(payload);
    const id = textDecoder.decode(r.bytes(r.u16()));
    const mime = textDecoder.decode(r.bytes(r.u16()));
    const low = r.u32(), high = r.u32();
    const byteLength = low === 0xffffffff && high === 0xffffffff ? undefined : high * 2 ** 32 + low;
    if (r.remaining) throw new Error("Trailing bytes in RSRC descriptor");
    validateResource(id, mime);
    if (byteLength !== undefined && (!Number.isSafeInteger(byteLength) || byteLength > this.maxResource)) {
      throw new Error("RSRC exceeds maxResourceBytes or safe integer length");
    }
    if (this.ids.has(id)) throw new Error(`Duplicate resource id: ${id}`);
    if (this.ids.size >= this.maxResources) throw new Error("HMML exceeds maxResources");
    this.ids.add(id);
    return this.current = { id, mime, byteLength, received: 0 };
  }

  data(length: number): string {
    const current = this.current!;
    current.received += length;
    if (!Number.isSafeInteger(current.received) || current.received > this.maxResource) throw new Error("RSRC exceeds maxResourceBytes");
    if (current.byteLength !== undefined && current.received > current.byteLength) throw new Error("Resource exceeds declared byteLength");
    return current.id;
  }

  resourceEnd(): ResourceState {
    const current = this.current!;
    if (current.byteLength !== undefined && current.received !== current.byteLength) throw new Error("Resource shorter than declared byteLength");
    this.current = undefined;
    return current;
  }

  end(found: boolean): void {
    if (!this.mark) throw new Error("Missing MARK chunk");
    if (!found) throw new Error("Truncated HMML: missing ENDF");
    if (this.current) throw new Error("Truncated HMML: missing REND");
  }
}

export function metadata(bytes: Uint8Array): Record<string, unknown> {
  const value: unknown = JSON.parse(textDecoder.decode(bytes));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("META must be a JSON object");
  return value as Record<string, unknown>;
}

/** Native decompression code loads only on the first compressed text chunk. */
export async function textPayload(payload: Uint8Array, flags: number, codecId: number, options: DecodeOptions, max: number) {
  if (!(flags & FLAG_COMPRESSED)) return payload;
  const custom = options.codec?.id === codecId ? options.codec : undefined;
  const result = custom
    ? await custom.inflate(payload)
    : await (await import("./inflate")).inflate(codecId, payload, max);
  if (result.length > max) throw new Error("Expanded text exceeds maxTextBytes");
  return result;
}
