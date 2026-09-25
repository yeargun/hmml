/** Kept separate so direct-only imports have no worker asset references. */
export function defaultWorkerFactory(): Worker {
  return new Worker(new URL("./decode-worker.js", import.meta.url), { type: "module", name: "hmml-decoder" });
}
