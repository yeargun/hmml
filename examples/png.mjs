// Minimal, zero-dependency PNG (8-bit RGBA) encoder. Uses the platform
// CompressionStream for the zlib IDAT, so it runs unchanged in Node 18+ and in
// browsers. Handy for tests/demos that need a *real*, renderable image rather
// than random bytes.

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

async function zlibDeflate(input) {
  const cs = new CompressionStream("deflate"); // RFC 1950 zlib, exactly what PNG IDAT wants
  const writer = cs.writable.getWriter();
  writer.write(input);
  writer.close();
  const reader = cs.readable.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

function be32(n) {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}

function chunk(type, data) {
  const t = [type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)];
  const body = new Uint8Array(t.length + data.length);
  body.set(t, 0);
  body.set(data, t.length);
  return [...be32(data.length), ...body, ...be32(crc32(body))];
}

/**
 * @param {number} width
 * @param {number} height
 * @param {(x:number,y:number)=>[number,number,number,number]} [pixel] RGBA per pixel.
 * @returns {Promise<Uint8Array>} valid PNG bytes
 */
export async function makePng(width, height, pixel) {
  const px =
    pixel ||
    ((x, y) => [((x * 255) / width) | 0, ((y * 255) / height) | 0, 160, 255]); // default: gradient
  const raw = new Uint8Array(height * (1 + width * 4));
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0; // filter type 0 (none)
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = px(x, y);
      raw[p++] = r & 255;
      raw[p++] = g & 255;
      raw[p++] = b & 255;
      raw[p++] = a & 255;
    }
  }
  const idat = await zlibDeflate(raw);
  const ihdr = [...be32(width), ...be32(height), 8, 6, 0, 0, 0]; // bitDepth 8, colorType 6 (RGBA)
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return new Uint8Array([...sig, ...chunk("IHDR", ihdr), ...chunk("IDAT", idat), ...chunk("IEND", [])]);
}
