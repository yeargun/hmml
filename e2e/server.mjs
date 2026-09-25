// Tiny zero-dependency static file server rooted at the project directory.
// Used by Playwright (and by `npm run demo:browser`) to serve the built lib,
// the example page and the PNG helper over HTTP so ES module imports work.
import { createServer } from "node:http";
import { createGzip, constants } from "node:zlib";
import { gzipCodec } from "../dist/codecs.js";
import { encodeStream } from "../dist/encode-stream.js";
import { createSandboxLoaderHtml } from "../dist/mount.js";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = process.cwd();
const PORT = process.env.PORT ? Number(process.env.PORT) : 5188;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".cjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".hmml": "application/octet-stream",
  ".png": "image/png",
};

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent((req.url || "/").split("?")[0]);
    if (p === "/__test__/loader") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(createSandboxLoaderHtml());
      return;
    }
    // A slow, HTTP-gzipped fixture proves markup can arrive before the media.
    if (p === "/__test__/stream.hmml") {
      res.writeHead(200, { "content-type": "application/octet-stream", "content-encoding": "gzip" });
      const gzip = createGzip();
      gzip.pipe(res);
      res.on("close", () => gzip.destroy());
      async function* resources() {
        await new Promise(resolve => setTimeout(resolve, 700));
        yield { id: "hero", mime: "image/svg+xml", data: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="green"/></svg>') };
      }
      const internal = new URL(req.url, "http://localhost").searchParams.has("internal");
      const html = '<h2>Blueprint is ready</h2><img src="hmml:hero" width="80" height="40" alt="A green rectangle">';
      for await (const bytes of encodeStream({ html: internal ? html + "<p>Compressed blueprint</p>".repeat(100) : html, resources: resources() }, { crc: true, codec: internal ? gzipCodec : undefined })) {
        if (res.destroyed) break;
        gzip.write(bytes);
        // Explicit flush makes the test deterministic. A production CDN's
        // buffering and flush policy must be measured separately.
        gzip.flush(constants.Z_SYNC_FLUSH);
      }
      gzip.end();
      return;
    }
    if (p === "/") {
      // Redirect so relative URLs on the page resolve under /playground/.
      res.writeHead(302, { location: "/playground/" });
      res.end();
      return;
    }
    if (p.endsWith("/")) p += "index.html";
    // Prevent path traversal above the root.
    const safe = normalize(p).replace(/^(\.\.[/\\])+/, "");
    const file = join(root, safe);
    const data = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("404 " + (req.url || ""));
  }
});

server.listen(PORT, () => console.log(`hmml static server: http://127.0.0.1:${PORT} (root: ${root})`));
