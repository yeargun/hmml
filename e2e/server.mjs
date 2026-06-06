// Tiny zero-dependency static file server rooted at the project directory.
// Used by Playwright (and by `npm run demo:browser`) to serve the built lib,
// the example page and the PNG helper over HTTP so ES module imports work.
import { createServer } from "node:http";
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
