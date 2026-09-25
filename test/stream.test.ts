import { describe, expect, it, vi } from "vitest";
import { encode } from "../src/encode";
import { decode } from "../src/decode";
import { encodeStream } from "../src/encode-stream";
import { decodeStream } from "../src/decode-stream";
import { gzipCodec } from "../src/codecs";
import { ByteWriter } from "../src/bytes";
import { crc32 } from "../src/crc32";
import type { HmmlEvent, StreamDecodeOptions } from "../src/types";

const html = '<main>🪴 blueprint <img src="hmml:hero"></main>';
const media = Uint8Array.from({ length: 137 }, (_, i) => i);
const input = { html, meta: { title: "café" }, resources: [{ id: "hero", mime: "image/png", data: media }] };
const join = (parts: Uint8Array[]) => {
  const result = new Uint8Array(parts.reduce((n, b) => n + b.length, 0));
  let offset = 0;
  for (const b of parts) { result.set(b, offset); offset += b.length; }
  return result;
};
async function* fragments(bytes: Uint8Array, size = 1) {
  for (let i = 0; i < bytes.length; i += size) yield bytes.subarray(i, i + size);
}
async function events(bytes: Uint8Array, options?: StreamDecodeOptions) {
  const result: HmmlEvent[] = [];
  for await (const event of decodeStream(fragments(bytes), options)) result.push(event);
  return result;
}
function chunk(type: string, payload: Uint8Array = new Uint8Array(0), flags = 0) {
  const head = new ByteWriter().bytes(new TextEncoder().encode(type)).u8(flags).u32(payload.length).finish();
  return join([head, payload, ...(flags & 2 ? [new ByteWriter().u32(crc32(payload, crc32(head))).finish()] : [])]);
}

for (const crc of [false, true]) {
  it(`decodes arbitrary splits, UTF-8 and gzip (CRC=${crc})`, async () => {
    const repeated = { ...input, html: html.repeat(100) };
    const bytes = await encode(repeated, { crc, codec: gzipCodec });
    for (const size of [1, 2, 7, 13, bytes.length]) {
      const seen: HmmlEvent[] = [];
      for await (const event of decodeStream(fragments(bytes, size), { chunkSize: 11 })) seen.push(event);
      expect(seen[1]).toEqual({ type: "markup", html: repeated.html });
      expect(seen.find(e => e.type === "metadata")).toEqual({ type: "metadata", meta: input.meta });
      const parts = seen.filter((e): e is Extract<HmmlEvent, { type: "resource-data" }> => e.type === "resource-data");
      expect(parts.every(e => e.data.length <= 11)).toBe(true);
      expect(join(parts.map(e => e.data))).toEqual(media);
      expect(seen.slice(-2)).toEqual([{ type: "resource-end", id: "hero" }, { type: "end" }]);
    }
  });
}

it("publishes markup without pulling metadata or media; early return cancels and unlocks", async () => {
  let pulls = 0;
  let cancelled = false;
  const parts: Uint8Array[] = [];
  for await (const part of encodeStream(input)) parts.push(part);
  const source = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(parts[pulls++]!); },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  const stream = decodeStream(source);
  expect((await stream.next()).value?.type).toBe("header");
  expect(pulls).toBe(1);
  expect((await stream.next()).value).toEqual({ type: "markup", html });
  expect(pulls).toBe(3);
  await stream.return(undefined);
  expect(cancelled).toBe(true);
  expect(source.locked).toBe(false);
});

it("resource buffers can be transferred without detaching parser input", async () => {
  const bytes = await encode(input, { crc: true });
  const received: Uint8Array[] = [];
  for await (const event of decodeStream(fragments(bytes, bytes.length), { chunkSize: 17 })) {
    if (event.type === "resource-data") {
      expect(event.data.byteOffset).toBe(0);
      expect(event.data.buffer.byteLength).toBe(event.data.byteLength);
      received.push(structuredClone(event.data, { transfer: [event.data.buffer as ArrayBuffer] }));
      expect(event.data.byteLength).toBe(0);
    }
  }
  expect(join(received)).toEqual(media);
  expect(bytes.length).toBeGreaterThan(media.length);
});

