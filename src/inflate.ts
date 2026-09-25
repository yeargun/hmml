/** Decode-only native codec; no encoder, polyfill, or third-party compression dependency. */
export async function inflate(id: number, bytes: Uint8Array, max: number): Promise<Uint8Array> {
  const format = ({ 1: "deflate-raw", 2: "gzip", 3: "deflate" } as const)[id as 1 | 2 | 3];
  if (!format) throw new Error(`Unknown codec id ${id}; pass a matching codec`);
  if (typeof DecompressionStream === "undefined") throw new Error("HMML requires DecompressionStream or a custom codec");
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream(format));
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > max) throw new Error("Expanded text exceeds maxTextBytes");
      parts.push(value);
    }
  } finally {
    try { await reader.cancel(); } finally { reader.releaseLock(); }
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
