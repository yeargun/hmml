import type { HmmlDocumentData, HmmlEvent } from "./types";

/** Complete-document convenience path. Streaming callers need not load this collector. */
export async function collectDocument(events: AsyncIterable<HmmlEvent>, onMarkup?: (html: string) => void | Promise<void>): Promise<HmmlDocumentData> {
  const result: HmmlDocumentData = { version: { major: 2, minor: 0 }, codecId: 0, html: "", meta: {}, resources: new Map() };
  let current: { id: string; mime: string; parts: Uint8Array[]; length: number } | undefined;
  for await (const event of events) {
    switch (event.type) {
      case "header": result.version = event.version; result.codecId = event.codecId; break;
      case "markup": result.html = event.html; await onMarkup?.(event.html); break;
      case "metadata": result.meta = event.meta; break;
      case "resource-start":
        current = { id: event.id, mime: event.mime, parts: [], length: 0 };
        break;
      case "resource-data":
        current!.parts.push(event.data);
        current!.length += event.data.length;
        break;
      case "resource-end": {
        const { id, mime, parts, length } = current!;
        const data = new Uint8Array(length);
        let offset = 0;
        for (const part of parts) { data.set(part, offset); offset += part.length; }
        result.resources.set(id, { id, mime, data });
        current = undefined;
        break;
      }
      case "end": return result;
    }
  }
  throw new Error("Truncated HMML: missing end event");
}
