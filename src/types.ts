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

/** Fetch/Blob bodies or an async iterable of byte chunks. */
export type ByteSource = ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>;

/** A resource whose bytes need not be resident in memory. Length may be unknown. */
export interface HmmlStreamResource {
  id: string;
  mime: string;
  byteLength?: number;
  data: ByteSource;
}

export interface HmmlStreamInput extends Omit<HmmlInput, "resources"> {
  /** Wire order is caller order: put critical images/fonts before bulk media. */
  resources?: Iterable<HmmlResource | HmmlStreamResource> | AsyncIterable<HmmlResource | HmmlStreamResource>;
}

/** Every data event has passed its chunk CRC (if present); resource-end validates total length. */
export type HmmlEvent =
  | { type: "header"; version: { major: number; minor: number }; codecId: number }
  | { type: "markup"; html: string }
  | { type: "metadata"; meta: Record<string, unknown> }
  | { type: "resource-start"; id: string; mime: string; byteLength?: number }
  | { type: "resource-data"; id: string; data: Uint8Array }
  | { type: "resource-end"; id: string }
  | { type: "end" };

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
  /** DATA payload size, 1..1 MiB. Default: 64 KiB. */
  chunkSize?: number;
  /** Codec for MARK/META payloads. Default: `storeCodec` (no compression). */
  codec?: Codec;
  /** Try compressing markup; retain only if smaller. Default: true with a non-store codec. */
  compressMarkup?: boolean;
  /** Try compressing metadata; retain only if smaller. Default: true with a non-store codec. */
  compressMeta?: boolean;
  /** Append a CRC32 to every chunk for integrity checking. Default: false. */
  crc?: boolean;
}

export interface DecodeLimits {
  /**
   * Codec to use for compressed chunks. Optional - if the file's codec id maps
   * to a built-in, it is resolved automatically. Required only for custom ids.
   */
  codec?: Codec;
  /** Maximum stored AND expanded MARK/META bytes, per chunk. Default: 16 MiB. */
  maxTextBytes?: number;
  /** Maximum resource data bytes, per resource. Default: Number.MAX_SAFE_INTEGER; set a lower application quota. */
  maxResourceBytes?: number;
  /** Maximum resource count. Default: 100,000. */
  maxResources?: number;
}

/** Inputs usable by the convenience API. URL/Blob inputs avoid a main-thread file copy. */
export type DecodeInput = Uint8Array | Blob | string | URL | ByteSource;
export type WorkerMode = "auto" | boolean;

export interface DirectDecodeOptions extends DecodeLimits {
  signal?: AbortSignal;
  /** Called once after validated markup, before assets. Awaited to preserve backpressure. */
  onMarkup?: (html: string) => void | Promise<void>;
}

export interface DecodeOptions extends DirectDecodeOptions {
  /** Auto reuses a worker in browser windows; false stays direct; true requires a worker. */
  worker?: WorkerMode;
  /** Transfer a whole Uint8Array buffer to the worker, detaching it. Default: false (preserve input). */
  transfer?: boolean;
}

export interface DirectStreamDecodeOptions extends DecodeLimits {
  /** Maximum bytes per resource-data event. Default: 64 KiB. */
  chunkSize?: number;
  signal?: AbortSignal;
}

export interface StreamDecodeOptions extends DirectStreamDecodeOptions {
  worker?: WorkerMode;
  transfer?: boolean;
}

export interface DecoderOptions {
  worker?: WorkerMode;
  /** Optional factory for application-owned bundler/CSP worker setup. Created lazily, reused. */
  workerFactory?: () => Worker;
  /** Concurrent worker requests (one shared worker, including fetches). Default: 4. */
  maxConcurrent?: number;
  /** Bound the readiness handshake. Default: 5000 ms. Auto caches startup failures. */
  startupTimeoutMs?: number;
}

export interface Decoder {
  decode(input: DecodeInput, options?: DecodeOptions): Promise<HmmlDocument>;
  decodeStream(input: DecodeInput, options?: StreamDecodeOptions): AsyncGenerator<HmmlEvent>;
  /** Cancel queued/active requests and terminate this decoder's worker. */
  dispose(): void;
}

/** Structured-cloneable data. Resolver methods are attached in the receiving realm. */
export interface HmmlDocumentData {
  version: { major: number; minor: number };
  codecId: number;
  html: string;
  resources: Map<string, HmmlResource>;
  meta: Record<string, unknown>;
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
   * as a base64 data URI - fully self-contained, good for export/SSR. `keep`
   * leaves `hmml:` references untouched.
   */
  toHTML(opts?: { resolve?: ResolveMode }): string;
  /**
   * Browser-oriented: resolve references to `blob:` object URLs (cheaper than
   * data URIs for rendering). Call `revoke()` when the markup is torn down.
   */
  createObjectUrls(): { html: string; urls: string[]; revoke: () => void };
}
