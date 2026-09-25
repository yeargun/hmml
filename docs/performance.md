# HMML v2 measurements and design tradeoffs

Measured on the development VM on 2026-09-23, Node v20.19.0. These are local
microbenchmarks, not production CDN latency or media playback benchmarks. Timing
varies with CPU load and garbage collection. Sources and commands are in `bench/`.

## Large-file streaming

```
HMML_BENCH_BYTES=4296015872 node bench/stream.mjs
```

A generated resource of **4,296,015,872 bytes** (4 GiB + 1 MiB) streamed through the
encoder and decoder without creating a full resource/file buffer:

| Measurement | Result |
| --- | ---: |
| Bytes pulled when blueprint was delivered | **71 B** |
| Time to blueprint | 2.210 ms |
| Total local stream time | 2,190.04 ms |
| Largest resource-data event | 65,536 B |
| Peak process RSS, including Node runtime | **80.3 MiB** |

The source reuses a 64 KiB buffer; the consumer discards each event after counting
it. The source, file and event sizes differ: DATA headers add small framing overhead.
This verifies the >4 GiB length path and bounded processing; it does not benchmark
an actual disk/network, media transcoding, or an application collecting all assets.
CRC was disabled for this throughput run; CRC correctness is covered by tests.

The Chromium test server separately sends HTTP gzip, flushes the blueprint, and
delays media 700 ms. Tests verify visible blueprint content before the image arrives,
worker cancellation/reuse, concurrent requests, native file inflater loading only
when needed, and encoding inside a worker. An actual CDN may buffer differently.

## Stored size versus transfer size

`node bench/compression.mjs` uses the checked-in food page, its CSS, and referenced
real images/SVGs. The extracted blueprint is 121,319 bytes; assets total 1,140,107
bytes. The comparison is the same content in each representation. External URLs
that the source fixture already contains are unchanged in all representations.

| Representation | Stored bytes | HTTP gzip bytes | HTTP Brotli bytes |
| --- | ---: | ---: | ---: |
| Base64 HTML | 1,854,146 | 1,219,367 | 1,128,502 |
| HMML store | 1,262,516 | 1,135,284 | 1,120,737 |
| HMML internal text gzip | 1,149,867 | 1,134,631 | 1,122,657 |

HTTP gzip is modeled with Node zlib level 6; Brotli uses Node's defaults. Actual CDN
settings can differ. Numbers describe encoded bodies, excluding HTTP/TLS framing.

For this fixture:

- Raw HMML store is **31.9% smaller** than base64 HTML. After HTTP gzip the advantage
  is **6.9%**. Do not advertise raw base64 savings as identical network savings.
- Internal text gzip reduces HMML storage by **8.9%**, but saves only **653 bytes**
  (0.058%) after HTTP gzip. It slightly increases HTTP Brotli size here.
- Therefore, CDN-delivered store mode is a reasonable default for the low-level
  writer. Internal text gzip remains useful when origin/offline size matters.
- Binary media dominates the result. Improving image/video/audio encoding or
  eliminating duplicate assets will usually outweigh container framing changes.

Other fixtures show different behavior. A 12-byte HTML fragment becomes a 42-byte
HMML document; gzip would expand the text, so the writer stores it. A repetitive
35,000-byte blueprint becomes a 249-byte HMML file with internal text gzip. Some
highly repetitive inputs can compress further with a second gzip pass; this does
not make double compression a general recommendation.

