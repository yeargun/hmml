import type { ByteSource } from "./types";

/** Own the reader for the duration of iteration, including error/early-return cleanup. */
export async function* sourceBytes(source: ByteSource, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
  if (!("getReader" in source)) {
    for await (const bytes of source) {
      signal?.throwIfAborted();
      if (!(bytes instanceof Uint8Array)) throw new TypeError("HMML source must yield Uint8Array");
      if (bytes.length) yield bytes;
    }
    signal?.throwIfAborted();
    return;
  }
  const reader = source.getReader();
  let ended = false;
  const abort = () => { void reader.cancel(signal?.reason).catch(() => {}); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) { ended = true; return; }
      if (!(value instanceof Uint8Array)) throw new TypeError("HMML source must yield Uint8Array");
      if (value.length) yield value;
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    try { if (!ended) await reader.cancel(); } finally { reader.releaseLock(); }
  }
}

/** Pull only when needed; keep one upstream chunk, never concatenate the download. */
export class StreamReader {
  private bytes: Uint8Array = new Uint8Array(0);
  private offset = 0;
  constructor(private source: AsyncIterator<Uint8Array>) {}

  async part(max: number): Promise<Uint8Array | undefined> {
    if (this.offset === this.bytes.length) {
      const next = await this.source.next();
      if (next.done) return undefined;
      this.bytes = next.value;
      this.offset = 0;
    }
    const end = Math.min(this.bytes.length, this.offset + max);
    const result = this.bytes.subarray(this.offset, end);
    this.offset = end;
    return result;
  }

  async exact(length: number, allowEOF = false): Promise<Uint8Array | undefined> {
    if (!length) return new Uint8Array(0);
    const first = await this.part(length);
    if (!first) {
      if (allowEOF) return undefined;
      throw new Error("Truncated HMML stream");
    }
    if (first.length === length) return first;
    const result = new Uint8Array(length);
    result.set(first);
    let offset = first.length;
    while (offset < length) {
      const next = await this.part(length - offset);
      if (!next) throw new Error("Truncated HMML stream");
      result.set(next, offset);
      offset += next.length;
    }
    return result;
  }
}
