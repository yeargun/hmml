// Builds the static docs site (-> ./site) for Cloudflare Pages from the repo's
// Markdown. No framework: marked + highlight.js + a small dark theme.
//
//   npm run site:build      # outputs ./site
import { readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import hljs from "highlight.js";
import { Marked } from "marked";
import { markedHighlight } from "marked-highlight";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const out = join(root, "site");
const REPO = "https://github.com/yeargun/hmml";

const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));

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
  s
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z]+;/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

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
    .replace(/href="(\.\/)?playground[^"]*"/g, (m) => {
      const inner = m.slice(6, -1).replace(/^\.\//, "");
      return `href="${REPO}/tree/main/${inner}"`;
    })
    .replace(/href="(\.\/)?\.gitignore"/g, `href="${REPO}"`);
}

function tocHtml(toc) {
  if (!toc.length) return "";
  return "<ul>" + toc.map((t) => `<li class="lvl${t.lvl}"><a href="#${t.id}">${t.text}</a></li>`).join("") + "</ul>";
}

function page({ title, description, body, toc, active }) {
  const nav = [
    ["index.html", "Overview", active === "index"],
    ["spec.html", "Spec", active === "spec"],
    [`${REPO}/tree/main/playground`, "Playground", false],
    [REPO, "GitHub ↗", false],
  ]
    .map(([href, label, on]) => `<a href="${href}"${on ? ' class="on"' : ""}>${label}</a>`)
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · HMML</title>
<meta name="description" content="${description}">
<meta property="og:title" content="${title} · HMML">
<meta property="og:description" content="${description}">
<style>${THEME}</style>
</head>
<body>
<header class="topbar">
  <a class="brand" href="index.html">HMML<span>HyperMedia Markup Language</span></a>
  <nav>${nav}</nav>
</header>
<div class="layout">
  <aside class="toc"><div class="toc-title">On this page</div>${tocHtml(toc)}</aside>
  <main class="content">${body}</main>
</div>
<footer class="foot">HMML v${pkg.version} · <a href="${REPO}">github.com/yeargun/hmml</a> · MIT</footer>
</body>
</html>
`;
}

async function render(mdPath, opts) {
  const md = await readFile(mdPath, "utf8");
  const raw = rewriteLinks(marked.parse(md));
  const { html, toc } = processHeadings(raw);
  return page({ ...opts, body: html, toc });
}

const hljsTheme = await readFile(join(root, "node_modules", "highlight.js", "styles", "github-dark.css"), "utf8");

const THEME = `
${hljsTheme}
:root{--bg:#0b1020;--panel:#131a30;--border:#243155;--ink:#e7ecf5;--muted:#93a4c3;--accent:#7c8cff;--good:#57d9a3}
*{box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-top:80px}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
.topbar{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:24px;justify-content:space-between;
  padding:14px 28px;background:rgba(11,16,32,.85);backdrop-filter:blur(10px);border-bottom:1px solid var(--border)}
.brand{font-weight:700;font-size:18px;color:var(--ink);display:flex;align-items:baseline;gap:10px}
.brand span{font-weight:400;font-size:12.5px;color:var(--muted)}
.topbar nav{display:flex;gap:18px;font-size:14px}
.topbar nav a{color:var(--muted)}.topbar nav a.on,.topbar nav a:hover{color:var(--ink)}
.layout{display:grid;grid-template-columns:230px minmax(0,1fr);gap:48px;max-width:1080px;margin:0 auto;padding:36px 28px 60px;align-items:start}
.content{min-width:0}
.content h1{font-size:30px;line-height:1.2;margin:.2em 0 .4em}
.content h2{font-size:22px;margin:2em 0 .6em;padding-top:.2em;border-top:1px solid var(--border)}
.content h3{font-size:17px;margin:1.6em 0 .5em}
.content h2:first-of-type{border-top:0}
.content p,.content li{color:#dbe3f4}
.content code{font:13.5px/1.5 ui-monospace,"SF Mono",Menlo,monospace;background:#1a2238;border:1px solid var(--border);
  border-radius:5px;padding:.1em .4em}
.content pre{background:#0e1530;border:1px solid var(--border);border-radius:12px;padding:16px 18px;overflow:auto}
.content pre code{background:none;border:0;padding:0;font-size:13px}
.content table{border-collapse:collapse;width:100%;margin:1em 0;font-size:14px;display:block;overflow:auto}
.content th,.content td{border:1px solid var(--border);padding:8px 12px;text-align:left}
.content th{background:#16203c}
.content blockquote{margin:1em 0;padding:.4em 1em;border-left:3px solid var(--accent);background:#121a31;color:var(--muted)}
.content hr{border:0;border-top:1px solid var(--border);margin:2em 0}
.content img{max-width:100%}
.content div[align="center"]{text-align:center}
.content div[align="center"] h1{font-size:44px;margin:.1em 0}
.anchor{margin-left:.4em;color:var(--border);font-weight:400;opacity:0;text-decoration:none}
h2:hover .anchor,h3:hover .anchor{opacity:1}
.toc{position:sticky;top:80px;font-size:13px}
.toc-title{text-transform:uppercase;letter-spacing:.06em;font-size:11px;color:var(--muted);margin-bottom:10px}
.toc ul{list-style:none;margin:0;padding:0;border-left:1px solid var(--border)}
.toc li a{display:block;padding:3px 0 3px 14px;color:var(--muted);border-left:2px solid transparent;margin-left:-1px}
.toc li a:hover{color:var(--ink);text-decoration:none}
.toc li.lvl3 a{padding-left:26px;font-size:12.5px}
.foot{max-width:1080px;margin:0 auto;padding:24px 28px 48px;color:var(--muted);font-size:13px;border-top:1px solid var(--border)}
@media(max-width:880px){.layout{grid-template-columns:1fr}.toc{display:none}.topbar nav a:not(.on){}}
`;

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

await writeFile(
  join(out, "index.html"),
  await render(join(root, "README.md"), {
    title: "HMML",
    description: pkg.description,
    active: "index",
  }),
  "utf8",
);
await writeFile(
  join(out, "spec.html"),
  await render(join(root, "SPEC.md"), {
    title: "Specification",
    description: "HMML binary format specification (v1).",
    active: "spec",
  }),
  "utf8",
);

console.log(`Docs site built -> ${out}/  (index.html, spec.html)`);
