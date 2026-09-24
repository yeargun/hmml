import { FRAME_RUNTIME } from "./frame-runtime";
import type { HmmlDocument, HmmlEvent } from "./types";

export interface FrameOptions {
  /** CSS viewport width. The editor owns placement of the containing element. Default 100%. */
  width?: string;
  /** Fixed CSS viewport height, or content-driven height clamped below. Default 480px. */
  height?: string | "auto";
  minHeight?: number;
  maxHeight?: number;
  title?: string;
  className?: string;
  /** Application CSP nonce, if its policy requires one for the inline frame bridge. */
  nonce?: string;
  /** Total rendered media quota. The frame stores complete assets as Blobs. Default 128 MiB. */
  maxMediaBytes?: number;
  /** Bridge startup/message timeout; also catches unexpected frame navigation. Default 10000 ms. */
  timeoutMs?: number;
}

export interface FrameHandle {
  readonly element: HTMLIFrameElement;
  readonly ready: Promise<void>;
  /** Await every write for backpressure. Transfer detaches an owned data event buffer. */
  write(event: HmmlEvent, options?: { transfer?: boolean }): Promise<void>;
  /** Render a fully decoded document without detaching its resources. Use once per frame. */
  load(document: HmmlDocument): Promise<void>;
  /** Width/height are viewport dimensions, not the attachment's position in the editor. */
  resize(size: { width?: string; height?: string | "auto" }): void;
  /** Remove the frame, release its realm/Blob URLs, reject pending work. Idempotent. */
  dispose(): void;
}

/**
 * Progressive, script-disabled HTML/CSS rendering in an opaque-origin iframe.
 * No decoder or image-export library is imported. Media becomes visible at REND;
 * for incremental video playback use an application-specific media pipeline.
 */
export function createFrame(target: Element, options: FrameOptions = {}): FrameHandle {
  const min = options.minHeight ?? 32, max = options.maxHeight ?? 4096;
  const quota = options.maxMediaBytes ?? 128 * 1024 * 1024;
  const timeout = options.timeoutMs ?? 10_000;
  if (!Number.isFinite(min) || min < 0 || !Number.isFinite(max) || max < min) throw new RangeError("Invalid frame height bounds");
  if (!Number.isSafeInteger(quota) || quota < 0) throw new RangeError("Invalid frame media quota");
  if (!Number.isFinite(timeout) || timeout <= 0) throw new RangeError("Invalid frame timeout");
  let height = options.height ?? "480px";
  const key = [...crypto.getRandomValues(new Uint32Array(4))].map(n => n.toString(16).padStart(8, "0")).join("");
  const nonce = options.nonce ?? key;
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(nonce)) throw new Error("Invalid frame CSP nonce");
  const iframe = document.createElement("iframe");
  iframe.sandbox.add("allow-scripts"); // Only our nonce-bearing bridge can execute.
  iframe.referrerPolicy = "no-referrer";
  iframe.title = options.title ?? "HMML document";
  iframe.style.cssText = "display:block;border:0;background:white";
  iframe.style.width = options.width ?? "100%";
  iframe.style.height = height === "auto" ? `${min}px` : height;
  if (options.className) iframe.className = options.className;
  const csp = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline' blob: data:; img-src blob: data:; media-src blob: data:; font-src blob: data:; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'`;
  iframe.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"></head><body><script nonce="${nonce}" data-key="${key}">${FRAME_RUNTIME}</script></body></html>`;
  const { port1, port2 } = new MessageChannel();
  let dead = false, connected = false, seq = 0, contentHeight = min;
  let readyResolve!: () => void, readyReject!: (reason: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  // Handle a frame disposed before callers start consuming its ready promise.
  void ready.catch(() => {});
  const pending = new Map<number, { resolve(): void; reject(error: unknown): void; timer: ReturnType<typeof setTimeout> }>();
  const close = (reason: Error) => {
    if (dead) return;
    dead = true;
    clearTimeout(startup);
    removeEventListener("message", connect);
    readyReject(reason);
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(reason); }
    pending.clear();
    port1.close(); port2.close(); iframe.remove();
  };
  const updateHeight = () => {
    if (height === "auto") iframe.style.height = `${Math.min(max, Math.max(min, contentHeight))}px`;
  };
  const connect = (event: MessageEvent) => {
    if (connected || event.source !== iframe.contentWindow || event.origin !== "null" || event.data?.type !== "hmml:frame-ready" || event.data?.key !== key) return;
    connected = true;
    // An opaque sandbox has no targetable origin. Authenticate the source + nonce
    // above; thereafter only the transferred private MessagePort carries data.
    iframe.contentWindow!.postMessage({ key, quota }, "*", [port2]);
    removeEventListener("message", connect);
  };
  const startup = setTimeout(() => close(new Error("HMML frame startup timed out")), timeout);
  port1.onmessage = event => {
    const data = event.data;
    if (data.ready) { clearTimeout(startup); readyResolve(); return; }
    if (typeof data.height === "number" && Number.isFinite(data.height)) { contentHeight = data.height; updateHeight(); return; }
    const item = pending.get(data.seq);
    if (!item) return;
    pending.delete(data.seq); clearTimeout(item.timer);
    if (data.error) { const error = new Error(data.error); item.reject(error); close(error); }
    else item.resolve();
  };
  addEventListener("message", connect);
  target.appendChild(iframe);
  let tail = Promise.resolve();
  const handle: FrameHandle = {
    element: iframe,
    ready,
    write(event, call = {}) {
      const next = tail.then(async () => {
        await ready;
        if (dead) throw new Error("HMML frame disposed");
        if (event.type === "header" || event.type === "metadata") return;
        const transfer: Transferable[] = [];
        if (event.type === "resource-data") {
          let data = event.data;
          if (call.transfer && (!(data.buffer instanceof ArrayBuffer) || data.byteOffset !== 0 || data.byteLength !== data.buffer.byteLength)) throw new Error("Frame transfer requires a whole owned ArrayBuffer");
          if (!call.transfer) data = data.slice();
          event = { ...event, data };
          transfer.push(data.buffer as ArrayBuffer);
        }
        const id = ++seq;
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => close(new Error("HMML frame response timed out")), timeout);
          pending.set(id, { resolve, reject, timer });
          try { port1.postMessage({ seq: id, event }, transfer); }
          catch (error) { pending.delete(id); clearTimeout(timer); reject(error); }
        });
      });
      tail = next.catch(() => {});
      return next;
    },
    async load(doc) {
      await handle.write({ type: "markup", html: doc.html });
      for (const resource of doc.resources.values()) {
        await handle.write({ type: "resource-start", id: resource.id, mime: resource.mime, byteLength: resource.data.byteLength });
        for (let offset = 0; offset < resource.data.byteLength; offset += 65536) {
          await handle.write({ type: "resource-data", id: resource.id, data: resource.data.subarray(offset, offset + 65536) });
        }
        await handle.write({ type: "resource-end", id: resource.id });
      }
      await handle.write({ type: "end" });
    },
    resize(size) {
      if (dead) throw new Error("HMML frame disposed");
      if (size.width !== undefined) iframe.style.width = size.width;
      if (size.height !== undefined) { height = size.height; iframe.style.height = height === "auto" ? `${min}px` : height; updateHeight(); }
    },
    dispose() { close(new Error("HMML frame disposed")); },
  };
  return handle;
}
