import { defineConfig } from "tsup";

export default defineConfig({
  // index = the core (decode/encode/...); mount = the optional DOM renderer, kept a
  // separate entry so `import "@eddocu/hmml"` never pulls iframe/shadow code into it.
  entry: ["src/index.ts", "src/mount.ts", "src/encode.ts", "src/decode.ts",
    "src/encode-stream.ts", "src/decode-stream.ts", "src/codecs.ts", "src/markup.ts", "src/worker.ts", "src/pack.ts",
    "src/decode-direct.ts", "src/decode-stream-direct.ts", "src/decoder.ts", "src/decode-worker.ts", "src/frame.ts"],
  // esm + cjs for npm consumers; iife exposes `window.HMML` for plain <script>
  // tags (so the playground HTML works straight from file://, no bundler).
  format: ["esm", "cjs", "iife"],
  globalName: "HMML",
  dts: true,
  clean: true,
  // Aggressive size: terser with multi-pass compression + top-level mangling.
  // (Safe options only — the `unsafe_*` flags broke object-method semantics.)
  minify: "terser",
  terserOptions: {
    compress: { passes: 3, drop_debugger: true },
    mangle: { toplevel: true, reserved: ["HMML"] },
    // Keep purity metadata so consumers can remove unused factories/initializers
    // when tree shaking the already-built npm package.
    format: { comments: false, preserve_annotations: true },
  },
  treeshake: true,
  // No sourcemaps in the shipped package — consumers only need the runtime.
  sourcemap: false,
  target: "es2020",
  outExtension: ({ format }) =>
    format === "cjs" ? { js: ".cjs" } : format === "iife" ? { js: ".global.js" } : { js: ".js" },
});
