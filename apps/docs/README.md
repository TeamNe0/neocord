# neocord documentation site

The site at [neocord.dev](https://neocord.dev), built with Vite, React, React Router and MDX. Every route is prerendered to static HTML, then hydrated in the browser.

## Commands

Run these from `apps/docs`.

| Command | What it does |
| --- | --- |
| `bun check` | Type checks the site and its scripts. |
| `bun run build` | Writes the deployable site to `dist/`. |
| `bun run test` | Builds, then fails if docs have drifted from the packages or the output is incomplete. |
| `bun run dev` | Starts the Vite dev server. |

## How the build works

`bun run build` runs four steps:

1. `scripts/generate-eslint-pages.ts` writes one MDX page per rule from `src/data/eslint-rules.ts` into `src/content/eslint/rules`, which is not committed.
2. `vite build` creates the client bundle in `dist/`.
3. `vite build --ssr src/entry-server.tsx --outDir .ssr` creates the server bundle.
4. `scripts/prerender.ts` renders every route with React Router's static handler, and writes `dist/**/index.html`, `dist/404.html`, `dist/sitemap.xml`, `dist/robots.txt` and `dist/search-index.json`.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `VITE_SITE_URL` | `https://neocord.dev` | The origin used for canonical links, Open Graph tags, the sitemap and `robots.txt`. Set it at build time. |

## Adding a page

1. Create `src/content/<section>/<name>.mdx`. Do not add an `h1`, because the title and lede come from the navigation data.
2. Add the page to `src/data/nav.ts`, with its path, title, description and file.

Code fences take a filename with `title="src/foo.ts"`. A fence with the language `pm` becomes package manager tabs, with one command per line and the verbs `install`, `create`, `add`, `add -d`, `run` and `x`.

## Deploying

The output in `dist/` works on any static host. Pages are stored as `docs/foo/index.html`, and the host has to serve that file at `/docs/foo`. A missing path should serve `404.html` with a 404 status. All of the hosts below do this.

The canonical URLs have no trailing slash. A host that redirects `/docs/foo` to `/docs/foo/` still works, but it adds one redirect.

Every option runs `bun install` at the repository root, because the site is a workspace package.

### Netlify and Cloudflare Pages

| Setting | Value |
| --- | --- |
| Base directory | The repository root |
| Build command | `bun install && cd apps/docs && bun run build` |
| Publish directory | `apps/docs/dist` |
| Environment variable | `VITE_SITE_URL` |

`public/_headers` is copied to `dist/_headers`, and both hosts read it for cache and security headers. Files in `/assets/` have hashed names, so they are cached for a year.

### Vercel

Set the project's root directory to `apps/docs`, and turn on including files outside the root directory, so the workspace packages are available. `vercel.json` sets the build command, the output directory, clean URLs and headers. Set `VITE_SITE_URL` in the project's environment variables.

### Docker

The `Dockerfile` builds the site and serves it with nginx on port 8080. Build it from the repository root:

```sh
docker build -f apps/docs/Dockerfile --build-arg VITE_SITE_URL=https://docs.example.com -t neocord-docs .
docker run -p 8080:8080 neocord-docs
```

`nginx.conf` serves `docs/foo/index.html` at `/docs/foo` without a redirect, and returns `404.html` for anything else.

## Content security policy

The headers allow scripts only from the site's own origin, which is why `public/theme.js` is a file and not an inline script. `style-src` allows `'unsafe-inline'`, because the highlighted code in the HTML colours its tokens with inline CSS variables.
