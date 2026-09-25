# Reusable decoders in an attachment editor

Ordinary `decode()` and `decodeStream()` lazily share one worker in a browser
window. Nothing starts on import. For explicit ownership, create one decoder when
the editor opens and dispose it when the editor closes:

```ts
import { createDecoder } from '@eddocu/hmml/decoder';

const decoder = createDecoder({ worker: 'auto', maxConcurrent: 4 });
const documents = await Promise.all(files.map(file => decoder.decode(file)));
// Later, opening another attachment uses that same worker:
const another = await decoder.decode(anotherFile);
// When the editor closes:
decoder.dispose();
```

This is one reusable **dedicated Worker**, not a SharedWorker across tabs. It has
one JavaScript thread. `maxConcurrent` bounds active requests, including overlapping
fetches, rather than creating that many workers/CPU threads. Additional requests
queue FIFO. A streaming request keeps its slot until it finishes, is cancelled, or
the consumer breaks its loop. Always consume, break, or abort a stream you start.
When all slots are occupied, blueprint delivery for queued documents also waits;
virtualize attachments and prioritize visible ones. Use separate instances only
when measured CPU contention justifies extra threads and memory.

Instances reuse the worker, not decoded results. Cache documents/thumbnails by
document ID and version in the editor when repeated opens justify it. Release
documents and frames when attachments leave view; one worker does not make hundreds
of live HTML documents inexpensive.

## Execution controls

| Option | Behavior |
| --- | --- |
| `worker: 'auto'` (default) | Use a worker when available; fall back on startup failure |
| `worker: true` | Require a worker; reject if unavailable |
| `worker: false` | Decode directly in the caller's realm |

Set it on the instance or override it per call. Node/server and existing worker
realms use direct decoding by default. Custom codec objects and async iterables
also use the direct path in auto mode; explicit `true` rejects these inputs.
Put custom codecs/iterables inside an application-owned worker when necessary.

Startup includes a readiness handshake, with `startupTimeoutMs: 5000` by default.
Auto mode caches a startup failure for that instance so a blocked worker is not
recreated for every attachment. Dispose/create another instance to retry startup.
Parsing, transfer, fetch, callback, and runtime errors are propagated; they are not
silently replayed on the main thread. A worker crash fails current requests; later
requests may create a new worker. Do not externally terminate a managed worker:
use `decoder.dispose()`, which also rejects queued and active operations.

`decode()` and `decodeStream()` from the normal entry points share a module-level
instance. `disposeDecoder()` disposes/resets it. Multiple installed/bundled copies
of the package have separate instances; explicit ownership avoids that ambiguity.

## Inputs, ownership, and early blueprints

```ts
const controller = new AbortController();
const doc = await decoder.decode(fileOrUrl, {
  signal: controller.signal,
  onMarkup: async html => {
    // Runs in the caller, immediately after the blueprint is validated.
    await showBlueprint(html);
  },
});
```

`showBlueprint` is your rendering function. The callback is awaited before assets
are consumed. `decode()` still collects all resources before returning the complete
document; use `decodeStream()` for large files and incremental sinks.

- **URL/string:** fetched inside the worker. Relative URLs resolve against the
  caller's document base URL. Default fetch credentials apply. For custom headers,
  fetch yourself and pass `response.body`, or own the worker/fetch implementation.
- **Blob/File:** structured cloned to the worker without first reading the whole
  file into a main-thread ArrayBuffer. Prefer this for file inputs.
- **Uint8Array:** preserved by default, so a copy is transferred to the worker.
  `{ transfer: true }` transfers the entire owned ArrayBuffer and detaches it.
  Subarrays/shared buffers are rejected for explicit transfer. Do not mutate inputs
  while a queued/running decode owns them.
- **ReadableStream:** transferred; it is consumed and unavailable for reuse. Browser
  transferable-stream support is required for the worker path. Transfer errors are
  not retried. Use a URL/Blob or `worker: false` on unsupported runtimes.
- **AsyncIterable:** direct mode, or run the producer inside your own worker.

Document mode transfers completed resource buffers once, with one early-markup
notification. Stream mode requests one event at a time and transfers owned data
buffers, preserving consumer backpressure and independent per-request cancellation.
An AbortSignal belongs to one call; disposing the instance cancels all its calls.

## Bundling and CSP

The native ESM build uses the standard literal worker URL pattern. Keep the
distributed `decode-worker.js` and its imported chunks alongside the modules when
serving the package directly. Vite/Webpack recognize this pattern, but production
asset paths and CSP remain application configuration. Supply a factory when your
build system needs explicit ownership:

```ts
// hmml.worker.ts
import '@eddocu/hmml/worker-entry';

// editor.ts
import { createDecoder } from '@eddocu/hmml/decoder';
const decoder = createDecoder({
  worker: true,
  workerFactory: () => new Worker(new URL('./hmml.worker.ts', import.meta.url), {
    type: 'module',
  }),
});
```

The factory must return a new worker owned by this decoder. It is called lazily,
normally once for the instance lifetime. CJS/classic IIFE builds cannot derive an
ESM worker URL; configure a factory, or use direct mode. Permit the worker asset
under your application's `worker-src` CSP. Auto fallback can perform substantial
work on the UI thread; use strict `true` if responsiveness requires failing instead.

Use narrow direct-only imports when you never want worker support in the bundle:

```ts
import { decode } from '@eddocu/hmml/decode/direct';
import { decodeStream } from '@eddocu/hmml/decode-stream/direct';
```

Their dependency graphs contain no worker machinery, even with tree shaking
disabled. Normal auto entries lazily import worker management or the direct reader.
`@eddocu/hmml/decode-stream` also excludes complete-document collection and HTML/Blob
URL helpers, even without tree shaking. The two normal entry points still share one
runtime and worker; they do not need to import each other's implementation.
`createDecoder` lives in `/decoder` (or the root) and intentionally exposes both
methods. Rendering/encoding are separate entries and are never imported by these decoders.
ESM code splitting preserves deferred network loading; bundling everything into a
single CJS/IIFE file does not. File decompression remains conditional on compressed
MARK/META chunks, independently of HTTP gzip handled by fetch.

For predictable small bundles, use the narrow entry instead of relying entirely on
root re-export elimination. In the current esbuild split-build measurement, the
streaming client starts at 1.11 KiB gzip through `/decode-stream`, versus 3.11 KiB via
the root. Total reachable main-realm streaming code is about 5.28 KiB gzip as a flat
bundle; worker assets are additional. Run `npm run size` and `npm run test:package`
against the built package. [Bundle measurements and caveats](./performance.md).

## Performance expectations

A worker adds startup, messages, and sometimes copies. Tiny decodes can be faster
directly. Local Chromium measurements found a median **158.5 ms** for a fresh worker
per 8 KiB decode, **0.7 ms** with a reused warm worker, and **0.1 ms** directly. For
eight 8 MiB CRC decodes, the shared worker reduced the largest timer gap from
**970.3 ms to 78.9 ms**, while total completion time increased from **950.5 ms to
1,051.2 ms**. These are VM measurements, not universal thresholds; run
`npm run bench:workers` under your editor's workload. Input copies, DOM work, and
message handling can still occupy the main thread.

See [rendering](./rendering.md) for progressive iframe integration and
[streaming](./streaming.md) for media sinks. Relevant platform guidance:
[HTML Workers](https://html.spec.whatwg.org/multipage/workers.html),
[Vite worker imports](https://vite.dev/guide/features#web-workers), and
[Webpack worker imports](https://webpack.js.org/guides/web-workers/).