it("streams resource input without prefetching it; validates declared length", async () => {
  let pulled = false;
  async function* resources() {
    pulled = true;
    yield { id: "hero", mime: "image/png", data: fragments(media, 3), byteLength: media.length };
  }
  const writer = encodeStream({ html, resources: resources() }, { crc: true });
  const parts = [];
  for (let i = 0; i < 4; i++) parts.push((await writer.next()).value!);
  expect(pulled).toBe(false);
  for await (const part of writer) parts.push(part);
  expect((await decode(join(parts))).resources.get("hero")?.data).toEqual(media);
  for (const byteLength of [media.length - 1, media.length + 1]) {
    await expect((async () => {
      for await (const _ of encodeStream({ html, resources: [{ id: "x", mime: "image/png", data: fragments(media), byteLength }] })) { /* drain */ }
    })()).rejects.toThrow(/byteLength/);
  }
});

it("passes through media without copies in streaming encode", async () => {
  const parts = [];
  for await (const part of encodeStream(input)) parts.push(part);
  expect(parts).toContain(media);
});

it("aborts an outstanding read and releases its lock", async () => {
  const cancel = vi.fn();
  let reading!: () => void;
  const started = new Promise<void>(resolve => { reading = resolve; });
  const source = new ReadableStream<Uint8Array>({ cancel, pull() { reading(); } }, { highWaterMark: 0 });
  const controller = new AbortController();
  const next = decodeStream(source, { signal: controller.signal }).next();
  await started;
  controller.abort();
  await expect(next).rejects.toThrow();
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(source.locked).toBe(false);
});

it("releases sources on upstream errors", async () => {
  const source = new ReadableStream<Uint8Array>({ start(c) { c.error(new Error("network failure")); } });
  await expect(decodeStream(source).next()).rejects.toThrow("network failure");
  expect(source.locked).toBe(false);
});

it("keeps small text stored when gzip would expand it", async () => {
  const bytes = await encode({ html: "hi", meta: { a: 1 } }, { codec: gzipCodec });
  expect(bytes[16]! & 1).toBe(0);
  expect((await decode(bytes)).html).toBe("hi");
});

it("rejects legacy versions and unknown chunk types", async () => {
  const bytes = await encode({ html });
  const legacy = bytes.slice(); legacy[9] = 1;
  for (const invalid of [legacy, join([bytes.subarray(0, -9), chunk("TEST"), bytes.subarray(-9)])]) {
    await expect(decode(invalid)).rejects.toThrow();
    await expect(events(invalid)).rejects.toThrow();
  }
});

it("supports unknown-length resources and empty assets", async () => {
  const parts: Uint8Array[] = [];
  for await (const part of encodeStream({ html, resources: [
    { id: "audio", mime: "audio/ogg", data: fragments(media, 7) },
    { id: "empty", mime: "application/octet-stream", data: fragments(new Uint8Array()) },
  ] }, { chunkSize: 32, crc: true })) parts.push(part);
  const bytes = join(parts);
  const seen = await events(bytes);
  expect(seen.find(e => e.type === "resource-start")).toEqual({ type: "resource-start", id: "audio", mime: "audio/ogg", byteLength: undefined });
  const doc = await decode(bytes);
  expect(doc.resources.get("audio")?.data).toEqual(media);
  expect(doc.resources.get("empty")?.data.length).toBe(0);
});

it("represents lengths above 4 GiB without allocating a resource", async () => {
  const size = 2 ** 32 + 123;
  const writer = encodeStream({ html, resources: [{ id: "movie", mime: "video/mp4", byteLength: size, data: fragments(new Uint8Array()) }] });
  const reader = decodeStream(writer);
  for await (const event of reader) {
    if (event.type === "resource-start") {
      expect(event.byteLength).toBe(size);
      break;
    }
  }
});

