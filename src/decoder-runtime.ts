import { WorkerUnavailable, workerInputSupported } from "./worker-support";
import type { DecodeInput, DecodeOptions, DecoderOptions, StreamDecodeOptions, WorkerMode } from "./types";
import type { WorkerReply } from "./worker-protocol";
import type { WorkerManager } from "./worker-manager";

interface Execution {
  signal: AbortSignal;
  /** Absent when this call should use its direct implementation. */
  reply?: WorkerReply;
}
export interface DecoderRuntime {
  run(input: DecodeInput, kind: "stream" | "document", call: DecodeOptions | StreamDecodeOptions): AsyncGenerator<Execution>;
  dispose(): void;
}

/** Shared lifecycle/routing only: no document collector, resolvers, or parser imports. */
export function createDecoderRuntime(config: DecoderOptions = {}): DecoderRuntime {
  const lifetime = new AbortController();
  let manager: Promise<WorkerManager> | undefined;
  let disposed = false;
  const options = { ...config };
  // Validate configuration before starting work, even if a worker is unavailable.
  if (options.maxConcurrent !== undefined && (!Number.isSafeInteger(options.maxConcurrent) || options.maxConcurrent < 1)) throw new RangeError("maxConcurrent must be positive");
  if (options.startupTimeoutMs !== undefined && (!Number.isFinite(options.startupTimeoutMs) || options.startupTimeoutMs <= 0)) throw new RangeError("startupTimeoutMs must be positive");

  const getManager = () => manager ??= import("./worker-manager").then(({ WorkerManager }) => {
    const instance = new WorkerManager(options);
    if (disposed) instance.dispose();
    return instance;
  }, () => { throw new WorkerUnavailable("Could not load HMML worker support"); });

  const useWorker = (input: DecodeInput, mode: WorkerMode, codec: unknown): boolean => {
    if (mode === false) return false;
    const available = (typeof Worker !== "undefined" && typeof document !== "undefined") || !!options.workerFactory;
    if (!available || codec || !workerInputSupported(input)) {
      if (mode === true) throw new WorkerUnavailable(codec ? "Custom codecs require direct decoding or an application-owned worker" : "HMML worker unavailable for this runtime/input");
      return false;
    }
    return true;
  };

  const operation = (signal?: AbortSignal) => {
    if (disposed) throw new Error("HMML decoder disposed");
    signal?.throwIfAborted();
    const controller = new AbortController();
    const fromUser = () => controller.abort(signal?.reason);
    const fromLifetime = () => controller.abort(new Error("HMML decoder disposed"));
    signal?.addEventListener("abort", fromUser, { once: true });
    lifetime.signal.addEventListener("abort", fromLifetime, { once: true });
    return {
      signal: controller.signal,
      close() { signal?.removeEventListener("abort", fromUser); lifetime.signal.removeEventListener("abort", fromLifetime); },
    };
  };

  return {
    async *run(input, kind, call) {
      const op = operation(call.signal);
      const mode = call.worker ?? options.worker ?? "auto";
      try {
        if (useWorker(input, mode, call.codec)) {
          try {
            const worker = await getManager();
            for await (const reply of worker.run(input, kind, { ...call, signal: op.signal })) {
              op.signal.throwIfAborted();
              yield { reply, signal: op.signal };
            }
            return;
          } catch (error) {
            op.signal.throwIfAborted();
            // Only startup failures fall back; never replay dispatched requests.
            if (mode !== "auto" || !(error instanceof WorkerUnavailable)) throw error;
          }
        }
        op.signal.throwIfAborted();
        yield { signal: op.signal };
      } finally { op.close(); }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      lifetime.abort();
      void manager?.then(instance => instance.dispose(), () => {});
    },
  };
}

let shared: DecoderRuntime | undefined;
export function defaultRuntime(): DecoderRuntime { return shared ??= createDecoderRuntime(); }
/** Dispose/reset the module's shared decoder, e.g. when the editor closes. */
export function disposeDecoder(): void { shared?.dispose(); shared = undefined; }
