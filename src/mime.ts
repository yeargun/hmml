/** Sniff a MIME type from leading magic bytes. Covers the formats HMML targets. */
export function sniffMime(bytes: Uint8Array): string | undefined {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // "RIFF"
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 // "WEBP"
  )
    return "image/webp";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif"; // "GIF8"
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) return "image/bmp"; // "BM"
  if (
    b.length >= 12 &&
    b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 // "ftyp"
  ) {
    // AVIF / HEIC share the ISO-BMFF box layout; check the major brand.
    const brand = String.fromCharCode(b[8]!, b[9]!, b[10]!, b[11]!);
    if (brand.startsWith("avif") || brand.startsWith("avis")) return "image/avif";
    if (brand.startsWith("heic") || brand.startsWith("heix") || brand.startsWith("mif1")) return "image/heic";
  }
  // SVG / generic XML - sniff the first non-whitespace bytes as text.
  const head = new TextDecoder().decode(b.subarray(0, Math.min(b.length, 256))).trimStart();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "image/svg+xml";
  return undefined;
}

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "image/avif": "avif",
  "image/heic": "heic",
  "image/svg+xml": "svg",
};

/** Best-guess file extension for a MIME type (no leading dot). */
export function extensionFor(mime: string): string {
  return EXT[mime] ?? "bin";
}
