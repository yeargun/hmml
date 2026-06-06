/**
 * HMML — HyperMedia Markup Language.
 *
 * A compact binary container that pairs HTML/CSS/SVG markup with its images
 * stored as raw bytes (no base64) and referenced via the `hmml:<id>` scheme.
 *
 * @example
 * ```ts
 * import { encode, decode, extract, gzipCodec } from "hmml";
 *
 * const { html, resources } = extract(someHtmlWithDataUris);
 * const file = await encode({ html, resources, meta: { title: "Card" } }, { codec: gzipCodec });
 *
 * const doc = await decode(file);
 * document.body.innerHTML = doc.toHTML(); // resources inlined as data URIs
 * ```
 */

export { pack, unpack } from "./pack";
export type { PackOptions } from "./pack";
export { encode } from "./encode";
export { decode } from "./decode";
export { extract, inlineDataUris, inlineObjectUrls } from "./markup";
export type { ExtractOptions } from "./markup";

export { storeCodec, deflateRawCodec, deflateCodec, gzipCodec, builtinCodec } from "./codecs";
export { sniffMime, extensionFor } from "./mime";
export { toBase64, fromBase64 } from "./base64";
export { crc32 } from "./crc32";
export { ByteReader, ByteWriter } from "./bytes";

export {
  SIGNATURE,
  VERSION_MAJOR,
  VERSION_MINOR,
  REF_SCHEME,
  CHUNK_MARK,
  CHUNK_RSRC,
  CHUNK_META,
  CHUNK_ENDF,
} from "./constants";

export type {
  HmmlResource,
  HmmlInput,
  HmmlDocument,
  Codec,
  EncodeOptions,
  DecodeOptions,
  ResolveMode,
} from "./types";