CDN compression belongs outside HMML. Fetch handles HTTP Content-Encoding before
exposing the body. The HMML file inflater handles only explicitly compressed
MARK/META chunks. See [Fetch](https://fetch.spec.whatwg.org/#http-network-fetch) and
the [Compression Streams standard](https://compression.spec.whatwg.org/).

## Bundle size

`npm run size` now builds and measures the **distributed package exports**, not
only the TypeScript sources. Measurements below are from 2026-09-24 with esbuild
0.27.7. Gzip uses level 9; Brotli uses Node defaults. The benchmark reports two
separate delivery shapes:

- **Flat:** all dynamically reachable JavaScript for this import combined into one
  minified bundle. This measures total main-realm code, including fallback paths.
- **Initial:** sum of individually gzipped files reachable through static imports
  when ESM code splitting is enabled. Deferred parser/worker-manager/inflater modules
  are excluded until requested. Headers and later requests cost additional bytes.

Worker URL assets are outside the consumer import graph; the worker implementation
row measures that entry separately. Do not quote the client initial size as the
whole decoder's transfer cost. Sizes and chunk placement vary with the app/bundler.

| Import shape | Flat minified KiB | Flat gzip KiB | Flat Brotli KiB | Initial gzip KiB |
| --- | ---: | ---: | ---: | ---: |
| decode/direct | 11.30 | 4.40 | 3.97 | 3.16 |
| decode-stream/direct | 8.13 | 3.21 | 2.90 | 2.89 |
| decoder instance | 18.63 | 6.56 | 5.94 | 1.25 |
| worker implementation (separate asset) | 11.48 | 4.37 | 3.96 | 0.80 |
| decode (automatic worker, narrow entry) | 18.37 | 6.52 | 5.89 | 1.18 |
| decodeStream (automatic worker, narrow entry) | 14.94 | 5.28 | 4.79 | 1.11 |
| decodeStream (root named export) | 14.94 | 5.27 | 4.79 | 3.11 |
| encodeStream (root named export) | 4.36 | 1.87 | 1.72 | 3.38 |
| encode + extract (root named exports) | 5.75 | 2.57 | 2.36 | 4.06 |
| low-level worker client | 1.60 | 0.83 | 0.74 | 0.83 |
| progressive iframe (separate import) | 8.99 | 3.52 | 3.06 | 3.52 |
| pack + unpack (root named exports) | 22.74 | 8.06 | 7.30 | 5.05 |
| all root exports (excludes renderer) | 25.53 | 9.06 | 8.21 | 6.19 |

Streaming-only imports no longer reference the complete-document reader, resource
collector, base64 or Blob URL resolvers. `decode` and `decodeStream` still share one
runtime/worker. Creating an explicit decoder instance exposes both methods, so its
reachable graph intentionally includes both operations. Worker management and
parsers remain deferred. The base64 lookup table is now allocated only when base64
**decoding** is used. Pure construction annotations survive package minification.

The package is tree-shakeable, but import shape still matters. With esbuild's ESM
splitting, the root re-export module can retain shared chunks associated with unused
dynamic imports. Here the root streaming import starts at 3.11 KiB gzip versus
1.11 KiB through `/decode-stream`. Some rows have a larger initial split total than
their entire flat gzip: separate gzip dictionaries and extra retained shared chunks
can outweigh the benefit of splitting. Prefer narrow imports for browser apps.

`npm run test:package` checks the actual built exports: unused imports disappear,
root named exports shake in a flat bundle, narrow streaming excludes document/DOM
helpers even without consumer tree shaking, direct entries exclude workers, and
code-split narrow entries defer parsing and worker management. It also checks that
the side-effectful worker entry survives a bare import. Source-level tests alone
would miss distribution/minifier regressions.

The previous v1 buffer-only reader measured 2.04 KiB gzip on this VM. Strict v2
framing, validation, size checks and streaming support cost code. The package as a
whole did not become smaller; its optional capabilities are separated by import.
The complete-document reader also supports URL/Blob/stream inputs, so its reachable
graph includes a streaming collector. ESM loading tests verify that an HTTP-gzipped,
internally stored file does not load the HMML inflater.

## In-memory throughput

`node bench/perf.mjs`: one generated 492 KiB PNG and approximately 2.3 KiB markup.
Warm-up precedes the measurements. CRC is disabled. These numbers cover container
operations only, not image decoding, layout, rendering, or worker messaging.

| Operation | Before (v1) ms/op | v2 ms/op | v2 throughput |
| --- | ---: | ---: | ---: |
| encode, text gzip | 1.741 | 1.791 | 283 MB/s |
| decode, text gzip | 0.962 | 0.960 | 528 MB/s |
| encode, store | 0.513 | 0.259 | 1,952 MB/s |
| decode, store | 0.071 | 0.171 | 2,953 MB/s |

The baseline was measured before edits in the same session. V2 avoids repeated
whole-file copies on encode. Its in-memory reader does more work for strict framing
and segmented resources; this sample became slower in store-mode decode. Streaming
mainly improves latency to blueprint, peak memory and responsiveness for large
files. Workers move CPU work off the UI thread; they do not guarantee a faster
small-file completion time.

## Worker startup, reuse, and responsiveness

`npm run bench:workers` runs in headless Chromium 143 on this VM. It compares a
persistent instance to one fresh instance per call. CRC is off for the small-input
latency rows. Uint8Array inputs are preserved, so worker runs include input copying
and response transfer. Thirty calls per row, except ten fresh-worker calls:

| Input/path | Median ms | p95 ms |
| --- | ---: | ---: |
| 8 KiB, direct | 0.1 | 1.0 |
| 8 KiB, warm shared worker | 0.7 | 8.4 |
| 8 KiB, fresh worker each time | 158.5 | 198.4 |
| 1 MiB, direct | 0.8 | 8.6 |
| 1 MiB, warm shared worker | 9.3 | 11.0 |

Cold startup of the shared instance took 191.2 ms in this run. A batch of 100 small
attachments completed in 147.4 ms with **zero additional workers**. Browser cache,
host load, bundling and hardware strongly affect these startup timings.

Eight concurrent 8 MiB inputs with CRC exercise CPU work. Direct calls took
950.5 ms total with a largest 5 ms timer gap of 970.3 ms; the shared worker took
1,051.2 ms total with a largest gap of 78.9 ms. The timer measurement spans the work
and a short final sample; timer gaps are not individual frame-duration measurements.
The worker improved responsiveness while making completion slightly slower. It did
not eliminate main-thread messages, copies, or allocation. Measurements are from a
separate run from the earlier Node table and are not directly comparable to it.

Ordinary decode calls now share a lazy worker by default in browser windows.
`createDecoder()` gives the editor explicit ownership; `worker: false` and direct
imports permit an opt-out for tiny/trusted workloads. See [workers](./workers.md).

## Further improvements worth measuring

1. **Asset priority and media layouts.** Put critical fonts/images before videos;
   use media layouts suitable for incremental playback. Test the actual CDN's time
   to the markup event, since HMML framing cannot force a gzip flush.
2. **Deduplicate before storing.** Identical data URIs already deduplicate. Add
   worker/offline content hashing for repeated structured assets if real files
   justify its CPU cost. Reuse one resource ID for repeated references now.
3. **Seeking and parallel asset delivery.** For long videos or many large assets,
   separately addressable media may be preferable. Interleaving and an index need
   a deliberate format revision and transport plan; gzip ranges cannot simply use
   uncompressed HMML offsets. v2.0 does not claim these features.
4. **Text asset compression at rest.** SVG/CSS/JSON assets stay raw inside DATA.
   CDN gzip compresses them on transfer. If they dominate offline storage, evaluate
   resource-level encoding or separately compressed storage before adding codec
   state to the streaming reader.
5. **Editor rendering.** Virtualize iframe instances and cache thumbnails by
   document version/viewport. The renderer transfers bytes into iframe-local Blobs
   without base64, but retains whole assets until disposal. Consider a direct
   worker-to-frame port only if profiling justifies bypassing main-thread forwarding.
6. **Real application memory.** Feed media into an incremental sink. Accumulating
   every resource into a Blob or base64 string discards the parser's memory benefit.
   Profile worker messaging and browser media buffers under the actual workload.

The complete wire contract is in [SPEC.md](../SPEC.md); integration examples are in
[streaming.md](./streaming.md).