it("bounds DATA framing regardless of source fragment size", async () => {
  const resource = new Uint8Array(150_000).fill(7);
  const parts: Uint8Array[] = [];
  for await (const part of encodeStream({ html, resources: [{ id: "movie", mime: "video/mp4", data: resource }] }, { chunkSize: 32_768 })) parts.push(part);
  const seen: number[] = [];
  for await (const event of decodeStream(fragments(join(parts), 300_000), { chunkSize: 1_048_576 })) {
    if (event.type === "resource-data") seen.push(event.data.length);
  }
  expect(seen).toEqual([32_768, 32_768, 32_768, 32_768, 18_928]);
});

it("rejects DATA before RSRC and media before markup", async () => {
  const bytes = await encode({ html });
  for (const invalid of [
    join([bytes.subarray(0, 12), chunk("RSRC", new Uint8Array(12)), bytes.subarray(12)]),
    join([bytes.subarray(0, -9), chunk("DATA", new Uint8Array([1])), bytes.subarray(-9)]),
  ]) {
    await expect(decode(invalid)).rejects.toThrow();
    await expect(events(invalid)).rejects.toThrow();
  }
});

it("supports reused upstream buffers with CRC", async () => {
  const bytes = await encode(input, { crc: true });
  const reused = new Uint8Array(19);
  async function* source() {
    for (let offset = 0; offset < bytes.length; offset += reused.length) {
      const part = bytes.subarray(offset, offset + reused.length);
      reused.set(part);
      yield reused.subarray(0, part.length);
    }
  }
  const parts: Uint8Array[] = [];
  for await (const event of decodeStream(source())) {
    if (event.type === "markup") expect(event.html).toBe(html);
    if (event.type === "resource-data") parts.push(event.data);
  }
  expect(join(parts)).toEqual(media);
});

it("rejects every truncated prefix of a valid file", async () => {
  const bytes = await encode(input, { crc: true });
  for (let n = 0; n < bytes.length; n++) {
    await expect(decode(bytes.subarray(0, n))).rejects.toThrow();
    await expect(events(bytes.subarray(0, n))).rejects.toThrow();
  }
});

describe("shared validation", () => {
  it("rejects unsupported versions, duplicates, flags, malformed metadata and resource lengths", async () => {
    const base = await encode({ html });
    const invalid: Uint8Array[] = [];
    const major = base.slice(); major[9] = 1; invalid.push(major);
    const flags = base.slice(); flags[16] = 4; invalid.push(flags);
    const beforeEnd = base.subarray(0, -9), end = base.subarray(-9);
    const mark = base.subarray(12, -9);
    invalid.push(join([beforeEnd, mark, end]));
    invalid.push(join([beforeEnd, chunk("META", new TextEncoder().encode('[]')), end]));
    invalid.push(join([beforeEnd, chunk("RSRC", new Uint8Array([255, 255])), end]));
    invalid.push(join([beforeEnd, chunk("ENDF", new Uint8Array([1]))]));
    invalid.push(join([base.subarray(0, 12), chunk("META", new TextEncoder().encode('{}')), mark, end]));
    const descriptor = new ByteWriter().u16(1).bytes(new TextEncoder().encode("a"))
      .u16(9).bytes(new TextEncoder().encode("image/png")).u32(0).u32(0).finish();
    const resource = join([chunk("RSRC", descriptor), chunk("REND")]);
    invalid.push(join([beforeEnd, resource, resource, end]));
    for (const bytes of invalid) {
      await expect(decode(bytes)).rejects.toThrow();
      await expect(events(bytes)).rejects.toThrow();
    }
  });

  it("bounds expanded text, resources, and resource counts", async () => {
    const bytes = await encode({ ...input, html: "x".repeat(100_000) }, { codec: gzipCodec });
    for (const options of [{ maxTextBytes: 1000 }, { maxResourceBytes: 10 }, { maxResources: 0 }]) {
      await expect(decode(bytes, options)).rejects.toThrow(/exceeds/);
      await expect(events(bytes, options)).rejects.toThrow(/exceeds/);
    }
  });

  it("rejects corrupt compressed text without unhandled promise rejections", async () => {
    const bytes = await encode({ html: "x".repeat(1000) }, { codec: gzipCodec });
    bytes[21] = 0;
    await expect(decode(bytes)).rejects.toThrow();
    await expect(events(bytes)).rejects.toThrow();
  });

  it("does not finish a resource event after CRC failure", async () => {
    const bytes = await encode(input, { crc: true });
    bytes[bytes.length - 14]! ^= 1;
    const seen: string[] = [];
    await expect((async () => {
      for await (const event of decodeStream(fragments(bytes))) seen.push(event.type);
    })()).rejects.toThrow(/CRC/);
    expect(seen).toContain("resource-data");
    expect(seen).not.toContain("resource-end");
  });
});

