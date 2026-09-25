import type { DecodeInput, DirectStreamDecodeOptions, HmmlDocumentData, HmmlEvent } from "./types";
export type WorkerInput = Exclude<DecodeInput, URL | AsyncIterable<Uint8Array>>;
export type WireOptions = Omit<DirectStreamDecodeOptions, "codec" | "signal">;
export type WorkerReply = { event: HmmlEvent } | { document: HmmlDocumentData } | { done: true } | { error: string };
export type WorkerRequest =
  | { type: "hmml:ping"; port: MessagePort }
  | { type: "hmml:decode"; input: WorkerInput; mode: "stream" | "document"; options: WireOptions; port: MessagePort };
