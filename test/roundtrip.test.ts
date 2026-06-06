import { describe, expect, it } from "vitest";
import {
  crc32,
  decode,
  deflateRawCodec,
  encode,
  extract,
  fromBase64,
  gzipCodec,
  sniffMime,
  storeCodec,
  toBase64,
} from "../src/index";

function img(n: number, seed: number): Uint8Array {
  const out = new Uint8Array(n);
  if (n >= 8) out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let x = seed >>> 0;
  for (let i = n >= 8 ? 8 : 0; i < n; i++) {
    x = (x * 1664525 + 1013904223) >>> 0;
    out[i] = (x >>> 16) & 0xff;
  }
  return out;
}

describe("base64", () => {
  it("round-trips arbitrary byte lengths", () => {
    for (const len of [0, 1, 2, 3, 4, 5, 255, 256, 1000]) {
      const a = img(len, len + 7);
      expect(fromBase64(toBase64(a))).toEqual(a);
    }
  });
});

describe("crc32", () => {
  it("matches the known check value for '123456789'", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
  it("supports streaming continuation", () => {
    const a = new TextEncoder().encode("hello ");
    const b = new TextEncoder().encode("world");
    const both = new TextEncoder().encode("hello world");
    expect(crc32(b, crc32(a))).toBe(crc32(both));
  });
});

describe("extract / inline", () => {
  it("lifts and dedupes data URIs, then inlines them back", () => {
    const data = `data:image/png;base64,${toBase64(img(64, 1))}`;
    const html = `<img src="${data}"><i style="background:url('${data}')"></i>`;
    const { html: refs, resources } = extract(html);
    expect(resources).toHaveLength(1); // deduped
    expect(refs).toContain("hmml:r0");
    expect(refs).not.toContain("data:");
  });

  it("leaves non-accepted mime types untouched", () => {
    const html = `<a href="data:text/plain,hello">x</a>`;
    const { resources } = extract(html);
    expect(resources).toHaveLength(0);
  });
});

describe("sniffMime", () => {
  it("detects png/jpeg/webp and svg", () => {
    expect(sniffMime(img(16, 1))).toBe("image/png");
    expect(sniffMime(new Uint8Array([0xff, 0xd8, 0xff, 0x00]))).toBe("image/jpeg");
    const webp = new Uint8Array(16);
    webp.set([0x52, 0x49, 0x46, 0x46], 0);
    webp.set([0x57, 0x45, 0x42, 0x50], 8);
    expect(sniffMime(webp)).toBe("image/webp");
    expect(sniffMime(new TextEncoder().encode("  <svg xmlns='...'>"))).toBe("image/svg+xml");
  });
});

for (const codec of [storeCodec, gzipCodec, deflateRawCodec]) {
  describe(`encode/decode with codec ${codec.id}`, () => {
    it("reproduces markup, resources and meta exactly", async () => {
      const a = img(5000, 3);
      const b = img(2000, 4);
      const original =
        `<div style="transform:matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)">` +
        `<img src="data:image/png;base64,${toBase64(a)}">` +
        `<span style="background:url(data:image/png;base64,${toBase64(b)})"></span></div>`;

      const { html, resources } = extract(original);
      const file = await encode({ html, resources, meta: { title: "t", n: 42 } }, { codec, crc: true });

      // signature check
      expect(file[0]).toBe(0x89);
      expect(String.fromCharCode(file[1]!, file[2]!, file[3]!, file[4]!)).toBe("HMML");

      const doc = await decode(file);
      expect(doc.codecId).toBe(codec.id);
      expect(doc.meta).toEqual({ title: "t", n: 42 });
      expect(doc.resources.size).toBe(2);
      expect(doc.resources.get("r0")!.data).toEqual(a);
      expect(doc.resources.get("r1")!.data).toEqual(b);
      expect(doc.toHTML()).toBe(original);
      expect(doc.toHTML({ resolve: "keep" })).toBe(html);
    });
  });
}

describe("integrity", () => {
  it("rejects a bad signature", async () => {
    await expect(decode(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))).rejects.toThrow(/signature/i);
  });

  it("detects corruption via CRC", async () => {
    const file = await encode({ html: "<p>hi</p>" }, { codec: storeCodec, crc: true });
    // Header is 12 bytes; the MARK chunk header is 9 more, so byte 21 is the
    // first byte of the MARK payload. Flipping it must trip the chunk CRC.
    const corrupt = file.slice();
    corrupt[21]! ^= 0xff;
    await expect(decode(corrupt)).rejects.toThrow(/CRC/i);
  });

  it("is smaller than self-contained base64 HTML", async () => {
    const a = img(40_000, 9);
    const original = `<img src="data:image/png;base64,${toBase64(a)}">`;
    const { html, resources } = extract(original);
    const file = await encode({ html, resources }, { codec: gzipCodec });
    expect(file.length).toBeLessThan(new TextEncoder().encode(original).length);
  });
});
