// mount() — render a decoded HMML document into the page under an explicit trust
// tier. Secure by default: with no options, scripts never run.
//
// The hard truth this module encodes: you cannot make untrusted JS "safe" by
// inspecting it. Safety comes from *confinement* by the browser, not inspection.
// And only ONE primitive confines JS — a sandboxed iframe. Shadow DOM encapsulates
// styles + DOM (which fixes class-name collisions) but a <script> in a shadow root
// runs in the host's global with full access. So:
//
//   static   — Shadow DOM, scripts stripped (native Sanitizer). Lightest, inline,
//              CSS-isolated. The default. No JS, ever.
//   sandbox  — iframe sandbox="allow-scripts" (NEVER allow-same-origin) + a CSP.
//              JS runs but in an opaque origin: no parent DOM, no host cookies/
//              storage, and `connect-src 'none'` cuts the network (no exfiltration).
//   isolated — sandbox, but loaded from a SEPARATE origin you host. Defense in depth
//              for hostile content; requires an `origin` serving the loader.
//
// Only `static` is a value-add over a raw iframe and the only one that needs care,
// so it leans on the platform Sanitizer (or a caller-supplied one) instead of a
// home-grown scrubber — and refuses to inject unsanitized markup into the live DOM.
import { inlineObjectUrls } from "./markup";
import type { HmmlDocument } from "./types";

export type Trust = "static" | "sandbox" | "isolated";

export interface MountOptions {
  /** Trust tier. Default "static" — secure by default, scripts stripped. */
  trust?: Trust;
  /**
   * static-only: sanitize the markup with this function instead of the native
   * `Element.setHTML()`. Provide e.g. DOMPurify on browsers without the Sanitizer
   * API. Receives the body markup, must return sanitized markup.
   */
  sanitizer?: (html: string) => string;
  /** sandbox/isolated: override the iframe Content-Security-Policy. */
  csp?: string;
  /**
   * sandbox/isolated: extra iframe `sandbox` tokens (e.g. "allow-forms").
   * "allow-same-origin" is always stripped — it would void the jail.
   */
  sandboxTokens?: string[];
  /**
   * sandbox/isolated: iframe height. Jailed (cross-origin) content cannot report
   * its own size to the host, so this can't be inferred. Default "480px".
   */
  height?: string;
  /** Class applied to the created host element (shadow host or iframe). */
  className?: string;
  /** isolated-only: origin (e.g. "https://sandbox.example.com/hmml") hosting the loader. */
  origin?: string;
}

export interface MountHandle {
  /** The tier actually used (static may fall back to sandbox if it can't sanitize). */
  readonly trust: Trust;
  /** The created element: a shadow host (static) or an iframe (sandbox/isolated). */
  readonly element: HTMLElement;
  /** Remove the element and release any object URLs. Idempotent. */
  dispose(): void;
}

/**
 * The CSP applied inside sandbox/isolated frames. The opaque origin already blocks
 * host access; this additionally cuts the network (`connect-src 'none'`) and pins
 * every resource to in-document bytes (blob:/data:). `script-src 'unsafe-inline'`
 * is intentional — the *confinement* is the sandbox, not script gating.
 */
export const DEFAULT_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
  "img-src blob: data:; media-src blob: data:; font-src blob: data:; " +
  "connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";

function hostMissingDom(): never {
  throw new Error("mount() requires a browser-like environment (document, DOMParser, iframe).");
}

