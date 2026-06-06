let TABLE: Uint32Array | null = null;

function table(): Uint32Array {
  if (TABLE) return TABLE;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  TABLE = t;
  return t;
}

/**
 * Standard IEEE CRC32. Supports streaming continuation: passing a previous
 * (finalized) result as `seed` is equivalent to hashing the concatenation, i.e.
 * `crc32(b, crc32(a)) === crc32(concat(a, b))`.
 */
export function crc32(bytes: Uint8Array, seed = 0): number {
  const t = table();
  let c = (seed ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    c = (t[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xffffffff) >>> 0;
}
