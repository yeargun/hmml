// Assembles a self-contained, zero-setup bundle you can download and open
// straight from the filesystem (no npm, no server), then zips it.
//
//   playground/hmml-playground.zip
//     hmml-playground/
//       index.html        offline gallery (static links, no fetch)
//       viewer.html       drag a .hmml in and render it
//       create.html       pick images -> build & download your own .hmml
//       hmml.global.js    the library (used by viewer/create)
//       open-me/<name>.html   standalone, double-clickable pages
//       files/<name>.hmml     the binary documents (drag onto viewer.html)
//       README.txt
import { execSync } from "node:child_process";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const filesDir = join(here, "files");
const NAME = "hmml-playground";
const outDir = join(here, NAME);

const fmt = (n) => n.toLocaleString() + " B";

function offlineIndex(manifest) {
  const cards = manifest.files
    .map(
      (f) => `
      <div class="item">
        <a class="thumb" href="open-me/${f.name}.html"><iframe src="open-me/${f.name}.html" scrolling="no" tabindex="-1"></iframe></a>
        <div class="body">
          <h3>${f.name}</h3>
          <dl>
            <dt>type</dt><dd>${f.mime}</dd>
            <dt>.hmml</dt><dd>${fmt(f.hmmlBytes)}</dd>
            <dt>html</dt><dd>${fmt(f.inlinedHtmlBytes)}</dd>
            <dt>saved</dt><dd class="savings">${f.savingsPct}%</dd>
          </dl>
          <div class="actions">
            <a href="open-me/${f.name}.html">open page</a>
            <a href="files/${f.name}.hmml" download>download .hmml</a>
          </div>
          <p class="hint">drag <code>files/${f.name}.hmml</code> onto <a href="viewer.html">viewer.html</a></p>
        </div>
      </div>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>HMML playground (offline)</title>
<style>
  body{margin:0;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#0b1020;color:#e7ecf5}
  header{padding:28px;border-bottom:1px solid #1c2747}
  header h1{margin:0 0 4px;font-size:22px} header p{margin:0;color:#93a4c3;font-size:14px}
  header .links{margin-top:14px;display:flex;gap:10px;flex-wrap:wrap}
  header a.btn{color:#cdd8f5;font-size:13px;text-decoration:none;border:1px solid #2d3a63;background:#1b2340;padding:8px 13px;border-radius:9px}
  .grid{padding:24px 28px 60px;display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:18px}
  .item{background:#131a30;border:1px solid #243155;border-radius:16px;overflow:hidden}
  .thumb{aspect-ratio:16/10;background:#0e1530;display:block;overflow:hidden}
  .thumb iframe{width:200%;height:200%;border:0;pointer-events:none;transform:scale(.5);transform-origin:top left}
  .body{padding:14px 16px} h3{margin:0 0 8px;font-size:15px}
  dl{margin:0;display:grid;grid-template-columns:max-content 1fr;gap:2px 12px;font:12px/1.4 ui-monospace,Menlo,monospace;color:#9fb4ff}
  .savings{color:#57d9a3}
  .actions{margin-top:12px;display:flex;gap:8px;flex-wrap:wrap}
  .actions a{font-size:12.5px;text-decoration:none;color:#cdd8f5;border:1px solid #2d3a63;padding:6px 10px;border-radius:8px}
  .hint{margin:10px 0 0;font-size:11.5px;color:#6b7aa3} .hint a{color:#9fb4ff} code{color:#cdd8f5}
</style></head>
<body>
  <header>
    <h1>HMML playground</h1>
    <p>Offline bundle - no server needed. Double-click <code>open-me/*.html</code>, or drop a <code>files/*.hmml</code> onto the viewer.</p>
    <div class="links"><a class="btn" href="viewer.html">Open viewer</a><a class="btn" href="create.html">Make your own</a></div>
  </header>
  <div class="grid">${cards}</div>
</body></html>
`;
}

const README_TXT = `HMML playground - offline bundle
================================

Nothing to install. Open these straight from your file browser.

1) Double-click anything in  open-me/  - a normal web page (images inlined).

2) Open  viewer.html  in your browser, then DRAG a file from  files/  (a .hmml
   binary) onto it. It decodes and renders right there. Use  create.html  to
   build your own .hmml from your own images.

3) index.html  is an offline gallery linking to everything.

Folders
  files/          the .hmml binary documents
  open-me/        the same documents as standalone .html pages
  hmml.global.js  the library used by viewer.html / create.html

Project: https://github.com/yeargun/hmml
`;

async function main() {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(join(filesDir, "manifest.json"), "utf8"));
  } catch {
    throw new Error("No playground/files/manifest.json - run `npm run pg:build` first.");
  }

  await rm(outDir, { recursive: true, force: true });
  await mkdir(join(outDir, "files"), { recursive: true });
  await mkdir(join(outDir, "open-me"), { recursive: true });

  await cp(join(root, "dist", "index.global.js"), join(outDir, "hmml.global.js"));

  for (const tool of ["viewer.html", "create.html"]) {
    const html = (await readFile(join(here, tool), "utf8")).replace(/\.\.\/dist\/index\.global\.js/g, "hmml.global.js");
    await writeFile(join(outDir, tool), html, "utf8");
  }

  for (const f of manifest.files) {
    await cp(join(filesDir, `${f.name}.hmml`), join(outDir, "files", `${f.name}.hmml`));
    await cp(join(filesDir, `${f.name}.html`), join(outDir, "open-me", `${f.name}.html`));
  }

  await writeFile(join(outDir, "index.html"), offlineIndex(manifest), "utf8");
  await writeFile(join(outDir, "README.txt"), README_TXT, "utf8");

  // Zip it (fall back to tar.gz if zip is unavailable).
  let artifact;
  await rm(join(here, `${NAME}.zip`), { force: true });
  try {
    execSync(`zip -r -q ${NAME}.zip ${NAME}`, { cwd: here });
    artifact = join(here, `${NAME}.zip`);
  } catch {
    execSync(`tar czf ${NAME}.tar.gz ${NAME}`, { cwd: here });
    artifact = join(here, `${NAME}.tar.gz`);
  }

  const size = (await stat(artifact)).size;
  console.log(`\nBundle ready: ${artifact}  (${fmt(size)})`);
  console.log(`Contains ${manifest.files.length} docs as .hmml + standalone .html, plus viewer.html / create.html.`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
