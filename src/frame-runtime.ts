// Executed only inside the opaque-origin frame. A string keeps this bootstrap
// independent of bundler helpers and lexical variables in the parent bundle.
export const FRAME_RUNTIME = String.raw`
(() => {
  const key = document.currentScript.dataset.key;
  let port, observer, pending = false, lastHeight = -1, blueprint = false, active;
  let total = 0, quota = 0;
  const urls = new Map(), bindings = new Map(), ids = new Set();
  const refs = /hmml:([A-Za-z0-9_.\-/]+)/g;
  const measure = () => {
    if (pending || !document.body) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      const body = document.body, css = getComputedStyle(body);
      const height = Math.ceil(Math.max(body.scrollHeight, body.getBoundingClientRect().height)
        + (parseFloat(css.marginTop) || 0) + (parseFloat(css.marginBottom) || 0));
      if (height !== lastHeight) { lastHeight = height; port.postMessage({ height }); }
    });
  };
  const apply = binding => {
    const value = binding.value.replace(refs, (match, id) => urls.get(id) || match);
    if (binding.attr) binding.node.setAttribute(binding.attr, value);
    else binding.node.textContent = value;
    // Changing a <source> needs an explicit reload. Updating a poster/style must
    // not restart media that is already playing; video/audio src handles itself.
    if (binding.attr === 'src' && binding.node.localName === 'source') {
      const media = binding.node.closest('video,audio');
      if (media) media.load();
    }
  };
  const bind = (node, attr, value) => {
    const matches = [...value.matchAll(refs)];
    if (!matches.length) return;
    const binding = { node, attr, value };
    for (const id of new Set(matches.map(match => match[1]))) {
      if (!bindings.has(id)) bindings.set(id, new Set());
      bindings.get(id).add(binding);
    }
  };
  const receive = async event => {
    const { seq, event: item } = event.data;
    try {
      switch (item.type) {
        case 'markup': {
          if (blueprint) throw new Error('Frame already has a blueprint; create another frame to replace it');
          blueprint = true;
          // DOMParser may fetch images even in an otherwise inert document. Put
          // the policy before supplied markup in that parser's document too.
          const sourcePolicy = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
          const parsed = new DOMParser().parseFromString(sourcePolicy.outerHTML + item.html, 'text/html');
          // The bridge is the only script allowed by the existing nonce CSP.
          // Keep document content from replacing policy or navigating via refresh.
          parsed.querySelectorAll('script,base,meta[http-equiv]').forEach(node => node.remove());
          const policy = sourcePolicy.cloneNode(true);
          parsed.head.prepend(policy);
          document.replaceChild(document.importNode(parsed.documentElement, true), document.documentElement);
          for (const node of document.querySelectorAll('*')) {
            for (const attr of node.attributes) bind(node, attr.name, attr.value);
            if (node.localName === 'style') bind(node, null, node.textContent);
          }
          observer = new ResizeObserver(measure);
          observer.observe(document.body);
          addEventListener('resize', measure);
          document.addEventListener('load', measure, true);
          document.addEventListener('click', event => {
            const link = event.target.closest?.('a,area');
            if (link && !(link.getAttribute('href') || '').startsWith('#')) event.preventDefault();
          }, true);
          document.fonts.ready.then(measure);
          measure();
          break;
        }
        case 'resource-start':
          if (!blueprint || active || ids.has(item.id)) throw new Error('Invalid frame resource sequence');
          if (item.byteLength !== undefined && item.byteLength > quota - total) throw new Error('Frame media quota exceeded');
          ids.add(item.id);
          active = { id: item.id, mime: item.mime, length: item.byteLength, size: 0, parts: [] };
          break;
        case 'resource-data':
          if (!active || active.id !== item.id) throw new Error('Invalid frame data sequence');
          total += item.data.byteLength;
          active.size += item.data.byteLength;
          if (total > quota) throw new Error('Frame media quota exceeded');
          active.parts.push(new Blob([item.data]));
          break;
        case 'resource-end': {
          if (!active || active.id !== item.id) throw new Error('Invalid frame end sequence');
          if (active.length !== undefined && active.size !== active.length) throw new Error('Frame resource length mismatch');
          const url = URL.createObjectURL(new Blob(active.parts, { type: active.mime }));
          urls.set(active.id, url);
          for (const binding of bindings.get(active.id) || []) apply(binding);
          active = undefined;
          measure();
          break;
        }
        case 'end':
          if (!blueprint || active) throw new Error('Incomplete frame document');
          break;
      }
      port.postMessage({ seq });
    } catch (error) {
      active = undefined;
      port.postMessage({ seq, error: error.message });
    }
  };
  const connect = event => {
    if (event.source !== parent || event.data?.key !== key || !event.ports[0] || port) return;
    removeEventListener('message', connect);
    port = event.ports[0];
    quota = event.data.quota;
    port.onmessage = receive;
    port.postMessage({ ready: true });
  };
  addEventListener('message', connect);
  parent.postMessage({ type: 'hmml:frame-ready', key }, '*');
})();`;
