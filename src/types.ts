/** A resource pulled out of the markup and stored as raw bytes (no base64). */
export interface HmmlResource {
  /** Stable id, referenced from the markup as `hmml:<id>` (e.g. "r0"). */
  id: string;
  /** MIME type, e.g. "image/webp", "image/png", "image/svg+xml". */
  mime: string;
  /** Raw, already-compressed resource bytes. */
  data: Uint8Array;
}

/** Input to {@link encode}. */
export interface HmmlInput {
  /** Full HTML/CSS/SVG markup. Resource references should use the `hmml:<id>` scheme. */
  html: string;
  /** Resources referenced by the markup. */
  resources?: HmmlResource[];
  /** Arbitrary JSON-serializable metadata stored in a META chunk. */
  meta?: Record<string, unknown>;
}

/**
 * A compression codec. Built-ins live in `codecs.ts`. Methods may be sync or
 * async (the native `CompressionStream` codecs are async); the encoder/decoder
 * always await them.
 *
 * `id` is a small integer (0-255) written into the file header so a decoder can
 * auto-resolve the right algorithm. Reserved built-in ids: 0=store, 1=deflate-raw,
 * 2=gzip, 3=zlib/deflate. Use >=16 for custom codecs.
 */
export interface Codec {
  readonly id: number;
  deflate(input: Uint8Array): Uint8Array | Promise<Uint8Array>;
  inflate(input: Uint8Array): Uint8Array | Promise<Uint8Array>;
}

export interface EncodeOptions {
  /** Codec for MARK/META payloads. Default: `storeCodec` (no compression). */
  codec?: Codec;
  /** Compress the markup chunk. Default: true when a non-store codec is given. */
  compressMarkup?: boolean;
  /** Compress the metadata chunk. Default: true when a non-store codec is given. */
  compressMeta?: boolean;
  /** Append a CRC32 to every chunk for integrity checking. Default: false. */
  crc?: boolean;
}

export interface DecodeOptions {
  /**
   * Codec to use for compressed chunks. Optional — if the file's codec id maps
   * to a built-in, it is resolved automatically. Required only for custom ids.
   */
  codec?: Codec;
}

/** How `toHTML` rewrites `hmml:<id>` references. */
export type ResolveMode = "datauri" | "keep";

/** A decoded HMML document. */
export interface HmmlDocument {
  version: { major: number; minor: number };
  /** Codec id recorded in the file header. */
  codecId: number;
  /** Markup with `hmml:<id>` references intact. */
  html: string;
  resources: Map<string, HmmlResource>;
  meta: Record<string, unknown>;
  /**
   * Markup with references resolved. `datauri` (default) inlines each resource
   * as a base64 data URI — fully self-contained, good for export/SSR. `keep`
   * leaves `hmml:` references untouched.
   */
  toHTML(opts?: { resolve?: ResolveMode }): string;
  /**
   * Browser-oriented: resolve references to `blob:` object URLs (cheaper than
   * data URIs for rendering). Call `revoke()` when the markup is torn down.
   */
  createObjectUrls(): { html: string; urls: string[]; revoke: () => void };
}
