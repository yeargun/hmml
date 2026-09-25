# Rendering HMML attachments

Decoding produces an HTML/CSS blueprint and bytes. The browser renders them in a
document. A decoder worker has no DOM/layout engine. Keep the worker reusable
across attachments, with one isolated iframe per **visible** attachment.

The editor owns the attachment's position, stacking, selection handles, and outer
rectangle. The iframe owns an independent layout viewport. Document HTML/CSS owns
positions inside that viewport. Host transforms can zoom the attachment without
changing its layout width; changing the iframe width instead triggers reflow and
media queries inside the document. Store editor geometry in your editor model
(optionally in META as an application convention), not in the HMML wire framing.

## Progressive iframe

```ts
import { createDecoder } from '@eddocu/hmml/decoder';
import { createFrame } from '@eddocu/hmml/frame';

const decoder = createDecoder(); // one per editor, reused for all attachments
const frame = createFrame(attachmentSlot, {
  width: '100%',
  height: 'auto',
  minHeight: 80,
  maxHeight: 800,
  title: 'Attachment preview',
});
const controller = new AbortController();

try {
  for await (const event of decoder.decodeStream(fileOrUrl, {
    signal: controller.signal,
    maxResourceBytes: 128 * 1024 * 1024,
  })) {
    await frame.write(event, { transfer: true });
  }
} catch (error) {
  frame.dispose();
  throw error;
}
// On attachment removal: controller.abort(); frame.dispose();
// On editor close: decoder.dispose();
```

The first markup event renders before media. Later assets become iframe-local Blob
URLs at `resource-end`; matching attributes, inline CSS and style blocks update
without replacing the document. Repeated references reuse the same Blob URL. No
base64 media strings or parent-origin Blob URLs are needed. HMML references inside
asset payloads are not recursively rewritten: keep dependencies in the blueprint
or make assets self-contained. References to scripts/embedded documents do not make
those active types executable in this renderer.

Await each `write()` for backpressure. Explicit transfer detaches a whole owned
data-event buffer; default writes copy and preserve caller buffers. For an already
decoded small document, `await frame.load(doc)` preserves its resource buffers.
Use one load/blueprint per frame; create a new frame when replacing a document.

`height` defaults to `'480px'`; `width` defaults to `'100%'`. A fixed height is useful
for slides, canvases, pages, and documents using `vh`/percentage heights. `height:
'auto'` uses a ResizeObserver in the frame, reports content height over a private
MessagePort, and clamps it to `minHeight`/`maxHeight` (defaults 32/4096 CSS pixels).
Auto height is best for ordinary vertical flow; viewport-relative layouts can
create sizing feedback, so use a fixed viewport for them. Overflow scrolls inside
the frame. Change dimensions with `frame.resize({ width, height })`.

Frames store complete media as Blobs, with a **128 MiB total media quota** by default
(`maxMediaBytes`). This is a rendering budget, separate from format/parser limits;
it is not a guarantee of 128 MiB process memory. Decoded surfaces, videos, DOM and
browser Blob storage cost extra. The parser can stream multi-gigabyte files, but
this renderer is not a disk-backed media player. Large videos need a separate
incremental media/seek pipeline. Virtualize offscreen attachments and dispose frames
to release their realms and object URLs. Blob readiness also does not mean image
decoding, font loading, or video playback has completed.

There is a working multi-attachment demo at `examples/editor/index.html`. Run
`npm run build`, `node e2e/server.mjs`, then open
`http://127.0.0.1:5188/examples/editor/`.

## Isolation and application CSP

`createFrame` uses an opaque-origin sandbox and a nonce CSP. Only the library's
bridge script runs; document scripts and inline handlers are disabled. CSS stays
inside the frame, asset loads are limited to blob/data URLs, and network fetches,
nested frames, objects and forms are blocked. Link navigation outside local
fragments is intercepted. Do not add `allow-same-origin` to bypass these boundaries.
The ready handshake verifies the frame source and a random token, then transfers a
private port; its opaque origin requires `postMessage` target `'*'` for that initial
handoff. Height reports only change a clamped height, never editor position/width.

The app must allow srcdoc frames and the inline bridge in its own CSP. Pass its
nonce through `{ nonce }` if required. A parent policy cannot be loosened by a
frame's meta policy. Incompatible policies or unexpected frame navigation reject
pending work after `timeoutMs` (default 10 seconds). Trusted Types-enforcing apps
need their own approved integration; this helper assigns string `srcdoc`.

No iframe API guarantees a separate OS process or protection from excessive layout
and memory usage. The older `@eddocu/hmml/mount` helper remains useful for completed
small documents: sanitized Shadow DOM for trusted/static rendering, or explicit
script-capable sandbox/remote-loader modes. Its sandbox path inlines media as
base64. Prefer the progressive frame for media-heavy, script-disabled previews.

## Rasterization / thumbnails

Live iframe rendering and exporting an image are separate operations. No screenshot
library is bundled with `decode` or `createFrame`, and this revision does not claim
a general iframe-to-PNG API. Keep export code behind a dynamic import triggered
only when a thumbnail/export is needed. Cache snapshots by document version and
viewport dimensions; render snapshots for offscreen attachments and activate live
frames near the viewport.

For a **trusted, same-origin DOM surface** the app owns, an optional library can be
loaded on demand:

```ts
// Application dependency; not part of HMML or its normal decode/render bundle.
const { toBlob } = await import('html-to-image');
const png = await toBlob(trustedElement, { width: 800, height: 600, pixelRatio: 1 });
```

This cannot inspect the opaque `createFrame` DOM from its parent. Do not remove the
sandbox boundary to make screenshots work. An accurate snapshot of arbitrary
isolated HTML/video needs an application-controlled browser screenshot service
(or a separately designed trusted export renderer with explicit capture support).
HTML-to-image uses SVG foreignObject and canvas; external fonts/images must be
embedded, browser/CSS differences remain, and it is not a general live video capture
solution. html2canvas implements CSS rendering itself and documents unsupported
features. Neither makes arbitrary HTML layout available in a decoder Worker.
OffscreenCanvas can help with later image operations, not create a DOM engine.

References: [HTML iframe sandbox](https://html.spec.whatwg.org/multipage/iframe-embed-object.html),
[html-to-image implementation](https://github.com/bubkoo/html-to-image#how-it-works),
[html2canvas supported features](https://html2canvas.hertzen.com/features/), and
[SVG image restrictions](https://developer.mozilla.org/en-US/docs/Web/SVG/Guides/SVG_as_an_image).
