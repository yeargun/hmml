/**
 * Run with:  npm run demo   (uses tsx)
 *
 * Builds an HTML fragment with two inline images, packs it into HMML, reads it
 * back, verifies the round-trip, and compares the file size against the
 * equivalent self-contained (base64) HTML.
 */
import { decode, encode, extract, gzipCodec, sniffMime, toBase64 } from "../src/index";

// A fake "image": a PNG-signatured blob of semi-random bytes (incompressible,
// like a real photo) so the base64-vs-raw comparison is honest.
function fakeImage(bytes: number, seed: number): Uint8Array {
  const out = new Uint8Array(bytes);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG signature
  let x = seed >>> 0;
  for (let i = 8; i < bytes; i++) {
    x = (x * 1664525 + 1013904223) >>> 0; // LCG
    out[i] = (x >>> 16) & 0xff;
  }
  return out;
}

async function main() {
  const imgA = fakeImage(28_000, 1);
  const imgB = fakeImage(12_000, 99);

  const dataA = `data:image/png;base64,${toBase64(imgA)}`;
  const dataB = `data:image/png;base64,${toBase64(imgB)}`;

  // Markup with full layout freedom - note the 3D transform on an <img>.
  const original =
    `<section class="card" style="transform: matrix3d(1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1) rotateY(12deg)">` +
    `<h1>Hello HMML</h1>` +
    `<img class="hero" src="${dataA}" alt="hero">` +
    `<div style="background-image:url('${dataB}'); filter: blur(2px)"></div>` +
    `<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>` +
    `</section>`;

  // 1. Lift data URIs out into resources.
  const { html, resources } = extract(original);
  console.log(`extracted ${resources.length} resources:`);
  for (const r of resources) console.log(`  ${r.id}  ${r.mime}  ${r.data.length} bytes  (sniff: ${sniffMime(r.data)})`);

  // 2. Encode (markup gzipped, images stored raw).
  const file = await encode({ html, resources, meta: { title: "Hello HMML", v: 1 } }, { codec: gzipCodec, crc: true });

  // 3. Decode and verify the round-trip reproduces the original markup exactly.
  const doc = await decode(file);
  const rebuilt = doc.toHTML(); // data URIs inlined again
  const ok = rebuilt === original;

  // Size comparison.
  const selfContained = new TextEncoder().encode(original).length;
  console.log("\n--- results ---");
  console.log(`round-trip exact:        ${ok ? "YES ✓" : "NO ✗"}`);
  console.log(`meta:                    ${JSON.stringify(doc.meta)}`);
  console.log(`self-contained HTML:     ${selfContained.toLocaleString()} bytes`);
  console.log(`HMML file:               ${file.length.toLocaleString()} bytes`);
  console.log(`savings:                 ${(100 * (1 - file.length / selfContained)).toFixed(1)}%`);

  if (!ok) {
    console.error("\nMISMATCH - first divergence:");
    for (let i = 0; i < Math.max(rebuilt.length, original.length); i++) {
      if (rebuilt[i] !== original[i]) {
        console.error(`  at ${i}: got ${JSON.stringify(rebuilt.slice(i, i + 40))} want ${JSON.stringify(original.slice(i, i + 40))}`);
        break;
      }
    }
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
