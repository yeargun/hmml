import type { DecodeInput, HmmlEvent, StreamDecodeOptions } from "./types";
import type { WorkerInput, WorkerReply, WorkerRequest } from "./worker-protocol";

export type WorkerDecodeOptions = Omit<StreamDecodeOptions, "worker" | "codec">;

/** One request/port; no worker ownership or hidden retries. */
export async function* workerReplies(worker: Worker, input: DecodeInput, mode: "stream" | "document", options: WorkerDecodeOptions = {}): AsyncGenerator<WorkerReply> {
  const { signal, transfer = false, ...limits } = options;
  signal?.throwIfAborted();
  const { port1, port2 } = new MessageChannel();
  let pending: { resolve: (reply: WorkerReply) => void; reject: (reason: unknown) => void } | undefined;
  let failure: { reason: unknown } | undefined;
  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    signal?.removeEventListener("abort", abort);
    worker.removeEventListener("error", error);
    port1.postMessage("cancel");
    port1.close();
    port2.close();
  };
  const fail = (reason: unknown) => {
    failure = { reason };
    pending?.reject(reason);
    pending = undefined;
    cleanup();
  };
  const abort = () => fail(signal?.reason ?? new Error("HMML decode aborted"));
  const error = () => fail(new Error("HMML worker failed"));
  port1.onmessage = ({ data }: MessageEvent<WorkerReply>) => { pending?.resolve(data); pending = undefined; };
  port1.onmessageerror = error;
  worker.addEventListener("error", error);
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const transfers: Transferable[] = [port2];
    let sent: WorkerInput;
    if (typeof input === "string" || input instanceof URL) {
      const base = typeof document !== "undefined" ? document.baseURI : typeof location !== "undefined" ? location.href : undefined;
      sent = new URL(String(input), base).href;
    } else if (input instanceof Uint8Array) {
      if (transfer && (!(input.buffer instanceof ArrayBuffer) || input.byteOffset !== 0 || input.byteLength !== input.buffer.byteLength)) {
        throw new Error("transfer requires a Uint8Array owning its entire ArrayBuffer");
      }
      sent = transfer ? input : input.slice();
      transfers.push(sent.buffer as ArrayBuffer);
    } else if (typeof ReadableStream !== "undefined" && input instanceof ReadableStream) {
      sent = input;
      transfers.push(input);
    } else if (typeof Blob !== "undefined" && input instanceof Blob) {
      sent = input;
    } else throw new Error("Async iterable inputs require direct decoding or an application-owned worker");
    const request: WorkerRequest = { type: "hmml:decode", input: sent, mode, options: limits, port: port2 };
    worker.postMessage(request, transfers);
    for (;;) {
      signal?.throwIfAborted();
      if (failure) throw failure.reason;
      const reply = await new Promise<WorkerReply>((resolve, reject) => {
        pending = { resolve, reject };
        port1.postMessage("pull");
      });
      if ("error" in reply) throw new Error(reply.error);
      if ("done" in reply) return;
      yield reply;
      if ("document" in reply || ("event" in reply && reply.event.type === "end")) return;
    }
  } finally {
    cleanup();
  }
}

/** Low-level streaming bridge for an application-owned worker; no worker starts on import. */
export async function* decodeInWorker(worker: Worker, input: DecodeInput, options: WorkerDecodeOptions = {}): AsyncGenerator<HmmlEvent> {
  for await (const reply of workerReplies(worker, input, "stream", options)) {
    if ("event" in reply) yield reply.event;
  }
}
