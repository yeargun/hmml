// Measure actual package exports, including consumers which retain code splitting.
import { bundleConsumer, reachableBundle } from './bundle.mjs';

const shapes = [
  ['pack + unpack', "export { pack, unpack } from '@eddocu/hmml';"],
  ['decode/direct', "export { decode } from '@eddocu/hmml/decode/direct';"],
  ['decode-stream/direct', "export { decodeStream } from '@eddocu/hmml/decode-stream/direct';"],
  ['decoder instance', "export { createDecoder } from '@eddocu/hmml/decoder';"],
  ['worker implementation', "import '@eddocu/hmml/worker-entry';"],
  ['decode (auto worker)', "export { decode } from '@eddocu/hmml/decode';"],
  ['encode + extract', "export { encode, extract } from '@eddocu/hmml';"],
  ['decodeStream (auto worker)', "export { decodeStream } from '@eddocu/hmml/decode-stream';"],
  ['root decodeStream', "export { decodeStream } from '@eddocu/hmml';"],
  ['encodeStream', "export { encodeStream } from '@eddocu/hmml';"],
  ['worker client', "export { decodeInWorker } from '@eddocu/hmml/worker';"],
  ['progressive iframe', "export { createFrame } from '@eddocu/hmml/frame';"],
  ['all root exports', "export * from '@eddocu/hmml';"],
];
const kb = n => (n / 1024).toFixed(2).padStart(7);
console.log('Built package ESM, minified KiB (gzip level 9):');
console.log('Import                          Flat raw  Flat gzip  Flat br  Initial gzip');
for (const [label, source] of shapes) {
  const flat = reachableBundle(await bundleConsumer(source));
  const initial = reachableBundle(await bundleConsumer(source, { splitting: true }), false);
  console.log(label.padEnd(30), kb(flat.raw), kb(flat.gzip), kb(flat.brotli), kb(initial.gzip));
}
console.log('Flat = all dynamically reachable main-realm JS in one bundle.');
console.log('Initial = sum of individually gzipped static entry/chunks with ESM splitting.');
console.log('Worker URL assets are separate; neither measure includes them or HTTP headers.');
