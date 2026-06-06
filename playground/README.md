# HMML playground

Hands-on files and pages for poking at the format yourself.

```
playground/
├── assets/        ← SOURCE images (png/jpg/webp/gif/svg). Drop your own here.
├── files/         ← GENERATED output (gitignored): *.hmml + matching *.html + manifest.json
├── index.html     ← gallery hub (best over http: `npm run playground`)
├── viewer.html    ← drag a .hmml in and render it  (works from file://)
├── create.html    ← pick images → build & download a .hmml (works from file://)
└── build.mjs      ← generator (run via `npm run pg:build`)
```

## Generate the files

```sh
npm run pg:build
```

This builds the library, then for every image in `assets/` writes to `files/`:

- `<name>.hmml` — the binary HMML document
- `<name>.html` — the **same thing as a standalone, double-clickable HTML page**
- plus a combined `gallery.hmml` / `gallery.html` and `manifest.json`

Add your own images to `assets/` and re-run to pack them too.

## Two ways to view

**Over http (full gallery, recommended):**

```sh
npm run playground        # builds, generates, serves on http://127.0.0.1:5188
```

Open <http://127.0.0.1:5188/> — the gallery lists every file with size savings,
a live preview, a `view` link (renders the `.hmml` via the viewer), `open .html`,
and `download .hmml`.

**Straight from the filesystem (no server):**

- Double-click any `files/*.html` — a normal web page, images inlined.
- Open `viewer.html` and **drag a `files/*.hmml` onto it** — decodes and renders
  the binary in your browser (uses the `window.HMML` global from
  `../dist/index.global.js`, so run `npm run build` once first).
- Open `create.html`, pick some images, and download your own `.hmml`.

> `viewer.html?file=…` needs http (browsers block `fetch` of local files), so use
> drag-and-drop when you're on `file://`.
