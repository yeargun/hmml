import { decode } from "./decode";
import { gzipCodec } from "./codecs";
import { encode } from "./encode";
import { extract } from "./markup";
import type { DecodeOptions, EncodeOptions, HmmlDocument, HmmlInput } from "./types";

export interface PackOptions extends EncodeOptions {
  /** When `input` is an HTML string, lift its `data:` URIs into resources. Default: true. */
  autoExtract?: boolean;
  /** Metadata to attach (handy when `input` is a bare HTML string). */
  meta?: Record<string, unknown>;
}

/**
 * One-call encode - the easy path.
 *
 * Pass an HTML string (any `data:` image URIs are pulled out into raw resources
 * automatically) or a full `{ html, resources }`. Defaults to **gzip** so you
 * get the smallest file with zero config; the codec is recorded in the file, so
 * {@link unpack} needs no options.
 *
 * @example
 * const bytes = await pack(`<img src="data:image/webp;base64,…">`);
 * const doc = await unpack(bytes);
 * el.innerHTML = doc.toHTML();
 */
export async function pack(input: string | HmmlInput, options: PackOptions = {}): Promise<Uint8Array> {
  const codec = options.codec ?? gzipCodec;
  const base: HmmlInput =
    typeof input === "string" ? (options.autoExtract ?? true ? extract(input) : { html: input }) : input;
  const doc: HmmlInput = { ...base, meta: options.meta ?? base.meta };
  return encode(doc, { ...options, codec });
}

/** One-call decode. Equivalent to {@link decode}; pairs with {@link pack}. */
export async function unpack(bytes: Uint8Array, options?: DecodeOptions): Promise<HmmlDocument> {
  return decode(bytes, options);
}
