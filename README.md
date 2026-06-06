# hmml

**HyperMedia Markup Language** — a compact binary container that pairs HTML/CSS/SVG
markup with its images stored as **raw bytes** (no base64) and referenced by a tiny
`hmml:<id>` URI.

Think of it as *"HTML in a binary envelope"*:

- **Smaller than a self-contained `.html`.** Base64 inflates binary by ~33%; HMML
  drops that entirely and can gzip the markup on top.
- **Total layout freedom.** Images are just `<img>` / `url()` in real HTML, so
  `matrix3d`, filters, blend modes, weird containers — anything a browser can do.
- **SVG for free** (it's text), and **forward-compatible** chunked framing.
- **Zero runtime dependencies.** Compression is pluggable; the built-in codecs use
  the platform `CompressionStream` API.

See [`SPEC.md`](./SPEC.md) for the byte-level format.

## Install

```sh
npm install hmml
```

## Quick start

```ts
import { encode, decode, extract, gzipCodec } from "hmml";

// You have some HTML with inline data: URIs.
const original = `
  <section style="transform: matrix3d(1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1)">
    <img src="data:image/webp;base64,UklGR... ">
  </section>`;

// 1. Lift the images out into raw-byte resources.
const { html, resources } = extract(original);

// 2. Pack into the HMML binary (markup gzipped, images stored raw).
const file: Uint8Array = await encode(
  { html, resources, meta: { title: "Card" } },
  { codec: gzipCodec },
);

// 3. Later — read it back.
const doc = await decode(file);
doc.toHTML();                       // markup with images inlined as data URIs
doc.toHTML({ resolve: "keep" });    // markup with hmml: refs untouched
doc.resources.get("r0");            // { id, mime, data: Uint8Array }
doc.meta;                           // { title: "Card" }
```

### Rendering in a browser (object URLs)

```ts
const doc = await decode(file);
const { html, revoke } = doc.createObjectUrls();
container.innerHTML = html;
// when you tear the markup down:
revoke();
```

### Building a document by hand

`extract` is optional — you can supply markup that already uses `hmml:` refs plus the
resources directly:

```ts
await encode({
  html: `<img src="hmml:hero">`,
  resources: [{ id: "hero", mime: "image/png", data: pngBytes }],
});
```

## API

| Export | Description |
| --- | --- |
| `encode(input, options?)` | `HmmlInput` → `Promise<Uint8Array>` |
| `decode(bytes, options?)` | `Uint8Array` → `Promise<HmmlDocument>` |
| `extract(html, options?)` | Lift `data:` URIs into resources, return `{ html, resources }` |
| `inlineDataUris(html, resources)` | Replace `hmml:` refs with base64 data URIs |
| `inlineObjectUrls(html, resources)` | Replace refs with `blob:` URLs (+ `revoke`) |
| `storeCodec` / `gzipCodec` / `deflateRawCodec` / `deflateCodec` | Built-in codecs |
| `sniffMime(bytes)` / `extensionFor(mime)` | MIME helpers (png/jpeg/webp/gif/avif/heic/svg) |
| `toBase64` / `fromBase64` / `crc32` / `ByteReader` / `ByteWriter` | Low-level utilities |

### Codecs

The default is `storeCodec` (no compression, zero dependency). Pass a codec to
compress the markup:

```ts
await encode(input, { codec: gzipCodec });          // markup gzipped
await encode(input, { codec: gzipCodec, crc: true }); // + per-chunk CRC32
```

The chosen codec's id is written into the file, so `decode` auto-resolves built-ins.
For older runtimes without `CompressionStream`, provide a custom `Codec` (e.g. backed
by [`fflate`](https://github.com/101arrowz/fflate)):

```ts
import { deflateSync, inflateSync } from "fflate";
const fflateCodec = { id: 16, deflate: deflateSync, inflate: inflateSync };
await encode(input, { codec: fflateCodec });
await decode(file, { codec: fflateCodec }); // custom id → pass it back in
```

## Development

```sh
npm install
npm run demo       # round-trip + size comparison
npm test           # vitest
npm run build      # dual ESM/CJS + .d.ts via tsup
npm run typecheck
```

## License

MIT