/** Inject a CSP <meta> as the first thing in <head> (works inside srcdoc). */
function withCsp(html: string, csp: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp.replace(/"/g, "&quot;")}">`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + meta);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => m + `<head>${meta}</head>`);
  return `<!doctype html><html><head>${meta}</head><body>${html}</body></html>`;
}

function makeIframe(opts: MountOptions): HTMLIFrameElement {
  const iframe = document.createElement("iframe");
  const tokens = new Set(["allow-scripts", ...(opts.sandboxTokens ?? [])]);
  tokens.delete("allow-same-origin"); // never — re-grants the host origin, voiding the jail
  iframe.setAttribute("sandbox", [...tokens].join(" "));
  iframe.setAttribute("referrerpolicy", "no-referrer");
  iframe.style.cssText = `width:100%;height:${opts.height ?? "480px"};border:0;display:block;background:#fff`;
  if (opts.className) iframe.className = opts.className;
  return iframe;
}

function mountSandbox(target: Element, doc: HmmlDocument, opts: MountOptions): MountHandle {
  const iframe = makeIframe(opts);
  // Opaque-origin frames can't read the host's blob: URLs, so resources must travel
  // inline as data: URIs (CSP allows img/media/font-src data:).
  iframe.srcdoc = withCsp(doc.toHTML(), opts.csp ?? DEFAULT_CSP);
  target.appendChild(iframe);
  let live = true;
  return { trust: "sandbox", element: iframe, dispose() { if (live) { live = false; iframe.remove(); } } };
}

function mountIsolated(target: Element, doc: HmmlDocument, opts: MountOptions): MountHandle {
  if (!opts.origin) {
    throw new Error("trust:'isolated' needs an `origin` serving the HMML loader (see createSandboxLoaderHtml).");
  }
  const loaderOrigin = new URL(opts.origin).origin;
  const iframe = makeIframe(opts);
  const html = withCsp(doc.toHTML(), opts.csp ?? DEFAULT_CSP);
  const buf = new Uint32Array(2);
  (globalThis.crypto ?? ({} as Crypto)).getRandomValues?.(buf);
  const channel = `${buf[0]!.toString(36)}${buf[1]!.toString(36)}`;

  const onMsg = (e: MessageEvent) => {
    if (e.source !== iframe.contentWindow || e.origin !== loaderOrigin) return;
    if ((e.data as any)?.type === "hmml:ready" && (e.data as any).channel === channel) {
      iframe.contentWindow!.postMessage({ type: "hmml:doc", channel, html }, loaderOrigin);
    }
  };
  addEventListener("message", onMsg);
  iframe.src = opts.origin + (opts.origin.includes("?") ? "&" : "?") + "ch=" + channel;
  target.appendChild(iframe);
  let live = true;
  return {
    trust: "isolated",
    element: iframe,
    dispose() { if (live) { live = false; removeEventListener("message", onMsg); iframe.remove(); } },
  };
}

function mountStatic(target: Element, doc: HmmlDocument, opts: MountOptions): MountHandle {
  const host = document.createElement("div");
  if (opts.className) host.className = opts.className;
  const shadow = host.attachShadow({ mode: "open" });

  // Resources → blob: URLs (cheap to paint; valid in this same-origin shadow tree).
  const { html, revoke } = inlineObjectUrls(doc.html, doc.resources);

  // Parse inertly (DOMParser never executes scripts), lift <style> out as trusted
  // inert nodes (CSS can't run JS), then sanitize only the body markup.
  const parsed = new DOMParser().parseFromString(html, "text/html");
  for (const s of [...parsed.querySelectorAll("style")]) {
    const style = document.createElement("style");
    style.textContent = s.textContent ?? "";
    shadow.appendChild(style);
    s.remove();
  }
  const body = parsed.body?.innerHTML ?? "";
  const slot = document.createElement("div");
  slot.style.display = "contents";

  const native = (slot as unknown as { setHTML?: (s: string) => void }).setHTML;
  if (opts.sanitizer) {
    slot.innerHTML = opts.sanitizer(body); // caller-vetted sanitizer (e.g. DOMPurify)
  } else if (typeof native === "function") {
    native.call(slot, body); // platform Sanitizer — strips scripts/handlers/dangerous URLs
  } else {
    // No way to sanitize safely → don't risk the live DOM; use the browser sandbox.
    revoke();
    if (typeof console !== "undefined") {
      console.warn("[hmml] No Sanitizer API and no `sanitizer` option; using trust:'sandbox' for safety.");
    }
    return mountSandbox(target, doc, opts);
  }

  shadow.appendChild(slot);
  target.appendChild(host);
  let live = true;
  return {
    trust: "static",
    element: host,
    dispose() { if (live) { live = false; revoke(); host.remove(); } },
  };
}

/**
 * Render a decoded HMML document into `target`. Secure by default (`trust:'static'`
 * strips all scripts). Opt into JS with `trust:'sandbox'` (jailed) or
 * `trust:'isolated'` (jailed + a separate origin).
 */
export function mount(target: Element, doc: HmmlDocument, options: MountOptions = {}): MountHandle {
  if (typeof document === "undefined" || typeof DOMParser === "undefined") hostMissingDom();
  switch (options.trust ?? "static") {
    case "sandbox":
      return mountSandbox(target, doc, options);
    case "isolated":
      return mountIsolated(target, doc, options);
    default:
      return mountStatic(target, doc, options);
  }
}

/**
 * The HTML for the `isolated` loader page — deploy it on a SEPARATE origin from your
 * app and pass that URL as `origin`. It receives the document over postMessage from
 * the embedder and writes it; being cross-origin, it can never touch your app even
 * if the inner document misbehaves. Serve it with a strong CSP response header too.
 */
export function createSandboxLoaderHtml(): string {
  return (
    "<!doctype html><meta charset=utf-8><title>hmml sandbox</title>" +
    "<script>(function(){var c=new URLSearchParams(location.search).get('ch');" +
    "addEventListener('message',function(e){var d=e.data;" +
    "if(d&&d.type==='hmml:doc'&&d.channel===c){document.open();document.write(d.html);document.close();}});" +
    "parent.postMessage({type:'hmml:ready',channel:c},'*');})();<\/script>"
  );
}
