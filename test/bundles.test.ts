import { expect, it } from "vitest";
import { build } from "esbuild";

for (const treeShaking of [true, false]) {
  it(`direct-only builds have no worker dependency with treeShaking=${treeShaking}`, async () => {
    for (const entry of ['src/decode-direct.ts', 'src/decode-stream-direct.ts']) {
      const result = await build({ entryPoints: [entry], bundle: true, treeShaking, format: 'esm', write: false, metafile: true, logLevel: 'silent' });
      expect(Object.keys(result.metafile!.inputs).filter(path => /worker|decoder\.ts/.test(path))).toEqual([]);
      expect(result.outputFiles[0]!.text).not.toContain('new Worker');
      expect(result.outputFiles[0]!.text).not.toContain('MessageChannel');
    }
  });
}

it("a streaming import excludes encoders and the DOM renderer even without tree shaking", async () => {
  const result = await build({ entryPoints: ['src/decode-stream.ts'], bundle: true, splitting: true, treeShaking: false, format: 'esm', outdir: 'unused', write: false, metafile: true, logLevel: 'silent' });
  expect(Object.keys(result.metafile!.inputs).filter(path => /src\/(encode|pack|mount|frame|document|collect|decode-buffer|decode-direct|decode-operation|markup|base64)/.test(path))).toEqual([]);
});

it("the progressive renderer imports neither a decoder nor worker machinery without tree shaking", async () => {
  const result = await build({ entryPoints: ['src/frame.ts'], bundle: true, treeShaking: false, format: 'esm', write: false, metafile: true, logLevel: 'silent' });
  expect(Object.keys(result.metafile!.inputs).filter(path => /src\/(decode|worker|encode|markup)/.test(path))).toEqual([]);
});

it("worker host is not part of the main-thread decoder dependency graph", async () => {
  const result = await build({ entryPoints: ['src/decode.ts'], bundle: true, splitting: true, format: 'esm', outdir: 'unused', write: false, metafile: true, logLevel: 'silent' });
  expect(Object.keys(result.metafile!.inputs).filter(path => /worker-host|decode-worker\.ts/.test(path))).toEqual([]);
});
