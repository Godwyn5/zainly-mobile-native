# Zainly Legal Pages — Static Web Deployment

This directory contains the static HTML/CSS legal pages for Zainly, ready for deployment to any static hosting service.

## Files

- `index.html` — Landing page with links to Privacy Policy and Terms (hand-written, contains no legal text — safe to edit directly)
- `privacy.html` — Privacy Policy (**AUTO-GENERATED — do not edit directly**)
- `terms.html` — Terms of Use (**AUTO-GENERATED — do not edit directly**)
- `styles.css` — Shared stylesheet with Zainly branding (hand-written, safe to edit directly)

## Content Source — Single Source of Truth

`privacy.html` and `terms.html` are **generated artifacts**. They are produced by
[`scripts/generate-legal-pages.js`](../scripts/generate-legal-pages.js) from:

- `src/legal-content/privacy.json`
- `src/legal-content/terms.json`

These two JSON files are the **only editorial source** for Zainly's legal text.
The exact same JSON files are also consumed directly by the mobile app
(`app/legal/privacy.tsx`, `app/legal/terms.tsx`), so the in-app and public web
versions can never silently diverge — there is only one place to edit legal
copy.

**To change any legal text:**

1. Edit `src/legal-content/privacy.json` or `terms.json`
2. Run `npm run legal:build` to regenerate the HTML
3. Commit both the JSON change and the regenerated HTML

**Never hand-edit `privacy.html` or `terms.html`** — any manual edit will be
silently overwritten the next time `npm run legal:build` runs, and will be
flagged as stale by `npm run legal:check`.

## Regenerating the pages

```bash
npm run legal:build
```

## Verifying the pages are up to date

```bash
npm run legal:check
```

Exits with a non-zero status and prints which file is stale if the generated
HTML no longer matches the JSON source (e.g. someone edited the JSON but
forgot to rebuild, or someone hand-edited the HTML).

## Local Testing

To test locally, simply open `index.html`, `privacy.html`, or `terms.html` in a web browser. No build process or server is required to view the pages — only to regenerate them.

## Deployment

### Option 1: Vercel

1. Install Vercel CLI: `npm i -g vercel`
2. From the `web-legal` directory: `vercel`
3. Follow prompts to deploy

### Option 2: Netlify

1. Install Netlify CLI: `npm i -g netlify-cli`
2. From the `web-legal` directory: `netlify deploy --prod`
3. Follow prompts to deploy

### Option 3: GitHub Pages

1. Push this directory to a GitHub repository
2. Enable GitHub Pages from repository settings
3. Set source to deploy from this directory

### Option 4: Static hosting via CDN

Upload the entire `web-legal` directory to any static hosting service (AWS S3 + CloudFront, Cloudflare Pages, etc.).

## URL Paths After Deployment

**This is NOT guaranteed and NOT yet verified.** Whether `/privacy` and
`/terms` (without the `.html` extension) work depends entirely on the chosen
hosting platform and its configuration (rewrites, clean-URL settings, etc.):

- Some hosts (e.g. Netlify, Vercel) can serve `/privacy` for `privacy.html`
  automatically or via a small config file (not included here — no hosting
  platform has been chosen yet).
- Other hosts will only serve the file at its literal path: `/privacy.html`,
  `/terms.html`.

**No domain, no hosting provider, and no deployment has been chosen or
performed as part of this task.** Once a real host is selected, `GET /privacy`
and `GET /terms` — including direct access and a hard browser refresh — must
be explicitly verified before relying on those paths anywhere (e.g. App Store
Connect).

## Apple App Store Connect

Once a real deployment exists and the working public URLs have been verified,
use those exact URLs for the Privacy Policy URL and Terms of Use URL fields.
Do not fill these in with a placeholder or an unverified URL.

## Important Notes

- No JavaScript is required for these pages
- No tracking, analytics, or cookies are included
- The content is in French as per the app's primary language
- Contact email: zainlyapp@gmail.com
- Last updated: 20 juillet 2026
