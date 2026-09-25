import { WorkerUnavailable } from "./worker-support";
import { defaultWorkerFactory } from "./worker-factory";
import { workerReplies } from "./worker-client";
import type { DecodeInput, DecoderOptions, StreamDecodeOptions } from "./types";
import type { WorkerReply } from "./worker-protocol";


export class WorkerManager {
  private worker?: Worker;
  private starting?: Promise<Worker>;
  private unavailable?: Error;
  private disposed = false;
  private active = 0;
  private queue: Array<() => void> = [];
  private controllers = new Set<AbortController>();
  private lifetime = new AbortController();
  private max: number;
  private timeout: number;

  constructor(private options: DecoderOptions) {
    this.max = options.maxConcurrent ?? 4;
    this.timeout = options.startupTimeoutMs ?? 5000;
    if (!Number.isSafeInteger(this.max) || this.max < 1) throw new RangeError("maxConcurrent must be positive");
    if (!Number.isFinite(this.timeout) || this.timeout <= 0) throw new RangeError("startupTimeoutMs must be positive");
  }

  private start(): Promise<Worker> {
    if (this.disposed) return Promise.reject(new Error("HMML decoder disposed"));
    if (this.unavailable) return Promise.reject(this.unavailable);
    if (this.starting) return this.starting;
    this.starting = (async () => {
      const worker = (this.options.workerFactory ?? defaultWorkerFactory)();
      this.worker = worker;
      await new Promise<void>((resolve, reject) => {
        const { port1, port2 } = new MessageChannel();
        const finish = (error?: Error) => {
          clearTimeout(timer);
          worker.removeEventListener("error", failed);
          this.lifetime.signal.removeEventListener("abort", stopped);
          port1.close(); port2.close();
          error ? reject(error) : resolve();
        };
        const failed = () => finish(new Error("HMML worker startup failed"));
        const stopped = () => finish(new Error("HMML decoder disposed"));
        const timer = setTimeout(() => finish(new Error("HMML worker startup timed out")), this.timeout);
        worker.addEventListener("error", failed);
        this.lifetime.signal.addEventListener("abort", stopped, { once: true });
        port1.onmessage = ({ data }) => finish(data === "hmml:ready:2" ? undefined : new Error("Incompatible HMML worker"));
        try { worker.postMessage({ type: "hmml:ping", port: port2 }, [port2]); }
        catch { failed(); }
      });
      if (this.disposed) { worker.terminate(); throw new Error("HMML decoder disposed"); }
      // A crash fails current requests. A future call may start a fresh worker.
      worker.addEventListener("error", () => {
        if (this.worker === worker) { worker.terminate(); this.worker = undefined; this.starting = undefined; }
      });
      return worker;
    })().catch(error => {
      this.worker?.terminate();
      this.worker = undefined;
      this.unavailable = new WorkerUnavailable(error instanceof Error ? error.message : String(error));
      throw this.unavailable;
    });
    return this.starting;
  }

  private async acquire(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        const i = this.queue.indexOf(grant);
        if (i !== -1) this.queue.splice(i, 1);
        reject(signal.reason);
      };
      const grant = () => { signal.removeEventListener("abort", abort); this.active++; resolve(); };
      if (this.active < this.max) grant();
      else { this.queue.push(grant); signal.addEventListener("abort", abort, { once: true }); }
    });
    return () => { this.active--; this.queue.shift()?.(); };
  }

  async *run(input: DecodeInput, mode: "stream" | "document", options: StreamDecodeOptions): AsyncGenerator<WorkerReply> {
    if (this.disposed) throw new Error("HMML decoder disposed");
    const controller = new AbortController();
    const abort = () => controller.abort(options.signal?.reason);
    options.signal?.throwIfAborted();
    options.signal?.addEventListener("abort", abort, { once: true });
    this.controllers.add(controller);
    let release: (() => void) | undefined;
    try {
      release = await this.acquire(controller.signal);
      const worker = await new Promise<Worker>((resolve, reject) => {
        const aborted = () => reject(controller.signal.reason);
        controller.signal.addEventListener("abort", aborted, { once: true });
        this.start().then(resolve, reject).finally(() => controller.signal.removeEventListener("abort", aborted));
        if (controller.signal.aborted) aborted();
      });
      controller.signal.throwIfAborted();
      const { maxTextBytes, maxResourceBytes, maxResources, chunkSize, transfer } = options;
      yield* workerReplies(worker, input, mode, { maxTextBytes, maxResourceBytes, maxResources, chunkSize, transfer, signal: controller.signal });
    } finally {
      options.signal?.removeEventListener("abort", abort);
      this.controllers.delete(controller);
      release?.();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.lifetime.abort();
    for (const controller of this.controllers) controller.abort(new Error("HMML decoder disposed"));
    this.worker?.terminate();
    this.worker = undefined;
  }
}
