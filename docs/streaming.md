# Streaming HMML v2 in web apps

HMML v2 requires the HTML blueprint first and splits arbitrary assets into bounded
DATA chunks. SVG, GIF, videos, audio, fonts and other resources use the same framing.
Old v1 files are rejected. No legacy implementation is loaded.

## Automatic shared worker

For normal app code, use `decodeStream(urlOrFile, { worker: 'auto', signal })` from
`@eddocu/hmml/decode-stream`, or keep one `createDecoder()` instance per editor.
All calls through an instance share one lazy worker and a bounded request queue.
`worker: false` opts out; `worker: true` requires worker availability.
See [worker instances](./workers.md) for lifecycle and [rendering](./rendering.md)
for a progressive sandboxed iframe and a working attachment-editor example.

## Application-owned worker (advanced)

Create `hmml.worker.ts` in your app:

```ts
import { serveDecodeWorker } from '@eddocu/hmml/worker';
serveDecodeWorker(self);
```

In the app, load the adapter and start the worker when opening an HMML document:

```ts
const { decodeInWorker } = await import('@eddocu/hmml/worker');
const worker = new Worker(new URL('./hmml.worker.ts', import.meta.url), { type: 'module' });
const controller = new AbortController();

try {
  for await (const event of decodeInWorker(worker, documentUrl, {
    signal: controller.signal,
    maxTextBytes: 8 * 1024 * 1024,
    maxResources: 10_000,
  })) {
    switch (event.type) {
      case 'markup':
        // Show the blueprint now using your application's rendering/trust boundary.
        // Bind hmml: references to placeholders; do not wait for media.
        await showBlueprint(event.html);
        break;
      case 'resource-start':
        // byteLength can be undefined. The MIME identifies the original bytes.
        await openAssetSink(event.id, event.mime, event.byteLength);
        break;
      case 'resource-data':
        // Await consumption: this provides backpressure all the way to worker fetch.
        await writeAssetBytes(event.id, event.data);
        break;
      case 'resource-end':
        await finishAsset(event.id);
        break;
    }
  }
} finally {
  // Reuse the worker across documents, or terminate it when finished.
  worker.terminate();
}
```

The application-specific functions above are sinks/renderers, not library exports.
Cancel a pending read with `controller.abort()` **before** terminating a worker.
A worker terminated externally does not reliably emit an error event for pending
requests. Breaking the loop cancels that request. Multiple requests can share one
worker, using separate MessagePorts. The worker starts fetch only on the first pull.
The decoder is dynamically imported in the worker and native decompression is
imported only for a compressed MARK/META chunk. No encoder or DOM renderer is needed.

The worker adapter fetches ordinary URLs with default fetch credentials behavior.
If custom headers, credentials or other fetching logic are needed, use decodeStream
inside an application-owned worker and supply your own fetch body.

There is a runnable example at `examples/stream/index.html`:

```sh
npm run build
node e2e/server.mjs
# Open http://127.0.0.1:5188/examples/stream/
```

The fixture delays the media and serves HTTP gzip. It demonstrates the blueprint
appearing before the image, cancellation, worker reuse and Blob URL cleanup. Its
simple renderer handles images from that trusted fixture; it is not a generic
sanitizer or progressive video player. `examples/stream/encode-worker.js` shows a
separate, lazily imported encoder for saves.

## Read directly inside your own worker or server

```ts
import { decodeStream } from '@eddocu/hmml/decode-stream/direct';
const response = await fetch(url, { signal });
if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
for await (const event of decodeStream(response.body, { signal })) {
  await consume(event);
}
```

This never calls `response.arrayBuffer()` and never collects all assets. Each data
buffer is tightly allocated and safe to transfer with
`postMessage(event, [event.data.buffer])`. `resource-end` means the declared length,
if present, was satisfied. `end` means the complete HMML document was received.

Use `decode()` only when you deliberately want a complete in-memory document with
`toHTML()`/`createObjectUrls()`. Those helpers are unsuitable for huge videos: base64
expands data, and Blob URLs retain the underlying media. Keep the existing rendering
trust boundary when handling arbitrary HTML. Parser validation is not sanitization.

## Write without buffering media

```ts
import { encodeStream } from '@eddocu/hmml/encode-stream';

const chunks = encodeStream({
  html: '<main><h1>Scene</h1><video src="hmml:movie" controls></video></main>',
  resources: [{
    id: 'movie',
    mime: 'video/mp4',
    data: videoFile.stream(),
    byteLength: videoFile.size, // optional for an unknown-length stream
  }],
}, { crc: true });

const writer = destination.getWriter();
try {
  for await (const bytes of chunks) await writer.write(bytes);
  await writer.close();
} catch (error) {
  await writer.abort(error);
  throw error;
} finally {
  writer.releaseLock();
}
```

`destination` is your WritableStream, such as a file or upload sink. Resources may
also be an async iterable, loaded one at a time. No length prepass is needed. Tiny
source fragments are coalesced into 64 KiB DATA payloads by default; tune `chunkSize`
within 1..1 MiB if latency/storage framing tradeoffs require it. Smaller chunks add
more headers. Source buffers and yielded encoder views must not be mutated while
in use. An early error leaves a partial file; publish/commit the destination only
when writing succeeds.

The blueprint and optional metadata must fit their text limits. The streaming
encoder does not fetch or extract remote assets: supply their bytes/streams. `pack`
can extract inlined image/font/audio/video data URIs for smaller documents.

## Compression policy

Use `encodeStream(input)` / `encode(input)` for store mode behind a gzipping CDN.
That loads no file compressor. Browser fetch handles HTTP gzip; do not decompress
`response.body` again based on its Content-Encoding header.

For compact stored objects/downloads, opt into native text compression:

```ts
const { gzipCodec } = await import('@eddocu/hmml/codecs');
const chunks = encodeStream(input, { codec: gzipCodec });
```

`pack` also defaults to store mode; pass a codec explicitly for compact stored text. A chunk stays raw when compression would expand
it. Assets are byte-preserved. File compression and CDN compression can coexist,
but their benefits must be measured separately. The CDN does not shrink an
uncompressed origin object. Native gzip framing can be larger than raw DEFLATE for
tiny text; the size check avoids expansion either way.

Native ESM exports preserve the deferred import. Bundlers should retain code
splitting for it. CJS and classic IIFE builds are self-contained and cannot promise
a separate network fetch for decompression. All modes use platform compression;
no third-party compressor is a runtime dependency.

## Limits and follow-on work

- Large assets: write data to a file, cache-backed sink or suitable media pipeline.
  Collecting events into arrays moves whole-file buffering into your application.
- Playback: MP4/MP3/etc. bytes are preserved, but early playback depends on the media
  layout and browser codec support. Container streaming alone is insufficient.
- Priority: blueprint first is guaranteed; put critical images/fonts before large
  videos. Resources are sequential, so one large video can block later assets.
- Seeking: add independently addressable media or a deliberately designed index
  and identity/segmented representation. Gzipped transport offsets are not logical
  HMML offsets. v2.0 does not provide range seeking or interleaved assets.
- Deduplication: `extract` deduplicates identical data URIs. Structured resources
  with different IDs are not hashed automatically. Offline/worker content hashing
  is a useful next optimization if real documents repeat large assets.

References: [Fetch content coding](https://fetch.spec.whatwg.org/#http-network-fetch),
[Compression Streams](https://compression.spec.whatwg.org/),
[Streams backpressure](https://streams.spec.whatwg.org/),
[Media Source Extensions](https://w3c.github.io/media-source/).
