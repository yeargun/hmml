// Builds the static site (-> ./site) for Cloudflare Pages.
//   index.html  bespoke animated manifesto landing, with a decode-only HMML
//               reader inlined and live samples embedded as base64 (self-contained)
//   docs.html   README.md rendered
//   spec.html   SPEC.md rendered
//
// Run after `npm run build` (uses dist/ to encode the samples).
import { build as esbuild } from "esbuild";
import { readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import hljs from "highlight.js";
import { Marked } from "marked";
import { markedHighlight } from "marked-highlight";
import { encode, extract, gzipCodec, toBase64 } from "../dist/index.js";
import { SAMPLES, UNIVERSE } from "./samples.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const out = join(root, "site");
const REPO = "https://github.com/yeargun/hmml";
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));

const bytesFmt = (n) => (n < 1024 ? n + " B" : (n / 1024).toFixed(1) + " KB");

/* ---------- 1. decode-only reader, inlined into the page ---------- */
async function buildReader() {
  const tmp = join(here, "_reader.tmp.ts");
  const idx = join(root, "src", "index.ts").replace(/\\/g, "/");
  await writeFile(tmp, `export { decode, fromBase64 } from "${idx}";`);
  const res = await esbuild({
    entryPoints: [tmp],
    bundle: true,
    minify: true,
    format: "iife",
    globalName: "HMML",
    target: "es2020",
    legalComments: "none",
    write: false,
  });
  await rm(tmp, { force: true });
  const code = res.outputFiles[0].text;
  const gzip = gzipSync(Buffer.from(code), { level: 9 }).length;
  return { code, gzip };
}

