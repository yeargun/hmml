// Compare stored bytes separately from HTTP gzip bytes. Fixtures are local and reproducible.
import { readFile, readdir } from 'node:fs/promises';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { encode } from '../dist/encode.js';
import { gzipCodec } from '../dist/codecs.js';
import { inlineDataUris } from '../dist/markup.js';

const te = new TextEncoder();
const cases = [{ name: 'tiny markup', html: '<p>Hello</p>', resources: [] },
  { name: 'repeated markup', html: '<article class="card"><h2>Title</h2><p>Document content.</p></article>'.repeat(500), resources: [] }];
let html = await readFile(new URL('../food-webpage/index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../food-webpage/snipped.css', import.meta.url), 'utf8');
html = html.replace(/<link[^>]+href="[^"]*snipped\.css"[^>]*>/, `<style>${css}</style>`);
const resources = [];
for (const file of (await readdir(new URL('../food-webpage/images/', import.meta.url))).sort()) {
  const ref = `./images/${file}`;
  if (!html.includes(ref)) continue;
  const id = `r${resources.length}`;
  const extension = file.split('.').pop();
  const mime = ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', png: 'image/png', webp: 'image/webp' })[extension];
  if (!mime) continue;
  const data = new Uint8Array(await readFile(new URL(`../food-webpage/images/${file}`, import.meta.url)));
  resources.push({ id, mime, data });
  html = html.split(ref).join(`hmml:${id}`);
}
cases.push({ name: 'food page + real media', html, resources });
const sizes = bytes => ({ stored: bytes.length, httpGzip: gzipSync(bytes, { level: 6 }).length, httpBrotli: brotliCompressSync(bytes).length });
console.log(`Node ${process.version}. Bytes; gzip level 6, Brotli default. No network latency modeled.`);
for (const input of cases) {
  const store = await encode(input);
  const internal = await encode(input, { codec: gzipCodec });
  const base64 = te.encode(inlineDataUris(input.html, input.resources));
  console.log(`\n${input.name}: markup ${te.encode(input.html).length} B, media ${input.resources.reduce((n, r) => n + r.data.length, 0)} B`);
  console.table({ 'base64 HTML': sizes(base64), 'HMML store': sizes(store), 'HMML text gzip': sizes(internal) });
}
