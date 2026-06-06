import { fromBase64, toBase64 } from "./base64";
import { REF_SCHEME } from "./constants";
import type { HmmlResource } from "./types";

// Matches `data:<mediatype>,<payload>` inside attribute values or CSS url().
// The payload stops at the first quote / paren / whitespace, which is exactly
// where a data URI ends in real markup.
const DATA_URI = /data:([^,]*),([^"')\s]*)/gi;

// Matches an `hmml:<id>` reference.
const REF = /hmml:([A-Za-z0-9_.\-/]+)/g;

export interface ExtractOptions {
  /** Decide whether a MIME is pulled out into a resource. Default: image/* and font/*. */
  accept?: (mime: string) => boolean;
  /** Prefix for generated resource ids. Default "r". */
  idPrefix?: string;
}

function defaultAccept(mime: string): boolean {
  return mime.startsWith("image/") || mime.startsWith("font/") || mime === "application/font-woff";
}

function toMap(resources: Map<string, HmmlResource> | HmmlResource[]): Map<string, HmmlResource> {
  if (resources instanceof Map) return resources;
  const m = new Map<string, HmmlResource>();
  for (const r of resources) m.set(r.id, r);
  return m;
}

/**
 * Pull `data:` URIs out of markup and replace them with `hmml:<id>` references.
 * Identical data URIs are de-duplicated into a single resource. The inverse of
 * {@link inlineDataUris}.
 */
export function extract(html: string, options: ExtractOptions = {}): { html: string; resources: HmmlResource[] } {
  const accept = options.accept ?? defaultAccept;
  const prefix = options.idPrefix ?? "r";
  const resources: HmmlResource[] = [];
  const seen = new Map<string, string>(); // full data uri -> id
  let counter = 0;

  const out = html.replace(DATA_URI, (match: string, meta: string, payload: string) => {
    const trimmed = meta.trim();
    const isB64 = /;base64$/i.test(trimmed);
    const mime = (trimmed.replace(/;base64$/i, "").split(";")[0] || "").trim() || "application/octet-stream";
    if (!accept(mime)) return match;

    const existing = seen.get(match);
    if (existing) return REF_SCHEME + existing;

    let data: Uint8Array;
    try {
      data = isB64 ? fromBase64(payload) : new TextEncoder().encode(decodeURIComponent(payload));
    } catch {
      return match; // malformed payload — leave untouched
    }

    const id = prefix + counter++;
    seen.set(match, id);
    resources.push({ id, mime, data });
    return REF_SCHEME + id;
  });

  return { html: out, resources };
}

/** Replace `hmml:<id>` references with self-contained base64 data URIs. */
export function inlineDataUris(html: string, resources: Map<string, HmmlResource> | HmmlResource[]): string {
  const map = toMap(resources);
  return html.replace(REF, (m: string, id: string) => {
    const r = map.get(id);
    return r ? `data:${r.mime};base64,${toBase64(r.data)}` : m;
  });
}

/**
 * Replace `hmml:<id>` references with `blob:` object URLs (browser only).
 * Returns the rewritten markup, the created URLs, and a `revoke()` to release them.
 */
export function inlineObjectUrls(
  html: string,
  resources: Map<string, HmmlResource> | HmmlResource[],
): { html: string; urls: string[]; revoke: () => void } {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function" || typeof Blob === "undefined") {
    throw new Error("inlineObjectUrls requires a browser-like environment (Blob + URL.createObjectURL).");
  }
  const map = toMap(resources);
  const cache = new Map<string, string>();
  const urls: string[] = [];
  const out = html.replace(REF, (m: string, id: string) => {
    const r = map.get(id);
    if (!r) return m;
    let u = cache.get(id);
    if (!u) {
      u = URL.createObjectURL(new Blob([r.data as BlobPart], { type: r.mime }));
      cache.set(id, u);
      urls.push(u);
    }
    return u;
  });
  return { html: out, urls, revoke: () => urls.forEach((u) => URL.revokeObjectURL(u)) };
}
