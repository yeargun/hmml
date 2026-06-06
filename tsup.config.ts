import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
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
    format: { comments: false },
  },
  treeshake: true,
  // No sourcemaps in the shipped package — consumers only need the runtime.
  sourcemap: false,
  target: "es2020",
  outExtension: ({ format }) =>
    format === "cjs" ? { js: ".cjs" } : format === "iife" ? { js: ".global.js" } : { js: ".js" },
});
