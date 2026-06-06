// Live HMML sample documents for the landing page.
// UNIVERSE = the hero: a matrix3d 3D space of images + SVGs + document cards,
// parallax on pointer. SAMPLES = a light, SVG/image-forward gallery.
// Each is encoded to .hmml at build time and decoded live in <iframe srcdoc>.
import { makePng } from "../examples/png.mjs";
import { toBase64 } from "../dist/index.js";

const lerp = (a, b, t) => a + (b - a) * t;
async function gradPng(w, h, c0, c1) {
  return makePng(w, h, (x, y) => {
    const t = (x / w) * 0.6 + (y / h) * 0.4;
    return [lerp(c0[0], c1[0], t) | 0, lerp(c0[1], c1[1], t) | 0, lerp(c0[2], c1[2], t) | 0, 255];
  });
}
const uri = (png) => `data:image/png;base64,${toBase64(png)}`;

/* ---- small tasteful inline SVGs (vector tiles) ---- */
const svgRings = `<svg viewBox="0 0 120 120" width="100%" height="100%"><rect width="120" height="120" fill="#fff"/>
${[48, 36, 24, 12].map((r, i) => `<circle cx="60" cy="60" r="${r}" fill="none" stroke="${["#6366f1", "#14b8a6", "#f59e0b", "#fb7185"][i]}" stroke-width="6"/>`).join("")}</svg>`;
const svgWave = `<svg viewBox="0 0 140 90" width="100%" height="100%"><rect width="140" height="90" fill="#fff"/>
<path d="M0 60 Q 20 20 40 50 T 80 50 T 120 50 T 160 50" fill="none" stroke="#6366f1" stroke-width="5" stroke-linecap="round"/>
<path d="M0 70 Q 25 40 50 62 T 100 62 T 150 62" fill="none" stroke="#14b8a6" stroke-width="4" opacity=".7"/></svg>`;
const svgBlob = `<svg viewBox="0 0 120 120" width="100%" height="100%"><rect width="120" height="120" fill="#fff"/>
<path d="M60 14c22 0 42 16 42 40s-14 52-44 52S14 84 14 58 38 14 60 14Z" fill="#f59e0b" opacity=".92"/>
<circle cx="48" cy="52" r="9" fill="#fff"/></svg>`;
const svgGrid = `<svg viewBox="0 0 120 120" width="100%" height="100%"><rect width="120" height="120" fill="#fff"/>
${Array.from({ length: 25 }, (_, i) => `<circle cx="${20 + (i % 5) * 20}" cy="${20 + ((i / 5) | 0) * 20}" r="5" fill="#334155" opacity="${0.25 + ((i * 37) % 60) / 100}"/>`).join("")}</svg>`;
const svgCube = `<svg viewBox="0 0 120 120" width="100%" height="100%"><rect width="120" height="120" fill="#fff"/>
<g fill="none" stroke="#6366f1" stroke-width="4" stroke-linejoin="round">
<path d="M60 20 100 42 100 86 60 108 20 86 20 42Z"/><path d="M60 20 60 64 100 86M60 64 20 86M60 64 100 42"/></g></svg>`;

function docCard(title, accent) {
  return `<div style="width:100%;height:100%;background:#fff;display:flex;flex-direction:column">
    <div style="height:22px;background:#f6f7fb;border-bottom:1px solid #eceef4;display:flex;align-items:center;gap:4px;padding:0 9px">
      <i style="width:7px;height:7px;border-radius:50%;background:#fb7185"></i><i style="width:7px;height:7px;border-radius:50%;background:#f59e0b"></i><i style="width:7px;height:7px;border-radius:50%;background:#14b8a6"></i></div>
    <div style="padding:11px 12px;flex:1">
      <div style="font:700 12px ui-sans-serif,system-ui;color:#111">${title}</div>
      <svg viewBox="0 0 120 44" width="100%" height="40" style="margin-top:8px">
        ${[14, 26, 18, 34, 22, 40, 30].map((h, i) => `<rect x="${6 + i * 16}" y="${44 - h}" width="10" height="${h}" rx="2" fill="${accent}" opacity="${0.5 + i * 0.07}"/>`).join("")}</svg>
      <div style="height:6px;background:#eef0f6;border-radius:3px;margin-top:9px"></div>
      <div style="height:6px;width:62%;background:#eef0f6;border-radius:3px;margin-top:6px"></div>
    </div></div>`;
}

