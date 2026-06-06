// Isomorphic base64 over Uint8Array - no Buffer / atob / btoa dependency, so the
// behaviour is identical in Node, browsers and workers.

const CH = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const LOOKUP = (() => {
  const t = new Int16Array(256).fill(-1);
  for (let i = 0; i < CH.length; i++) t[CH.charCodeAt(i)] = i;
  return t;
})();

export function toBase64(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += CH[(n >>> 18) & 63] + CH[(n >>> 12) & 63] + CH[(n >>> 6) & 63] + CH[n & 63];
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = bytes[i]! << 16;
    out += CH[(n >>> 18) & 63] + CH[(n >>> 12) & 63] + "==";
  } else if (rem === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += CH[(n >>> 18) & 63] + CH[(n >>> 12) & 63] + CH[(n >>> 6) & 63] + "=";
  }
  return out;
}

export function fromBase64(input: string): Uint8Array {
  // Strip whitespace (data URIs are sometimes wrapped).
  let s = "";
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    if (c === 32 || c === 9 || c === 10 || c === 13) continue;
    s += input[i];
  }
  let pad = 0;
  if (s.endsWith("==")) pad = 2;
  else if (s.endsWith("=")) pad = 1;

  const groups = Math.floor(s.length / 4);
  const outLen = groups * 3 - pad;
  const out = new Uint8Array(outLen > 0 ? outLen : 0);
  let o = 0;
  for (let i = 0; i < groups * 4; i += 4) {
    const a = LOOKUP[s.charCodeAt(i)]!;
    const b = LOOKUP[s.charCodeAt(i + 1)]!;
    const c = LOOKUP[s.charCodeAt(i + 2)]!;
    const d = LOOKUP[s.charCodeAt(i + 3)]!;
    const n = (a << 18) | (b << 12) | ((c < 0 ? 0 : c) << 6) | (d < 0 ? 0 : d);
    if (o < outLen) out[o++] = (n >>> 16) & 0xff;
    if (o < outLen) out[o++] = (n >>> 8) & 0xff;
    if (o < outLen) out[o++] = n & 0xff;
  }
  return out;
}
