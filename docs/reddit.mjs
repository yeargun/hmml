// Converts the saved Reddit post (reddit-snippet-2026-6-11/) into a single .hmml.
// The snapshot is already self-contained: markup + CSS + inline SVG icons, with no
// ./images, no data: URIs and no <script> tags. So conversion is just: inline the
// stylesheet, tidy the inert (un-hydrated) Reddit web-component chrome so it reads as
// a clean static post, and seal it as one binary document.
//
// The post itself ("HTML is a native image format, hear me out ..") is the HMML thesis
// in the wild - so it doubles as the landing page's proof-of-concept easter egg.
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encode, gzipCodec } from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "..", "reddit-snippet-2026-6-11");

// The saved page carries Reddit's interactive chrome (promote button, hovercards,
// faceplate loaders, the share/embed dropdown panel). With no JS to hydrate them they
// are dead weight that can render as stray inline text. Hide them so the snippet looks
// like the post a reader actually sees - avatar, community, title, body, action bar.
const TIDY = `
<style>
  faceplate-loader,faceplate-partial,faceplate-tracker[source="post_credit_bar"] ~ *:empty,
  promote-post-button,[slot="promote-post-button"],
  faceplate-dropdown-menu faceplate-menu,
  faceplate-hovercard > [slot="content"],
  shreddit-async-loader,faceplate-screen-reader-content{display:none !important}
  shreddit-post{display:block}
</style>`;

export async function buildReddit() {
  let html = await readFile(join(dir, "index.html"), "utf8");
  const css = await readFile(join(dir, "snipped.css"), "utf8");
  html = html.replace('<link rel="stylesheet" href="./snipped.css">', `<style>\n${css}\n</style>${TIDY}`);

  const bytes = await encode(
    { html, resources: [], meta: { title: "“HTML is a native image format” — a Reddit post, in one .hmml" } },
    { codec: gzipCodec },
  );

  const rawHtml = Buffer.byteLength(html, "utf8");
  return {
    bytes,
    html,
    hmmlBytes: bytes.length,
    save: Math.max(0, Math.round(100 * (1 - bytes.length / rawHtml))),
  };
}
