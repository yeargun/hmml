/**
 * On-disk constants for the HMML binary container.
 *
 * The format is a PNG/RIFF-style chunked stream:
 *
 *   SIGNATURE(8) MAJOR(1) MINOR(1) CODEC(1)  then a sequence of chunks until ENDF.
 *
 * Each chunk is:  TYPE(4 ascii) FLAGS(1) LEN(u32 LE) PAYLOAD(LEN) [CRC32(u32 LE)?]
 */

/**
 * 8-byte file signature. Borrowed from PNG's design:
 *  - 0x89 (high bit set) detects 7-bit / text-mode transfer corruption
 *  - "HMML" identifies the format to humans + `file(1)`-style tools
 *  - 0x0D 0x0A 0x1A 0x0A catches CRLF/LF newline mangling and stops terminal `cat`
 */
export const SIGNATURE = new Uint8Array([0x89, 0x48, 0x4d, 0x4d, 0x4c, 0x0d, 0x0a, 0x1a, 0x0a]);

export const VERSION_MAJOR = 1;
export const VERSION_MINOR = 0;

/** Chunk type tags. Each is exactly 4 ASCII bytes. */
export const CHUNK_MARK = "MARK"; // the HTML/CSS/SVG markup (one per file)
export const CHUNK_RSRC = "RSRC"; // a single referenced resource (image, font, ...)
export const CHUNK_META = "META"; // JSON metadata (optional)
export const CHUNK_ENDF = "ENDF"; // end-of-document marker (length 0)

/** Per-chunk flag bits (the FLAGS byte). */
export const FLAG_COMPRESSED = 1 << 0; // payload ran through the document codec
export const FLAG_HAS_CRC = 1 << 1; // a trailing CRC32 follows the payload

/** The URI scheme markup uses to point at resources, e.g. `hmml:r0`. */
export const REF_SCHEME = "hmml:";

/** Number of bytes in a chunk header before the payload: TYPE(4) FLAGS(1) LEN(4). */
export const CHUNK_HEADER_SIZE = 9;
