import type { DecodeInput } from "./types";

export class WorkerUnavailable extends Error {}
export function workerInputSupported(input: DecodeInput): boolean {
  return typeof input === "string" || input instanceof URL || input instanceof Uint8Array ||
    (typeof Blob !== "undefined" && input instanceof Blob) ||
    (typeof ReadableStream !== "undefined" && input instanceof ReadableStream);
}