const T = (o) =>
  `<div class="t" style="transform:translate3d(${o.x}px,${o.y}px,${o.z}px) scale(${o.s || 1});opacity:${o.op ?? 1}${o.blur ? `;filter:blur(${o.blur}px)` : ""}">
    <div class="in" style="--d:${o.dur || 6}s;animation-delay:${o.delay || 0}s">
      <div class="card" style="width:${o.w}px;height:${o.h}px">${o.c}</div></div></div>`;

export const UNIVERSE = {
  id: "universe",
  build: async () => {
    const p1 = uri(await gradPng(150, 105, [99, 102, 241], [20, 184, 166])); // indigo→teal
    const p2 = uri(await gradPng(150, 105, [245, 158, 11], [251, 113, 133])); // amber→rose
    const p3 = uri(await gradPng(130, 130, [56, 189, 248], [99, 102, 241])); // sky→indigo
    const img = (u) => `<img src="${u}" style="width:100%;height:100%;object-fit:cover;display:block">`;

    const tiles = [
      { x: -420, y: -150, z: -120, w: 150, h: 105, c: img(p1), dur: 7 },
      { x: 300, y: -200, z: -60, w: 150, h: 105, c: img(p2), dur: 6, delay: -2 },
      { x: -120, y: 150, z: 60, w: 130, h: 130, c: img(p3), dur: 8, delay: -1 },
      { x: 120, y: -60, z: 140, w: 150, h: 110, c: docCard("scene.hmml", "#6366f1"), dur: 6.5 },
      { x: -360, y: 120, z: 40, w: 150, h: 110, c: docCard("report.hmml", "#14b8a6"), dur: 7.5, delay: -3 },
      { x: 420, y: 110, z: -40, w: 120, h: 120, c: svgRings, dur: 6, delay: -1.5 },
      { x: -180, y: -210, z: 30, w: 120, h: 120, c: svgCube, dur: 7, delay: -2.5 },
      { x: 250, y: 180, z: 90, w: 140, h: 90, c: svgWave, dur: 6.8, delay: -0.5 },
      { x: 30, y: 40, z: -220, w: 120, h: 120, c: svgGrid, dur: 9, op: 0.55, blur: 1.2 },
      { x: -480, y: -40, z: -200, w: 120, h: 120, c: svgBlob, dur: 8, op: 0.6, blur: 1, delay: -2 },
      { x: 470, y: -130, z: -190, w: 120, h: 120, c: svgGrid, dur: 8.5, op: 0.5, blur: 1.4, delay: -4 },
      { x: -40, y: -110, z: 220, w: 110, h: 110, c: svgRings, dur: 5.5, delay: -1 },
    ];
    const stars = Array.from({ length: 22 }, (_, i) => {
      const a = (i * 137.5) % 360;
      const r = 200 + ((i * 53) % 420);
      const x = Math.round(Math.cos((a * Math.PI) / 180) * r);
      const y = Math.round(Math.sin((a * Math.PI) / 180) * r * 0.6);
      const z = -360 + ((i * 47) % 520);
      const s = 2 + ((i * 7) % 4);
      return `<div class="st" style="transform:translate3d(${x}px,${y}px,${z}px);width:${s}px;height:${s}px;opacity:${0.18 + ((i * 11) % 30) / 100}"></div>`;
    }).join("");

    return `<style>
  html,body{height:100%;margin:0;overflow:hidden;background:radial-gradient(120% 100% at 50% 36%,#ffffff 0%,#eef1f8 70%,#e7ebf5 100%);
    font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  .scene{position:absolute;inset:0;perspective:1200px;perspective-origin:50% 46%}
  .rig{position:absolute;inset:0;transform-style:preserve-3d;animation:sway 20s ease-in-out infinite}
  .space{position:absolute;left:50%;top:50%;transform-style:preserve-3d;will-change:transform;transition:transform .12s ease-out}
  .t{position:absolute;left:0;top:0;transform-style:preserve-3d}
  .in{transform-style:preserve-3d;animation:bob var(--d,6s) ease-in-out infinite alternate}
  .card{border-radius:16px;overflow:hidden;background:#fff;box-shadow:0 22px 48px -20px rgba(30,34,72,.45),0 2px 8px rgba(30,34,72,.08);outline:1px solid rgba(20,24,60,.05)}
  .st{position:absolute;left:0;top:0;border-radius:50%;background:#6366f1}
  @keyframes bob{to{transform:translateY(-14px)}}
  @keyframes sway{0%,100%{transform:rotateY(-9deg) rotateX(3deg)}50%{transform:rotateY(9deg) rotateX(-2deg)}}
</style>
<div class="scene"><div class="rig"><div class="space" id="sp">${stars}${tiles.map(T).join("")}</div></div></div>
<script>
var sp=document.getElementById('sp'),tx=0,ty=0,cx=0,cy=0;
addEventListener('mousemove',function(e){tx=(e.clientX/innerWidth-.5)*30;ty=(e.clientY/innerHeight-.5)*-20;});
addEventListener('mouseleave',function(){tx=0;ty=0;});
(function L(){cx+=(tx-cx)*.05;cy+=(ty-cy)*.05;sp.style.transform='rotateX('+cy.toFixed(2)+'deg) rotateY('+cx.toFixed(2)+'deg)';requestAnimationFrame(L);})();
</script>`;
  },
};