it("matches the v2 specification's independent minimal fixture", async () => {
  const fixture = new Uint8Array(Buffer.from('89484d4d4c0d0a1a0a0200004d41524b00090000003c623e68693c2f623e454e44460000000000', 'hex'));
  expect(await encode({ html: '<b>hi</b>' })).toEqual(fixture);
  expect((await decode(fixture)).html).toBe('<b>hi</b>');
  expect((await events(fixture))[1]).toEqual({ type: 'markup', html: '<b>hi</b>' });
});

it("preserves all media MIME types and extracts audio/video data URIs", async () => {
  const { extract } = await import('../src/markup');
  const resources = ['image/svg+xml', 'image/gif', 'video/mp4', 'audio/ogg', 'font/woff2', 'application/pdf']
    .map((mime, i) => ({ id: `r${i}`, mime, data: Uint8Array.from([i, 0, 128, 255]) }));
  const bytes = await encode({ html, resources });
  expect([...(await decode(bytes)).resources.values()]).toEqual(resources);
  expect(extract('<audio src="data:audio/ogg;base64,AQID"></audio><video src="data:video/mp4;base64,AQID"></video>').resources.map(r => r.mime))
    .toEqual(['audio/ogg', 'video/mp4']);
});

it("rejects a corrupt DATA chunk before emitting its bytes", async () => {
  const bytes = await encode(input, { crc: true });
  let offset = 12;
  while (String.fromCharCode(...bytes.subarray(offset, offset + 4)) !== 'DATA') {
    offset += 9 + new DataView(bytes.buffer).getUint32(offset + 5, true) + 4;
  }
  bytes[offset + 9]! ^= 1;
  const seen: string[] = [];
  await expect((async () => {
    for await (const event of decodeStream(fragments(bytes))) seen.push(event.type);
  })()).rejects.toThrow(/CRC32/);
  expect(seen).toContain('resource-start');
  expect(seen).not.toContain('resource-data');
});

it("validates declared resource sizes on both paths", async () => {
  const original = await encode(input);
  let offset = 12;
  while (String.fromCharCode(...original.subarray(offset, offset + 4)) !== 'RSRC') {
    offset += 9 + new DataView(original.buffer).getUint32(offset + 5, true);
  }
  const lengthOffset = offset + 9 + new DataView(original.buffer).getUint32(offset + 5, true) - 8;
  for (const length of [media.length - 1, media.length + 1]) {
    const bytes = original.slice();
    new DataView(bytes.buffer).setUint32(lengthOffset, length, true);
    await expect(decode(bytes)).rejects.toThrow(/byteLength/);
    await expect(events(bytes)).rejects.toThrow(/byteLength/);
  }
});

it("rejects invalid UTF-8 and oversized DATA headers before payload allocation", async () => {
  const invalid = await encode({ html: 'hi' });
  invalid[21] = 255;
  await expect(decode(invalid)).rejects.toThrow();
  await expect(events(invalid)).rejects.toThrow();
  const hugeData = await encode({ html, resources: [{ id: 'x', mime: 'image/gif', data: new Uint8Array([1]) }] });
  let offset = 12;
  while (String.fromCharCode(...hugeData.subarray(offset, offset + 4)) !== 'DATA') {
    offset += 9 + new DataView(hugeData.buffer).getUint32(offset + 5, true);
  }
  new DataView(hugeData.buffer).setUint32(offset + 5, 0xffffffff, true);
  await expect(decode(hugeData)).rejects.toThrow(/DATA length/);
  await expect(events(hugeData)).rejects.toThrow(/DATA length/);
});

it("public native codecs reject bad data without unhandled writer rejections", async () => {
  await expect(gzipCodec.inflate(new Uint8Array([1, 2, 3]))).rejects.toThrow();
});
