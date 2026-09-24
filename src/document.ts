import { inlineDataUris, inlineObjectUrls } from "./markup";
import type { HmmlDocument, HmmlDocumentData } from "./types";

export function documentFromData(data: HmmlDocumentData): HmmlDocument {
  const { html, resources } = data;
  return {
    ...data,
    toHTML: options => options?.resolve === "keep" ? html : inlineDataUris(html, resources),
    createObjectUrls: () => inlineObjectUrls(html, resources),
  };
}