/* ---------------- light gallery samples ---------------- */
export const SAMPLES = [
  {
    id: "vector",
    title: "Vector",
    blurb: "An SVG that draws itself.",
    kind: "svg",
    build: async () => `<style>html,body{height:100%;margin:0;background:#fff;display:grid;place-items:center}
  path{stroke-dasharray:600;stroke-dashoffset:600;animation:d 4s ease-in-out infinite alternate}
  @keyframes d{to{stroke-dashoffset:0}}</style>
<svg viewBox="0 0 200 140" width="78%"><g fill="none" stroke-width="4" stroke-linecap="round">
<path d="M20 110 C 60 10, 90 130, 120 60 S 180 20, 190 90" stroke="#6366f1"/>
<path d="M20 120 C 70 70, 110 150, 150 90 S 185 110, 190 100" stroke="#14b8a6" style="animation-delay:.6s"/></g></svg>`,
  },
  {
    id: "photo",
    title: "Photo",
    blurb: "A real image, gently in motion.",
    kind: "image",
    build: async () => {
      const png = await gradPng(360, 240, [99, 102, 241], [251, 113, 133]);
      return `<style>html,body{height:100%;margin:0;background:#fff;overflow:hidden;display:grid;place-items:center}
  .f{width:76%;border-radius:14px;overflow:hidden;box-shadow:0 24px 50px -24px rgba(30,34,72,.5);animation:k 9s ease-in-out infinite alternate}
  .f img{display:block;width:100%}@keyframes k{from{transform:scale(1)}to{transform:scale(1.12) translateY(-3%)}}</style>
<div class="f"><img src="${uri(png)}"></div>`;
    },
  },
  {
    id: "card",
    title: "Card",
    blurb: "A document, tilting in 3D space.",
    kind: "3d",
    build: async () => `<style>html,body{height:100%;margin:0;background:#fff;display:grid;place-items:center;perspective:800px}
  .c{width:62%;background:#fff;border-radius:16px;box-shadow:0 26px 54px -22px rgba(30,34,72,.5);outline:1px solid #eceef4;
    padding:16px 18px;font-family:ui-sans-serif,system-ui;animation:tilt 7s ease-in-out infinite;transform-style:preserve-3d}
  .c b{font-size:14px;color:#111}.bar{height:7px;background:#eef0f6;border-radius:4px;margin-top:9px}
  @keyframes tilt{0%,100%{transform:rotateY(-16deg) rotateX(6deg)}50%{transform:rotateY(16deg) rotateX(-4deg)}}</style>
<div class="c"><b>quarterly.hmml</b>
<svg viewBox="0 0 140 44" width="100%" height="40" style="margin-top:8px">${[14, 28, 20, 36, 24, 40].map((h, i) => `<rect x="${6 + i * 22}" y="${44 - h}" width="14" height="${h}" rx="2" fill="#6366f1" opacity="${0.5 + i * 0.08}"/>`).join("")}</svg>
<div class="bar"></div><div class="bar" style="width:60%"></div></div>`,
  },
  {
    id: "type",
    title: "Type",
    blurb: "Text, written and rewritten.",
    kind: "css",
    build: async () => `<style>html,body{height:100%;margin:0;background:#fff;display:grid;place-items:center;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  .w{font-size:clamp(18px,5.5vw,30px);font-weight:700;color:#111}
  .w b{color:#6366f1;font-weight:700}.cur{display:inline-block;width:.6ch;background:#6366f1;animation:bl 1s steps(1) infinite}@keyframes bl{50%{opacity:0}}</style>
<div class="w">it’s <b id="w"></b><span class="cur">&nbsp;</span></div>
<script>var el=document.getElementById('w'),words=['an image','a document','a 3D scene','a universe'],i=0,j=0,del=false;
(function t(){var w=words[i];el.textContent=w.slice(0,j);if(!del&&j<w.length){j++}else if(!del){del=true;setTimeout(t,1100);return}else if(j>0){j--}else{del=false;i=(i+1)%words.length}setTimeout(t,del?45:95)})();</script>`,
  },
];
