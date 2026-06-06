// Measures how small the library bundles for end users. Bundles a few import
// shapes with esbuild (minified) and reports raw / gzip / brotli sizes.
//
//   node bench/size.mjs
import { build } from "esbuild";
import { rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, gzipSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const index = join(here, "..", "src", "index.ts").replace(/\\/g, "/");

async function measure(label, entry) {
  const tmp = join(here, "_entry.tmp.ts");
  await writeFile(tmp, entry);
  const res = await build({ entryPoints: [tmp], bundle: true, minify: true, format: "esm", target: "es2020", write: false, legalComments: "none" });
  await rm(tmp, { force: true });
  const buf = Buffer.from(res.outputFiles[0].contents);
  return { label, min: buf.length, gzip: gzipSync(buf, { level: 9 }).length, brotli: brotliCompressSync(buf).length };
}

const kb = (n) => (n / 1024).toFixed(2) + " KB";

const rows = [];
rows.push(await measure("pack + unpack (typical app)", `export { pack, unpack } from "${index}";`));
rows.push(await measure("decode only (the reader)", `export { decode } from "${index}";`));
rows.push(await measure("encode + extract (the writer)", `export { encode, extract } from "${index}";`));
rows.push(await measure("everything", `export * from "${index}";`));

const w = Math.max(...rows.map((r) => r.label.length));
console.log("\nBundle sizes (minified):\n");
console.log("  " + "import".padEnd(w) + "   raw       gzip      brotli");
console.log("  " + "-".repeat(w) + "   -------   -------   -------");
for (const r of rows) {
  console.log("  " + r.label.padEnd(w) + "   " + kb(r.min).padStart(7) + "   " + kb(r.gzip).padStart(7) + "   " + kb(r.brotli).padStart(7));
}
console.log("");