/* ---------- 2. encode the live samples ---------- */
function fullPage(markup) {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>${markup}</body></html>`;
}
async function encodeDef(s) {
  const markup = await s.build();
  const { html, resources } = extract(markup);
  const file = await encode({ html, resources, meta: { title: s.id } }, { codec: gzipCodec });
  const htmlBytes = Buffer.byteLength(fullPage(markup), "utf8");
  return {
    id: s.id,
    title: s.title,
    blurb: s.blurb,
    kind: s.kind,
    b64: toBase64(file),
    hmml: bytesFmt(file.length),
    save: Math.max(0, Math.round(100 * (1 - file.length / htmlBytes))),
  };
}

/* ---------- 3. docs/spec pages from Markdown ---------- */
const marked = new Marked(
  markedHighlight({
    langPrefix: "hljs language-",
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : "plaintext";
      return hljs.highlight(code, { language }).value;
    },
  }),
);
const slug = (s) =>
  s.toLowerCase().replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
function processHeadings(html) {
  const toc = [];
  const withIds = html.replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (_m, lvl, inner) => {
    const text = inner.replace(/<[^>]+>/g, "").trim();
    const id = slug(text);
    toc.push({ lvl: Number(lvl), id, text });
    return `<h${lvl} id="${id}">${inner}<a class="anchor" href="#${id}" aria-hidden="true">#</a></h${lvl}>`;
  });
  return { html: withIds, toc };
}
function rewriteLinks(html) {
  return html
    .replace(/href="\.?\/?SPEC\.md"/g, 'href="spec.html"')
    .replace(/href="(\.\/)?playground[^"]*"/g, (m) => `href="${REPO}/tree/main/${m.slice(6, -1).replace(/^\.\//, "")}"`)
    .replace(/href="(\.\/)?\.gitignore"/g, `href="${REPO}"`);
}
function tocHtml(toc) {
  if (!toc.length) return "";
  return "<ul>" + toc.map((t) => `<li class="lvl${t.lvl}"><a href="#${t.id}">${t.text}</a></li>`).join("") + "</ul>";
}
function docPage({ title, description, body, toc, active }) {
  const nav = [
    [".", "Home", false],
    ["docs.html", "Docs", active === "docs"],
    ["spec.html", "Spec", active === "spec"],
    [`${REPO}`, "GitHub ↗", false],
  ]
    .map(([href, label, on]) => `<a href="${href}"${on ? ' class="on"' : ""}>${label}</a>`)
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title><meta name="description" content="${description}"><style>${DOC_THEME}</style></head>
<body>
<header class="topbar"><a class="brand" href=".">HMML<span>HyperMedia Markup Language</span></a><nav>${nav}</nav></header>
<div class="layout"><aside class="toc"><div class="toc-title">On this page</div>${tocHtml(toc)}</aside>
<main class="content">${body}</main></div>
<footer class="foot">HMML v${pkg.version} · <a href="${REPO}">github.com/yeargun/hmml</a> · MIT</footer>
</body></html>`;
}
async function renderDoc(mdPath, opts) {
  const { html, toc } = processHeadings(rewriteLinks(marked.parse(await readFile(mdPath, "utf8"))));
  return docPage({ ...opts, body: html, toc });
}
const hljsTheme = await readFile(join(root, "node_modules", "highlight.js", "styles", "github-dark.css"), "utf8");
const DOC_THEME = `
${hljsTheme}
:root{--bg:#0b1020;--border:#243155;--ink:#e7ecf5;--muted:#93a4c3;--accent:#7c8cff}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:80px}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
.topbar{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:24px;justify-content:space-between;padding:14px 28px;background:rgba(11,16,32,.85);backdrop-filter:blur(10px);border-bottom:1px solid var(--border)}
.brand{font-weight:800;font-size:18px;color:var(--ink);display:flex;align-items:baseline;gap:10px}.brand span{font-weight:400;font-size:12.5px;color:var(--muted)}
.topbar nav{display:flex;gap:18px;font-size:14px}.topbar nav a{color:var(--muted)}.topbar nav a.on,.topbar nav a:hover{color:var(--ink)}
.layout{display:grid;grid-template-columns:230px minmax(0,1fr);gap:48px;max-width:1080px;margin:0 auto;padding:36px 28px 60px;align-items:start}
.content{min-width:0}.content h1{font-size:30px;line-height:1.2;margin:.2em 0 .4em}
.content h2{font-size:22px;margin:2em 0 .6em;border-top:1px solid var(--border);padding-top:.6em}.content h2:first-of-type{border-top:0}
.content h3{font-size:17px;margin:1.6em 0 .5em}.content p,.content li{color:#dbe3f4}
.content code{font:13.5px/1.5 ui-monospace,Menlo,monospace;background:#1a2238;border:1px solid var(--border);border-radius:5px;padding:.1em .4em}
.content pre{background:#0e1530;border:1px solid var(--border);border-radius:12px;padding:16px 18px;overflow:auto}.content pre code{background:none;border:0;padding:0;font-size:13px}
.content table{border-collapse:collapse;width:100%;margin:1em 0;font-size:14px;display:block;overflow:auto}.content th,.content td{border:1px solid var(--border);padding:8px 12px;text-align:left}.content th{background:#16203c}
.content blockquote{margin:1em 0;padding:.4em 1em;border-left:3px solid var(--accent);background:#121a31;color:var(--muted)}
.content hr{border:0;border-top:1px solid var(--border);margin:2em 0}.content img{max-width:100%}
.content div[align=center]{text-align:center}.content div[align=center] h1{font-size:44px;margin:.1em 0}
.anchor{margin-left:.4em;color:var(--border);opacity:0}h2:hover .anchor,h3:hover .anchor{opacity:1}
.toc{position:sticky;top:80px;font-size:13px}.toc-title{text-transform:uppercase;letter-spacing:.06em;font-size:11px;color:var(--muted);margin-bottom:10px}
.toc ul{list-style:none;margin:0;padding:0;border-left:1px solid var(--border)}.toc li a{display:block;padding:3px 0 3px 14px;color:var(--muted);border-left:2px solid transparent;margin-left:-1px}
.toc li a:hover{color:var(--ink);text-decoration:none}.toc li.lvl3 a{padding-left:26px;font-size:12.5px}
.foot{max-width:1080px;margin:0 auto;padding:24px 28px 48px;color:var(--muted);font-size:13px;border-top:1px solid var(--border)}
@media(max-width:880px){.layout{grid-template-columns:1fr}.toc{display:none}}
`;

/* ---------- assemble ---------- */
const [reader, samples, universe] = await Promise.all([
  buildReader(),
  Promise.all(SAMPLES.map(encodeDef)),
  encodeDef(UNIVERSE),
]);
const readerGzip = bytesFmt(reader.gzip);

let landing = await readFile(join(here, "landing.html"), "utf8");
landing = landing
  .replace("__HMML_LIB__", () => reader.code.replace(/<\/script/gi, "<\\/script"))
  .replaceAll("__UNIVERSE_JSON__", () => JSON.stringify(universe))
  .replaceAll("__SAMPLES_JSON__", () => JSON.stringify(samples))
  .replaceAll("__READER_GZIP__", readerGzip);

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await writeFile(join(out, "index.html"), landing, "utf8");
await writeFile(
  join(out, "docs.html"),
  await renderDoc(join(root, "README.md"), { title: "HMML — Docs", description: pkg.description, active: "docs" }),
  "utf8",
);
await writeFile(
  join(out, "spec.html"),
  await renderDoc(join(root, "SPEC.md"), { title: "HMML Specification (v1)", description: "HMML binary format specification.", active: "spec" }),
  "utf8",
);

console.log(`Site built -> ${out}/`);
console.log(`  index.html  landing · inlined reader ${readerGzip} gzip · ${samples.length} live samples`);
console.log(`  docs.html   README`);
console.log(`  spec.html   SPEC`);
for (const s of samples) console.log(`    sample ${s.id.padEnd(9)} ${s.hmml.padStart(8)} .hmml  (${s.save}% smaller)`);
