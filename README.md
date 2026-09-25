<div align="center">

# HMML

### HyperMedia Markup Language

**One binary document: the HTML blueprint first, then any media, streamed in bounded chunks.**

`HTML / CSS / SVG blueprint → images · GIFs · video · audio · fonts · other assets`

Zero runtime dependencies. Native optional compression. On-demand workers.

[Website](https://hmml.eddocu.com) · [Specification](./SPEC.md) · [Streaming guide](./docs/streaming.md) · [Worker instances](./docs/workers.md) · [Rendering](./docs/rendering.md) · [Measurements](./docs/performance.md) · [Playground](./playground)

</div>

## Design

HMML v2 makes the blueprint available before reading any media. Media stays as raw
bytes, without base64, and can exceed 4 GiB or arrive with an unknown total length.
A pull-based API propagates backpressure instead of collecting the whole document.

```
Header (version 2.0)
MARK  HTML/CSS/SVG blueprint — always first
META  optional JSON
RSRC  id + MIME + optional total length
DATA  ≤1 MiB raw bytes, normally 64 KiB
DATA  …
REND  resource complete
RSRC  next asset …
ENDF  document complete
```

Assets can contain SVG, GIF, PNG, WebP, video, audio, fonts, or any MIME-typed binary
content. The container preserves bytes; browser support for decoding/playing them
is a separate matter. Resource URLs in the blueprint use `hmml:<id>`.

**Breaking revision:** this checkout targets package `0.2.0` and format **2.0**.
Version 1 files are rejected. There is no backward-compatibility implementation.
Build this checkout to use the revision before it is published to npm.

## Streaming first

In a browser app (automatically uses one shared worker when available):

```ts
import { decodeStream } from '@eddocu/hmml/decode-stream';

for await (const event of decodeStream(url, { signal })) {
  // First content event: { type: 'markup', html }.
  // Then metadata and resource-start / resource-data / resource-end events.
  // Await your renderer/sink here to preserve backpressure.
  await consume(event);
}
```

No `arrayBuffer()` call, no full-resource allocation, and no encoder or DOM renderer
is required. Fetch and parsing run inside the reusable worker; event pulls preserve
backpressure. Use `{ worker: false }` to decode directly or `{ worker: true }` to
require a worker. Direct-only imports exclude worker code even without tree shaking.

See the [streaming and worker guide](./docs/streaming.md) for complete read/write
examples, cancellation, quotas and media playback considerations. A runnable demo
at `examples/stream/` shows the blueprint before delayed, HTTP-gzipped media arrives.

Writing accepts in-memory bytes, async resource iterables, or streams:

```ts
import { encodeStream } from '@eddocu/hmml/encode-stream';

for await (const bytes of encodeStream({
  html: '<h1>Scene</h1><video src="hmml:movie" controls></video>',
  resources: [{ id: 'movie', mime: 'video/mp4', data: videoFile.stream() }],
}, { crc: true })) {
  await destination.write(bytes);
}
```

Use a bounded WritableStream/file/network sink for `destination`. A `byteLength` is
optional for stream resources. The encoder coalesces fragments into 64 KiB chunks
by default; it never needs to discover the asset's full length first.

## One decoder instance, many editor attachments

```ts
import { createDecoder } from '@eddocu/hmml/decoder';
import { createFrame } from '@eddocu/hmml/frame';

const decoder = createDecoder({ worker: 'auto', maxConcurrent: 4 }); // per editor
const frame = createFrame(attachmentSlot, { width: '100%', height: 'auto' });
for await (const event of decoder.decodeStream(fileOrUrl, { signal })) {
  await frame.write(event, { transfer: true });
}
// Other attachments reuse decoder; each visible attachment gets its own frame.
// On removal: abort its signal and frame.dispose(). On editor close: decoder.dispose().
```

The iframe shows the blueprint first, isolates HTML/CSS, and creates its own Blob
URLs as assets finish. Document scripts are disabled. The editor controls placement;
frame width/height define the document's viewport. The renderer retains media, with a
128 MiB default quota; huge videos need an incremental media sink. See the
[rendering guide](./docs/rendering.md) for sizing, isolation and optional rasterization,
and the runnable `examples/editor/` demo.

Normal `decode()` calls also share a default worker instance. `decode(input, {
worker: false })` opts out per call. Workers primarily improve responsiveness;
small decodes can finish faster directly. A fresh worker per attachment is
unnecessary overhead. [Worker lifecycle, copies, bundling and measurements](./docs/workers.md).

## Small in-memory documents

Convenience APIs remain available for documents you want to hold fully in memory:

```ts
import { pack, unpack } from '@eddocu/hmml';

const bytes = await pack(htmlWithDataUris, { meta: { title: 'Card' } });
const doc = await unpack(bytes);
const { html, revoke } = doc.createObjectUrls();
// Render html through your application's trust boundary; revoke() on teardown.
```

`pack` extracts image/font/audio/video data URIs and deduplicates identical URIs.
It defaults to store mode; opt into a codec for compressed markup/metadata. Chunks
stay raw if compression would increase size. `encode` accepts explicit `{ html, resources, meta }` and defaults to store mode.
`toHTML()` produces base64 for export; avoid it for large media.

## Compression and storage

HTTP compression belongs to the CDN. Browser fetch removes HTTP gzip before HMML
sees `response.body`, so do not decompress that layer again. File compression is
optional and separate: it reduces stored markup as well as uncompressed downloads.
Use store mode for the simplest CDN-delivery path; consider internal text gzip when
origin/offline storage matters. The decoder loads its native inflater only when a
compressed text chunk appears. No third-party compression library is needed.

Raw binary avoids base64's expansion, but HTTP gzip recovers much of that expansion.
On the repo's real media fixture, HMML store used **1,262,516 bytes** versus
**1,854,146 bytes** for base64 HTML; after HTTP gzip these became **1,135,284** and
**1,219,367 bytes**. Internal text gzip reduced stored HMML to **1,149,867 bytes**,
but changed the HTTP-gzipped size only to **1,134,631 bytes**. Results depend on content.

The format adds about **0.014%** framing per 64 KiB DATA chunk (0.020% with CRC), plus
small descriptors. Gzip flush/buffering at the CDN affects when the blueprint is
actually delivered; validate that through your configured CDN.

## Size and performance

Run `npm run size`, `npm run bench`, `npm run bench:stream`,
`npm run bench:compression`, and `npm run bench:workers`. [Measured results and limits](./docs/performance.md)
separate bundle size, stored size, wire size and streaming memory. Streaming and
strict validation add code versus the previous buffer-only implementation. Narrow
imports keep unused capabilities out of applications:

| Import | Purpose |
| --- | --- |
| `@eddocu/hmml/decode-stream` | Automatic shared-worker incremental reader |
| `@eddocu/hmml/decoder` | Explicit reusable instance and lifecycle |
| `@eddocu/hmml/decode/direct` | Complete reader with no worker dependency |
| `@eddocu/hmml/decode-stream/direct` | Incremental reader with no worker dependency |
| `@eddocu/hmml/encode-stream` | Streaming writer, store by default |
| `@eddocu/hmml/worker` | Explicit worker adapter; no worker starts on import |
| `@eddocu/hmml/decode` | Complete in-memory document and resolvers |
| `@eddocu/hmml/pack` | In-memory HTML extraction and packing |
| `@eddocu/hmml/encode` | Complete in-memory file |
| `@eddocu/hmml/codecs` | Optional native codecs |
| `@eddocu/hmml/markup` | Extraction and URL resolution |
| `@eddocu/hmml/frame` | Progressive isolated iframe, sizing and Blob media |
| `@eddocu/hmml/mount` | Completed-document Shadow DOM / sandbox renderer |

ESM preserves lazy imports. Bundlers should retain code splitting. CJS and classic
IIFE builds are self-contained; they cannot promise deferred network loading and
need a custom worker factory for worker mode.
The broad root entry remains convenient for tools, but browser apps should choose
only the entry points they need. Streaming-only imports exclude complete-document
collection and HTML/Blob URL helpers, even without tree shaking. Both decoding
entries still share one worker. In the measured ESM split build, `/decode-stream`
starts at **1.11 KiB gzip**; its flat main-realm bundle is **5.28 KiB gzip**, with
worker assets additional. Root re-exports can retain extra shared chunks depending
on the bundler. `npm run test:package` verifies the built exports and optional-code
boundaries; [measurements](./docs/performance.md) explain initial versus total size.

## Rendering and trust

HMML can contain arbitrary HTML/CSS/JS; parser validation does not sanitize it.
The separate `@eddocu/hmml/frame` entry is the progressive editor-preview path:
opaque-origin iframe, document scripts disabled, Blob/data resources, bounded auto
height, and disposal. Neither decoding entry imports a renderer or screenshot library.

For completed small documents, `@eddocu/hmml/mount` also offers sanitized Shadow DOM
(`static`), script-capable sandbox (`sandbox`), and a remote loader (`isolated`).
Static mode needs the browser Sanitizer or your supplied sanitizer; otherwise it
falls back to a script-capable sandbox. Shadow DOM isolates styles, not privileges
or network access. Script-capable frames can still consume CPU/memory and navigate
their own frame; a CSP restricting fetch is not a general no-network guarantee.
An iframe does not guarantee a separate OS process. See [rendering](./docs/rendering.md)
for the actual boundaries and lifecycle. Use `createFrame` for script-disabled previews.

### Format-level concerns

- **Integrity ≠ authenticity.** The optional CRC32 catches corruption, not tampering; there is no
  signature yet, so don't infer provenance from a `.hmml`. Signatures would require a separately designed format extension.
- **Resources are stored verbatim.** Raster bytes behind an `<img>` are inert, but an SVG pulled
  inline, or `<object>`/`<use>` to external refs, can carry script - which is exactly why you render
  through a trust tier instead of dropping markup into your live DOM.
- **`toHTML()` / `createObjectUrls()` are *resolvers*, not sanitisers.** They re-stitch the document;
  they don't make it safe. Pair them with `mount` (or your own sandboxed iframe) for anything you
  didn't author yourself.

## API notes

`HmmlDocument` contains `{ version, html, resources: Map, meta, codecId, toHTML(),
createObjectUrls() }`. The core also exports byte/base64/MIME utilities and CRC32.

Streaming options include `maxTextBytes`, `maxResourceBytes`, `maxResources`,
`chunkSize`, and an AbortSignal. Encoders support `chunkSize`, optional `codec`,
`compressMarkup`, `compressMeta`, and `crc`. Text defaults to a 16 MiB stored/expanded
limit. DATA payloads are always capped at 1 MiB by the format. Resource sizes are
not capped at 4 GiB. Mandatory end markers, declared-size checks, strict ordering,
UTF-8 validation and optional per-chunk CRC detect incomplete/corrupt input.

For a custom text codec, supply `{ id, deflate, inflate }` with an ID in 16..255 to
both encoder and decoder. Custom inflaters must enforce their own allocation limits.

## Development

```sh
npm install
npm run build             # ESM/CJS/IIFE and types
npm run typecheck
npm run test:package       # built-package tree shaking and lazy-loading checks
npm test                  # format, fragmentation, cancellation, transfer and limits
npm run pg:build           # regenerate playground documents in v2
npm run test:browser       # Chromium rendering and worker streaming
npm run bench
npm run bench:stream
npm run bench:compression
npm run size
```

## Current limits

Resources are sequential; order them by display priority. There is no interleaving,
random-access index or seek protocol in v2.0. Video/audio can be delivered
incrementally, but early playback needs a compatible media layout and browser
pipeline, such as MediaSource. Blob rendering requires completed assets. These
tradeoffs and follow-on options are covered in the [streaming guide](./docs/streaming.md).

## License

MIT © Argun
