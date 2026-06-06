# Docs site

A static, framework-free docs site for **hmml.eddocu.com**, generated from the
repo's Markdown (`README.md` → `index.html`, `SPEC.md` → `spec.html`) by
`docs/build.mjs` (marked + highlight.js + a small dark theme).

```sh
npm run site:build      # outputs ./site   (gitignored)
```

Preview locally: open `site/index.html` in a browser (it's plain static HTML/CSS,
so `file://` works).

## Deploy to Cloudflare Pages

**Option A - Git integration (recommended).** In the Cloudflare dashboard →
Workers & Pages → Create → Pages → Connect to Git → `yeargun/hmml`:

| Setting | Value |
| --- | --- |
| Build command | `npm install && npm run site:build` |
| Build output directory | `site` |
| Production branch | `main` |

Then add the custom domain **hmml.eddocu.com** under the project's *Custom domains*
tab (Cloudflare creates the CNAME automatically since the zone is on Cloudflare).
Every push to `main` redeploys.

**Option B - direct upload** (uses your logged-in Wrangler):

```sh
npm run site:deploy     # builds, then `wrangler pages deploy site --project-name=hmml`
```

The output is fully static (no server runtime), so it's a plain Pages deploy - no
Functions or Workers needed.
