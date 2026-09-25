import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, brotliCompressSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Exercise package.json exports and the actual distributed ESM, as an app does. */
export function bundleConsumer(contents, { splitting = false, treeShaking = true } = {}) {
  return build({
    stdin: { contents, resolveDir: root },
    absWorkingDir: root, bundle: true, minify: true, splitting, treeShaking,
    format: 'esm', target: 'es2020', outdir: resolve(root, '.bundle-metrics'),
    write: false, metafile: true, legalComments: 'none', logLevel: 'silent',
  });
}

/** Ignore orphan output chunks; count modules actually reachable from the app. */
export function reachableBundle(result, includeDynamic = true) {
  const outputs = new Map(Object.entries(result.metafile.outputs).map(([name, data]) => [resolve(root, name), data]));
  const entry = [...outputs].find(([, info]) => info.entryPoint === '<stdin>')[0];
  const seen = new Set();
  const visit = name => {
    if (seen.has(name)) return;
    seen.add(name);
    for (const item of outputs.get(name).imports) {
      if (!item.external && (includeDynamic || item.kind !== 'dynamic-import')) visit(resolve(root, item.path));
    }
  };
  visit(entry);
  const files = result.outputFiles.filter(file => seen.has(file.path));
  return {
    text: files.map(file => file.text).join('\n'),
    raw: files.reduce((sum, file) => sum + file.contents.length, 0),
    gzip: files.reduce((sum, file) => sum + gzipSync(file.contents, { level: 9 }).length, 0),
    brotli: files.reduce((sum, file) => sum + brotliCompressSync(file.contents).length, 0),
    files: files.length,
  };
}
