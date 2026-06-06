import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  // esm + cjs for npm consumers; iife exposes `window.HMML` for plain <script>
  // tags (so the playground HTML works straight from file://, no bundler).
  format: ["esm", "cjs", "iife"],
  globalName: "HMML",
  dts: true,
  clean: true,
  minify: true,
  sourcemap: true,
  target: "es2020",
  outExtension: ({ format }) =>
    format === "cjs" ? { js: ".cjs" } : format === "iife" ? { js: ".global.js" } : { js: ".js" },
});
