// Live HMML sample documents for the landing page. Each `build()` returns a
// self-contained HTML snippet (CSS / 3D / raster / JS) that is encoded into an
// .hmml at build time, embedded in the page as base64, and decoded + rendered in
// an <iframe srcdoc> in the visitor's browser.
import { makePng } from "../examples/png.mjs";
import { toBase64 } from "../dist/index.js";

export const SAMPLES = [
  {
    id: "aurora",
    title: "Aurora",
    blurb: "Pure CSS light. Zero pixels stored.",
    kind: "css",
    build: async () => `<style>
  html,body{height:100%;margin:0;background:#05060d;overflow:hidden}
  .a{position:absolute;inset:-35%;filter:blur(46px);mix-blend-mode:screen;animation:f 13s ease-in-out infinite}
  .a1{background:radial-gradient(circle at 30% 30%,#7c5cff,transparent 60%)}
  .a2{background:radial-gradient(circle at 72% 58%,#21d4fd,transparent 60%);animation-delay:-4.5s}
  .a3{background:radial-gradient(circle at 50% 82%,#ff5ca7,transparent 60%);animation-delay:-9s}
  @keyframes f{0%,100%{transform:translate(0,0) scale(1)}33%{transform:translate(9%,-7%) scale(1.25)}66%{transform:translate(-7%,9%) scale(.85)}}
</style><div class="a a1"></div><div class="a a2"></div><div class="a a3"></div>`,
  },
  {
    id: "monolith",
    title: "Monolith",
    blurb: "A 3D scene, declared — not filmed.",
    kind: "3d",
    build: async () => `<style>
  html,body{height:100%;margin:0;overflow:hidden;display:grid;place-items:center;
    background:radial-gradient(circle at 50% 38%,#11183a,#05060d);perspective:760px}
  .scene{transform-style:preserve-3d;animation:spin 11s linear infinite}
  .cube,.face{width:96px;height:96px}
  .cube{position:relative;transform-style:preserve-3d}
  .face{position:absolute;border:1px solid #6f8cff;background:rgba(124,140,255,.10);box-shadow:inset 0 0 34px rgba(124,140,255,.35)}
  .f1{transform:translateZ(48px)}.f2{transform:rotateY(180deg) translateZ(48px)}
  .f3{transform:rotateY(90deg) translateZ(48px)}.f4{transform:rotateY(-90deg) translateZ(48px)}
  .f5{transform:rotateX(90deg) translateZ(48px)}.f6{transform:rotateX(-90deg) translateZ(48px)}
  @keyframes spin{to{transform:rotateX(360deg) rotateY(360deg)}}
</style><div class="scene"><div class="cube">
  <div class="face f1"></div><div class="face f2"></div><div class="face f3"></div>
  <div class="face f4"></div><div class="face f5"></div><div class="face f6"></div></div></div>`,
  },
  {
    id: "frame",
    title: "Frame",
    blurb: "A real PNG, set in motion by CSS.",
    kind: "image",
    build: async () => {
      const png = await makePng(360, 240, (x, y) => [
        (40 + (x * 200) / 360) | 0,
        (60 + (y * 150) / 240) | 0,
        (200 - (x * 90) / 360) | 0,
        255,
      ]);
      const uri = `data:image/png;base64,${toBase64(png)}`;
      return `<style>
  html,body{height:100%;margin:0;overflow:hidden;display:grid;place-items:center;background:#05060d;perspective:800px}
  .ph{position:relative;width:74%;border-radius:14px;overflow:hidden;transform-style:preserve-3d;
    box-shadow:0 34px 60px -22px #000;animation:bob 6.5s ease-in-out infinite}
  .ph img{display:block;width:100%}
  .ph::after{content:"";position:absolute;inset:0;
    background:linear-gradient(115deg,transparent 35%,rgba(255,255,255,.28) 50%,transparent 65%);
    transform:translateX(-130%);animation:sheen 4.5s ease-in-out infinite}
  @keyframes bob{0%,100%{transform:rotateY(-13deg) translateY(0)}50%{transform:rotateY(13deg) translateY(-9px)}}
  @keyframes sheen{0%,55%{transform:translateX(-130%)}100%{transform:translateX(130%)}}
</style><div class="ph"><img src="${uri}" alt="generated"></div>`;
    },
  },
  {
    id: "plasma",
    title: "Plasma",
    blurb: "image · html · css · js — running.",
    kind: "js",
    build: async () => `<style>html,body{height:100%;margin:0;background:#05060d;overflow:hidden}canvas{width:100%;height:100%;display:block}</style>
<canvas id="c"></canvas><script>
var cv=document.getElementById('c'),x=cv.getContext('2d');
function rs(){cv.width=cv.clientWidth;cv.height=cv.clientHeight}rs();onresize=rs;
var t=0;(function L(){t+=.03;var w=cv.width,h=cv.height,im=x.createImageData(w,h),d=im.data,px,py,i,v;
for(py=0;py<h;py+=2)for(px=0;px<w;px+=2){v=Math.sin(px/26+t)+Math.sin(py/22-t)+Math.sin((px+py)/30+t*1.3);
i=(py*w+px)*4;d[i]=70+80*Math.sin(v);d[i+1]=50+90*Math.sin(v+2);d[i+2]=150+95*Math.sin(v+4);d[i+3]=255;
d[i+4]=d[i];d[i+5]=d[i+1];d[i+6]=d[i+2];d[i+7]=255;}x.putImageData(im,0,0);requestAnimationFrame(L);})();
</script>`,
  },
  {
    id: "morph",
    title: "Morph",
    blurb: "From frozen image to living document.",
    kind: "css",
    build: async () => `<style>
  html,body{height:100%;margin:0;overflow:hidden;display:grid;place-items:center;background:#05060d;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  .s{position:relative;height:1.4em;font-size:clamp(20px,7vw,34px);font-weight:800}
  .s span{position:absolute;left:50%;top:0;transform:translateX(-50%);white-space:nowrap;opacity:0;animation:cyc 9s infinite}
  .s span:nth-child(1){color:#7c5cff}
  .s span:nth-child(2){animation-delay:3s;color:#21d4fd}
  .s span:nth-child(3){animation-delay:6s;background:linear-gradient(90deg,#7c5cff,#21d4fd,#ff5ca7);-webkit-background-clip:text;background-clip:text;color:transparent}
  @keyframes cyc{0%,33%,100%{opacity:0;transform:translate(-50%,10px)}6%,27%{opacity:1;transform:translate(-50%,0)}}
</style><div class="s"><span>image</span><span>html</span><span>image·html·css·js</span></div>`,
  },
];
