import { expect, it, vi } from "vitest";
import { encode } from "../src/encode";
import { decode, disposeDecoder } from "../src/decode";
import { createDecoder } from "../src/decoder";
import { decode as decodeDirect } from "../src/decode-direct";
import { decodeStream } from "../src/decode-stream";

it("auto works without Worker, true reports unavailable, and false never loads a worker", async () => {
  const bytes = await encode({ html: '<p>SSR</p>' });
  expect((await decode(bytes)).html).toBe('<p>SSR</p>');
  await expect(decode(bytes, { worker: true })).rejects.toThrow(/unavailable/);
  const factory = vi.fn(() => { throw new Error('must not create'); });
  const decoder = createDecoder({ workerFactory: factory });
  expect((await decoder.decode(bytes, { worker: false })).html).toBe('<p>SSR</p>');
  expect(factory).not.toHaveBeenCalled();
  decoder.dispose();
});

it("direct and auto accept Blob/byte streams and await the blueprint callback", async () => {
  const bytes = await encode({ html: '<p>first</p>', resources: [{ id: 'a', mime: 'image/gif', data: new Uint8Array([1, 2, 3]) }] });
  for (const input of [new Blob([bytes as BlobPart]), new Blob([bytes as BlobPart]).stream()]) {
    let blueprint = false;
    const doc = await decodeDirect(input, { onMarkup: async html => { await Promise.resolve(); expect(html).toBe('<p>first</p>'); blueprint = true; } });
    expect(blueprint).toBe(true);
    expect(doc.resources.get('a')?.data).toEqual(new Uint8Array([1, 2, 3]));
  }
  const types = [];
  for await (const event of decodeStream(bytes, { worker: false })) types.push(event.type);
  expect(types[1]).toBe('markup');
  expect(types[types.length - 1]).toBe('end');
});

it("caches failed worker startup, with explicit true remaining strict", async () => {
  const factory = vi.fn(() => { throw new Error('CSP denies worker'); });
  const decoder = createDecoder({ workerFactory: factory });
  const bytes = await encode({ html: '<p>fallback</p>' });
  expect((await decoder.decode(bytes)).html).toContain('fallback');
  expect((await decoder.decode(bytes)).html).toContain('fallback');
  await expect(decoder.decode(bytes, { worker: true })).rejects.toThrow(/CSP/);
  expect(factory).toHaveBeenCalledTimes(1);
  decoder.dispose();
});

it("disposal cancels direct streaming and rejects later calls", async () => {
  const decoder = createDecoder({ worker: false });
  const source = new ReadableStream<Uint8Array>();
  const next = decoder.decodeStream(source).next();
  // Allow the reader to take ownership before disposing.
  await new Promise(resolve => setTimeout(resolve, 10));
  decoder.dispose();
  await expect(next).rejects.toThrow(/disposed/);
  expect(source.locked).toBe(false);
  await expect(decoder.decode(new Uint8Array())).rejects.toThrow(/disposed/);
});

it("resets the module-shared decoder after disposal", async () => {
  const bytes = await encode({ html: 'one' });
  await decode(bytes);
  disposeDecoder();
  expect((await decode(bytes)).html).toBe('one');
});

it("does not replay a throwing markup callback", async () => {
  const bytes = await encode({ html: 'blueprint' });
  const callback = vi.fn(() => { throw new Error('renderer failure'); });
  await expect(decode(bytes, { worker: false, onMarkup: callback })).rejects.toThrow('renderer failure');
  expect(callback).toHaveBeenCalledTimes(1);
});
