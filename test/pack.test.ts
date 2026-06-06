import { describe, expect, it } from "vitest";
import { pack, toBase64, unpack } from "../src/index";

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

describe("pack / unpack", () => {
  it("packs an HTML string (auto-extract, gzip default) and round-trips", async () => {
    const png = img(400, 5);
    const html = `<img src="data:image/png;base64,${toBase64(png)}">`;
    const bytes = await pack(html, { meta: { t: 1 } });

    const doc = await unpack(bytes);
    expect(doc.codecId).toBe(2); // gzip is the pack default
    expect(doc.resources.size).toBe(1);
    expect(doc.meta).toEqual({ t: 1 });
    expect(doc.toHTML()).toBe(html);
    expect(bytes.length).toBeLessThan(new TextEncoder().encode(html).length);
  });

  it("also accepts a structured { html, resources } input", async () => {
    const data = img(64, 9);
    const bytes = await pack({ html: `<img src="hmml:x">`, resources: [{ id: "x", mime: "image/png", data }] });
    const doc = await unpack(bytes);
    expect(doc.resources.get("x")!.data).toEqual(data);
    expect(doc.toHTML({ resolve: "keep" })).toBe(`<img src="hmml:x">`);
  });
});
