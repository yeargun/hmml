

<div align="center">

# HMML

### HyperMedia Markup Language

**A tiny open format for one file that is HTML *and* its images - together, in bytes.**

`image + html  →  one binary document`

It's bits & bytes and a contract. Markup stays text; images stay raw (no base64).
Smaller than a self‑contained HTML file, and it renders with the full power of a browser.

<sub>~2 KB gzipped reader · sub‑millisecond decode · zero dependencies · works in the browser, Node, Deno, Bun & workers</sub>

[Spec](./SPEC.md) · [Playground](./playground) · [Quick start](#quick-start) · [Why](#why-hmml)

</div>

---

## The idea

A web page is already *hypermedia* - text, layout, and media in one experience. But the
moment you want it as **one portable file**, you hit a wall: you base64 every image into
the HTML and pay a ~33% size tax, or you ship a folder of loose assets.

HMML is the third option. One binary document:

```
┌─────────────────────────────────────────────┐
│  HMML document                                │
│                                               │
│   MARK   <html>…</html>      ← text, gzipped  │
│   RSRC   image/webp  ▒▒▒▒▒   ← raw bytes      │
│   RSRC   image/png   ▒▒▒▒▒   ← raw bytes      │
│   META   { title, … }                         │
│                                               │
│   markup points at images with  hmml:<id>     │
└─────────────────────────────────────────────┘
```

The markup references each image by a tiny token (`<img src="hmml:r0">`), and the bytes
live next to it - uncompressed‑duplicated, exactly as the camera/encoder produced them.
Because the renderer is a real browser, your layout has **no limits**: `matrix3d`,
filters, blend modes, SVG, `<canvas>`, CSS grid - all of it, for free.

## Why HMML

- **Smaller than base64.** Raw image bytes drop the ~33% base64 tax; markup is gzipped.
  Measured **~25% smaller** than the equivalent single‑file HTML on image‑heavy docs,
  and **35–40% smaller** on markup‑heavy ones.
- **Tiny & fast clients.** The reader is **~2 KB gzipped** and decodes at **~800 MB/s**.
- **Zero dependencies.** Pure `Uint8Array`; compression uses the platform
  `CompressionStream`. Runs unchanged in browsers, Node 18+, Deno, Bun and Web Workers.
- **A real contract, not a blob.** A PNG‑style signature + self‑describing chunks +
  optional CRC32. Forward‑compatible: unknown chunks are skipped, so v2 won't break v1.
- **Render however you like.** Resolve images to `blob:` object URLs (cheap to paint),
  `data:` URIs (self‑contained export), or keep `hmml:` refs and serve them yourself.
- **Safe by default.** `mount()` ships trust tiers: no‑JS Shadow DOM for the common case,
  or jail untrusted JS in a sandboxed iframe (no parent DOM, no cookies, no network). The
  renderer is a separate import - the core reader carries none of it. See [Security](#security).

## Numbers

Measured on this repo (`npm run size`, `npm run bench`; Node 20, single‑threaded).

**Bundle size** - minified, by what you import:

| You import | gzip | brotli |
| --- | ---: | ---: |
| `decode` (the reader) | **2.0 KB** | 1.8 KB |
| `encode` + `extract` (the writer) | **2.0 KB** | 1.8 KB |
| `pack` + `unpack` (typical app) | **3.2 KB** | 2.9 KB |
| everything | **3.8 KB** | 3.4 KB |

**Throughput** - a 494 KB document (one ~492 KB image + markup):

| Operation | per call | throughput |
| --- | ---: | ---: |
| decode (gzip) | 0.61 ms | **829 MB/s** |
| encode (gzip) | 1.17 ms | 434 MB/s |
| decode (store, no compression) | 0.06 ms | **8.0 GB/s** |
| encode (store) | 0.36 ms | 1.4 GB/s |

And it was **25.2% smaller** than the self‑contained base64 HTML of the same content.

## Quick start

```sh
npm install @eddocu/hmml
```

The easy path - `pack` / `unpack`:

```ts
import { pack, unpack } from "@eddocu/hmml";

// Pass HTML that has data: URIs - they're auto-extracted into raw resources.
// (gzip by default → smallest file, no config.)
const bytes: Uint8Array = await pack(`
  <section style="transform: matrix3d(1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1)">
    <img src="data:image/webp;base64,UklGR…">
  </section>
`, { meta: { title: "Card" } });

// …store/send `bytes` (a .hmml file)…

const doc = await unpack(bytes);
el.innerHTML = doc.toHTML();          // images inlined as data URIs
// or, cheaper to paint in the browser:
const { html, revoke } = doc.createObjectUrls();
el.innerHTML = html;                  // images as blob: URLs - call revoke() on teardown
```

Building a document explicitly (no auto‑extract):

```ts
await pack({
  html: `<img src="hmml:hero">`,
  resources: [{ id: "hero", mime: "image/png", data: pngBytes }],
});
```

Use it from a plain `<script>` via CDN - exposes `window.HMML` (~3.7 KB gzip):

```html
<script src="https://unpkg.com/@eddocu/hmml/dist/index.global.js"></script>
<script>
  const doc = await HMML.unpack(new Uint8Array(await file.arrayBuffer()));
  document.body.innerHTML = doc.toHTML();
</script>
```

> For the smallest payload, inline a decode-only build (~2 KB gzip) - that's what the
> [landing page](https://hmml.eddocu.com) does.

## Security

A `.hmml` can carry arbitrary HTML, CSS **and** JS. `unpack` hands you the markup + the
raw bytes; **how you mount it is your security boundary.** The optional
`@eddocu/hmml/mount` helper (a separate ~1.7 KB import - the core reader stays ~2 KB)
makes the safe choice the default.

**The principle:** you can't *sanitise* arbitrary JS into safety - you **confine** it.
Only a sandboxed iframe confines JS. Shadow DOM isolates styles + the DOM tree (it fixes
class-name collisions) but a `<script>` in a shadow root runs in **your** page with full
access. So `mount` picks the isolation primitive per trust tier:

| `trust` | primitive | JS | what it stops |
| --- | --- | :---: | --- |
| `static` *(default)* | Shadow DOM + sanitiser | ✗ stripped | scripts removed; CSS can't leak in or out |
| `sandbox` | iframe `allow-scripts`¹ + CSP | ✓ jailed | opaque origin → no parent DOM, no host cookies/storage; `connect-src 'none'` → no network |
| `isolated` | `sandbox` on a separate origin | ✓ jailed hard | all of the above, across an origin/process boundary |

<sub>¹ deliberately **without** `allow-same-origin` - combining the two re-grants your origin and voids the sandbox.</sub>

```ts
import { unpack } from "@eddocu/hmml";
import { mount } from "@eddocu/hmml/mount";

const doc = await unpack(bytes);
mount(el, doc);                        // secure by default — scripts never run
mount(el, doc, { trust: "sandbox" });  // JS runs, jailed: no parent DOM, no network
mount(el, doc, { trust: "isolated", origin: "https://sandbox.example.com" });
```

### What each tier does — and doesn't

- **`static`** sanitises with the browser's native `Element.setHTML()` (zero bytes shipped).
  Where that isn't available yet, pass your own - `{ sanitizer: DOMPurify.sanitize }` - or it
  **transparently falls back to `sandbox`**; it never injects unsanitised markup into your page.
  Caveats: a sanitiser may drop exotic/unknown elements, and `static` has no CSP, so it does **not**
  block external `url()` in CSS - it stops scripts, not network/privacy beacons. For content that's
  untrusted *and* must stay offline, use `sandbox`.
- **`sandbox`** runs JS in an opaque origin under a strict CSP: no parent DOM, no cookies/storage,
  no network. Residual risk is **CPU/RAM** (a hostile file can still spin the iframe's own thread) -
  gate it with `loading="lazy"`/visibility and dispose it when offscreen. Jailed content can't measure
  itself, so set `height`. `postMessage` out is allowed (a channel, not a leak of your data).
- **`isolated`** is `sandbox` loaded from an origin **you host** - ship the loader from
  `createSandboxLoaderHtml()` and serve it with a strong CSP response header. Use it for hostile
  content or defence-in-depth against sandbox-bypass bugs.

### Format-level concerns

- **Integrity ≠ authenticity.** The optional CRC32 catches corruption, not tampering; there is no
  signature yet, so don't infer provenance from a `.hmml`. (A signed `SIGN` chunk is planned, to let
  you trust-gate scripts by author.)
- **Resources are stored verbatim.** Raster bytes behind an `<img>` are inert, but an SVG pulled
  inline, or `<object>`/`<use>` to external refs, can carry script - which is exactly why you render
  through a trust tier instead of dropping markup into your live DOM.
- **`toHTML()` / `createObjectUrls()` are *resolvers*, not sanitisers.** They re-stitch the document;
  they don't make it safe. Pair them with `mount` (or your own sandboxed iframe) for anything you
  didn't author yourself.

## How it works (the contract)

A document is a signature + a stream of self‑describing chunks:

```
89 'H' 'M' 'M' 'L' 0D 0A 1A 0A   signature (PNG-style corruption guard)
major · minor · codec            1 byte each
─ chunk ─ … ─ chunk ─            TYPE(4) FLAGS(1) LEN(u32 LE) PAYLOAD [CRC32?]
   MARK   markup (gzip-able)
   RSRC   id + mime + raw bytes
   META   JSON metadata
   ENDF   end marker
```

Little‑endian, UTF‑8, one codec per file (recorded in the header so the reader
auto‑resolves it). Full byte‑level details, including a hex worked example, are in
**[SPEC.md](./SPEC.md)**.

## How it compares

| | binary | images stored | one file | renders as | to *read* it |
| --- | :---: | --- | :---: | --- | --- |
| **HMML** | ✅ | **raw** | ✅ | HTML, any browser | **~2 KB lib** |
| Single‑file HTML (`data:` URIs) | ❌ text | base64 (+33%) | ✅ | HTML | nothing |
| MHTML `.mht` | ❌ MIME text | base64 | ✅ | HTML | a parser |
| Safari `.webarchive` | ✅ bplist | raw | ✅ | HTML (Safari only) | Apple‑only |
| Web Bundle `.wbn` | ✅ CBOR | raw | ✅ | HTTP exchanges | CBOR + flagged browser |
| ZIP (EPUB‑style) | ✅ | raw | ✅ | depends | a zip lib |

HMML's niche: a **small, embeddable, smaller‑than‑base64, dependency‑free** binary
document you fully control - ideal for storing a rich snippet/card compactly and
rehydrating it in the browser. (For archiving whole pages, MHTML or a ZIP are fine;
this is a different job.)

## Playground

Real files and pages to poke - see [`playground/`](./playground).

```sh
npm run playground   # build + generate + serve a gallery at http://127.0.0.1:5188
npm run pg:bundle    # zip a self-contained, file://-openable bundle (no server/npm)
```

- **Viewer** - drag a `.hmml` in and watch it render (works from `file://`).
- **Create** - pick images, build & download your own `.hmml`.
- Every sample also ships as a double‑clickable standalone `.html`.

## Compression codecs

Default for `pack` is **gzip**; for the low‑level `encode` it's `store` (no deps at all).
Built‑in ids are auto‑resolved on decode.

```ts
import { encode, gzipCodec, storeCodec, deflateRawCodec } from "@eddocu/hmml";
await encode(input, { codec: gzipCodec });            // smallest
await encode(input, { codec: storeCodec, crc: true }); // no compression + integrity
```

Custom codec (e.g. [`fflate`](https://github.com/101arrowz/fflate) for old runtimes):

```ts
import { deflateSync, inflateSync } from "fflate";
const fflateCodec = { id: 16, deflate: deflateSync, inflate: inflateSync };
await encode(input, { codec: fflateCodec });
await decode(file, { codec: fflateCodec }); // custom id → pass it back
```

## API

The package is **module-based and side-effect-free** (`"sideEffects": false`), so bundlers
tree-shake to exactly what you import. Two entry points keep the renderer out of the reader:

**`@eddocu/hmml`** - the core (read/write, no DOM):

| Export | What it does |
| --- | --- |
| `pack(html \| input, opts?)` | One‑call encode (auto‑extracts `data:` URIs; gzip default) |
| `unpack(bytes, opts?)` | One‑call decode → `HmmlDocument` |
| `encode` / `decode` | Low‑level encode/decode |
| `extract` / `inlineDataUris` / `inlineObjectUrls` | Markup ⇄ resources helpers |
| `storeCodec` / `gzipCodec` / `deflateRawCodec` / `deflateCodec` | Built‑in codecs |
| `sniffMime` / `extensionFor` / `toBase64` / `fromBase64` / `crc32` | Utilities |

`HmmlDocument`: `{ html, resources: Map, meta, codecId, toHTML(), createObjectUrls() }`.

**`@eddocu/hmml/mount`** - the optional DOM renderer (~1.7 KB; pulls in zero of it unless you import it):

| Export | What it does |
| --- | --- |
| `mount(el, doc, opts?)` | Render into `el` under a trust tier (`static` \| `sandbox` \| `isolated`); returns `{ trust, element, dispose() }` |
| `createSandboxLoaderHtml()` | Loader page to host on a separate origin for `trust: "isolated"` |
| `DEFAULT_CSP` | The CSP applied inside sandbox/isolated frames |

See [Security](#security) for the trust tiers and their guarantees.

## Development

```sh
npm install
npm run demo          # node round-trip + size comparison
npm test              # vitest unit tests
npm run test:browser  # Playwright: decode & render in real Chromium
npm run bench         # encode/decode throughput
npm run size          # bundle sizes by import shape
npm run build         # dual ESM/CJS + IIFE global + .d.ts (minified) via tsup
```

## Status

**v0 / draft.** The format (major version `1`) is implemented and tested end‑to‑end
(unit + real-Chromium Playwright, including the `mount` trust tiers), but the spec may
still evolve before a `1.0` tag. On the roadmap: more media MIME sniffing (video/audio)
with lazy resolution, a worker decode path, and a signed `SIGN` chunk for authenticity.
Feedback and breakage reports welcome.

## License

MIT © Argun
