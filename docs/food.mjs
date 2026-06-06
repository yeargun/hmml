// Converts the real food-delivery page (food-webpage/) into a single .hmml:
// inline the CSS, pull every ./images/* into a raw RSRC chunk (no base64),
// and inject an SVG stick-man that walks left→right between the two image rows
// saying "I am image."
import { readFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encode, gzipCodec } from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "..", "food-webpage");
const MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", svg: "image/svg+xml", gif: "image/gif" };

const STICKMAN = `
<style>
  .hmml-walk{position:relative;height:170px;margin:14px 0;overflow:hidden;background:linear-gradient(180deg,#fff,#f6f8fc);border-top:1px solid #eef0f5;border-bottom:1px solid #eef0f5}
  .hmml-walk .ground{position:absolute;left:0;right:0;bottom:30px;border-bottom:2px dashed #e2e6ef}
  .hmml-walk .label{position:absolute;right:16px;top:12px;font:600 11px/1 ui-monospace,Menlo,monospace;color:#aab0c0;letter-spacing:.04em}
  .hmml-walk .walker{position:absolute;bottom:24px;left:0;will-change:transform;animation:hwx 12s linear infinite}
  .hmml-walk .sm{display:block}
  .hmml-walk .bubble{position:absolute;left:54px;bottom:84px;white-space:nowrap;background:#fff;border:2px solid #111;border-radius:14px;padding:7px 13px;font:800 13px/1 ui-sans-serif,system-ui,sans-serif;color:#111;box-shadow:0 8px 18px -10px rgba(0,0,0,.45)}
  .hmml-walk .bubble:after{content:"";position:absolute;left:16px;bottom:-9px;border:8px solid transparent;border-top-color:#111;border-bottom:0}
  .hmml-walk .bubble b{color:#4f46e5}
  .hmml-walk .arm,.hmml-walk .leg{transform-box:view-box}
  .hmml-walk .leg{--o:56px}.hmml-walk .arm{--o:32px}
  .hmml-walk .l1,.hmml-walk .a2{transform-origin:30px var(--o);animation:hsa .46s ease-in-out infinite alternate}
  .hmml-walk .l2,.hmml-walk .a1{transform-origin:30px var(--o);animation:hsb .46s ease-in-out infinite alternate}
  .hmml-walk .body{animation:hbob .46s ease-in-out infinite alternate;transform-box:view-box;transform-origin:30px 40px}
  @keyframes hwx{from{transform:translateX(-120px)}to{transform:translateX(calc(100vw + 60px))}}
  @keyframes hsa{from{transform:rotate(24deg)}to{transform:rotate(-24deg)}}
  @keyframes hsb{from{transform:rotate(-24deg)}to{transform:rotate(24deg)}}
  @keyframes hbob{from{transform:translateY(0)}to{transform:translateY(-2.5px)}}
</style>
<div class="hmml-walk" aria-hidden="true">
  <div class="ground"></div>
  <div class="label">↑ a stick-man SVG, animated, living inside this .hmml</div>
  <div class="walker">
    <div class="bubble">I am image. <b>I am image.</b></div>
    <svg class="sm" width="64" height="96" viewBox="0 0 64 96" fill="none" stroke="#111" stroke-width="3.6" stroke-linecap="round">
      <g class="body"><circle cx="30" cy="13" r="9" fill="#fff"/><line x1="30" y1="22" x2="30" y2="56"/></g>
      <line class="arm a1" x1="30" y1="32" x2="14" y2="46"/>
      <line class="arm a2" x1="30" y1="32" x2="46" y2="46"/>
      <line class="leg l1" x1="30" y1="56" x2="18" y2="86"/>
      <line class="leg l2" x1="30" y1="56" x2="42" y2="86"/>
    </svg>
  </div>
</div>`;

export async function buildFood() {
  let html = await readFile(join(dir, "index.html"), "utf8");
  const css = await readFile(join(dir, "snipped.css"), "utf8");
  html = html.replace('<link rel="stylesheet" href="./snipped.css">', `<style>\n${css}\n</style>`);

  // gather unique ./images/* references and turn each into a raw resource
  const names = new Set();
  for (const m of html.matchAll(/\.\/images\/([^"')\s]+)/g)) names.add(m[1]);

  const resources = [];
  const idOf = new Map();
  let i = 0;
  let imgBytes = 0;
  for (const name of names) {
    let data;
    try {
      data = new Uint8Array(await readFile(join(dir, "images", name)));
    } catch {
      continue; // missing file (e.g. a stray tracking pixel) - leave the ref
    }
    const ext = extname(name).slice(1).toLowerCase();
    const id = "i" + i++;
    resources.push({ id, mime: MIME[ext] || "application/octet-stream", data });
    idOf.set(name, id);
    imgBytes += data.length;
  }
  html = html.replace(/\.\/images\/([^"')\s]+)/g, (m, name) => (idOf.has(name) ? "hmml:" + idOf.get(name) : m));

  // inject the walking stick-man between row 1 and row 2
  html = html.replace(/<\/sm-recommend-product-list>\s*<\/div>/, (m) => m + STICKMAN);

  const bytes = await encode({ html, resources, meta: { title: "Yemek - a real website, in one .hmml" } }, { codec: gzipCodec });

  const markupBytes = Buffer.byteLength(html, "utf8");
  const selfContained = markupBytes + Math.ceil((imgBytes * 4) / 3); // base64 inflation estimate
  return {
    bytes,
    hmmlBytes: bytes.length,
    selfContained,
    save: Math.max(0, Math.round(100 * (1 - bytes.length / selfContained))),
    resources: resources.length,
  };
}
