// Build first: these checks catch distribution/minification regressions which
// source-only tree-shaking tests cannot see.
import assert from 'node:assert/strict';
import test from 'node:test';
import { bundleConsumer, reachableBundle } from '../bench/bundle.mjs';

test('an unused root import disappears from the distributed package', async () => {
  const output = reachableBundle(await bundleConsumer("import '@eddocu/hmml';"));
  assert.equal(output.raw, 0);
});

for (const splitting of [false, true]) {
  test(`streaming removes complete-document and rendering code (splitting=${splitting})`, async () => {
    // Root named exports are checked as a flat bundle. For reliable splitting,
    // use the narrow entry: esbuild can retain shared chunks from unused root
    // exports when it discovers their dynamic imports before shaking the barrel.
    const entry = splitting ? '@eddocu/hmml/decode-stream' : '@eddocu/hmml';
    const result = await bundleConsumer(`export { decodeStream } from '${entry}';`, { splitting });
    const output = reachableBundle(result);
    assert.doesNotMatch(output.text, /createObjectURL|toHTML|base64|createElement|ResizeObserver|HMML chunk exceeds u32/);
    const initial = reachableBundle(result, false);
    if (splitting) {
      assert.doesNotMatch(initial.text, /MessageChannel|DecompressionStream|Truncated HMML|CRC32 mismatch/);
      assert.ok(initial.gzip < 2 * 1024, `Initial streaming client grew to ${initial.gzip} bytes gzip`);
    } else assert.ok(output.gzip < 6 * 1024, `Streaming bundle grew to ${output.gzip} bytes gzip`);
  });
}

test('narrow streaming import excludes full-document helpers without consumer tree shaking', async () => {
  const result = await bundleConsumer("export { decodeStream } from '@eddocu/hmml/decode-stream';", { treeShaking: false });
  assert.doesNotMatch(reachableBundle(result).text, /createObjectURL|toHTML|base64|createElement|ResizeObserver/);
});

test('direct-only package import has no worker machinery without consumer tree shaking', async () => {
  const result = await bundleConsumer("export { decodeStream } from '@eddocu/hmml/decode-stream/direct';", { treeShaking: false });
  assert.doesNotMatch(reachableBundle(result).text, /MessageChannel|new Worker|worker-manager|workerFactory/);
});

test('root encoder drops decoding, built-in compression and rendering', async () => {
  const result = await bundleConsumer("export { encode } from '@eddocu/hmml';");
  assert.doesNotMatch(reachableBundle(result).text, /Not an HMML|CompressionStream|MessageChannel|createObjectURL|createElement/);
});

test('complete decoding does not load rendering or encoding; initial code is only routing', async () => {
  const result = await bundleConsumer("export { decode } from '@eddocu/hmml/decode';", { splitting: true });
  assert.doesNotMatch(reachableBundle(result).text, /createElement|ResizeObserver|HMML chunk exceeds u32/);
  assert.doesNotMatch(reachableBundle(result, false).text, /createObjectURL|toHTML|MessageChannel|DecompressionStream|CRC32 mismatch/);
});

test('renderer package import has no codec/worker dependencies without consumer tree shaking', async () => {
  const result = await bundleConsumer("export { createFrame } from '@eddocu/hmml/frame';", { treeShaking: false });
  assert.doesNotMatch(reachableBundle(result).text, /Not an HMML|CompressionStream|new Worker|worker-manager/);
});

test('worker-entry side effect survives a bare import in a consumer bundle', async () => {
  const result = await bundleConsumer("import '@eddocu/hmml/worker-entry';");
  const output = reachableBundle(result);
  assert.match(output.text, /addEventListener\("message"/);
  assert.match(output.text, /hmml:ready:2/);
  assert.ok(output.raw > 0);
});
