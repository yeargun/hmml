import type { HmmlDocumentData, HmmlEvent } from "./types";
import type { WorkerReply, WorkerRequest } from "./worker-protocol";

interface WorkerScope {
  addEventListener(type: "message", listener: (event: MessageEvent<WorkerRequest>) => void): void;
}

/** Install once in a dedicated module worker. The host never creates nested workers. */
export function serveDecodeWorker(scope: WorkerScope): void {
  scope.addEventListener("message", ({ data }) => {
    if (data?.type === "hmml:ping") {
      data.port.postMessage("hmml:ready:2");
      data.port.close();
      return;
    }
    if (data?.type !== "hmml:decode" || !data.port) return;
    const { port } = data;
    const controller = new AbortController();
    let iterator: AsyncGenerator<HmmlEvent> | undefined;
    let busy = false;
    let cancelled = false;
    let resume: (() => void) | undefined;
    const cleanup = async () => {
      controller.abort();
      resume?.();
      try { await iterator?.return(undefined); } catch { /* cancellation cleanup */ }
      finally { port.close(); }
    };
    port.onmessage = async ({ data: command }) => {
      if (command === "cancel") {
        cancelled = true;
        controller.abort();
        resume?.();
        if (!busy) await cleanup();
        return;
      }
      if (command !== "pull" || cancelled) return;
      if (resume) { const next = resume; resume = undefined; next(); return; }
      if (busy) return;
      busy = true;
      try {
        if (data.mode === "document") {
          const onMarkup = async (html: string) => {
            // Pause until the application has handled the blueprint. This is one
            // round trip, not one message exchange per media chunk.
            await new Promise<void>(resolve => {
              resume = resolve;
              port.postMessage({ event: { type: "markup", html } } satisfies WorkerReply);
            });
            controller.signal.throwIfAborted();
          };
          let document: HmmlDocumentData;
          if (data.input instanceof Uint8Array) {
            const { decodeBuffer } = await import("./decode-buffer");
            const result = await decodeBuffer(data.input, { ...data.options, signal: controller.signal, onMarkup });
            const { version, codecId, html, resources, meta } = result;
            document = { version, codecId, html, resources, meta };
          } else {
            const [{ decodeStream }, { collectDocument }] = await Promise.all([import("./decode-stream-direct"), import("./collect")]);
            iterator = decodeStream(data.input, { ...data.options, signal: controller.signal });
            document = await collectDocument(iterator, onMarkup);
          }
          if (!cancelled) {
            port.postMessage({ document } satisfies WorkerReply, [...document.resources.values()].map(r => r.data.buffer as ArrayBuffer));
          }
          cancelled = true;
        } else {
          if (!iterator) {
            const { decodeStream } = await import("./decode-stream-direct");
            iterator = decodeStream(data.input, { ...data.options, signal: controller.signal });
          }
          const next = await iterator.next();
          if (!cancelled) {
            if (next.done) { port.postMessage({ done: true } satisfies WorkerReply); cancelled = true; }
            else {
              const event = next.value;
              port.postMessage({ event } satisfies WorkerReply, event.type === "resource-data" ? [event.data.buffer as ArrayBuffer] : []);
              if (event.type === "end") cancelled = true;
            }
          }
        }
      } catch (error) {
        if (!cancelled) port.postMessage({ error: error instanceof Error ? error.message : String(error) } satisfies WorkerReply);
        cancelled = true;
      } finally {
        busy = false;
        if (cancelled) await cleanup();
      }
    };
  });
}
