# 2ndBrain.ceo

Next.js full-stack app for onboarding a user into an OpenClaw workspace, provisioning an AWS Lightsail instance, pairing Telegram approval, setting up a Remotion avatar, and maintaining multiple LLM Wiki projects with markdown editing and knowledge graphs.

## Stack

- Next.js App Router, React, and TypeScript
- Supabase Auth, SSR sessions, Postgres, and Google OAuth
- Railway deployment through the root `Dockerfile`
- AWS Lightsail provisioning through `clawmacdo`
- OpenClaw markdown/wiki commands through `clawmacdo`
- Remotion avatar setup and public URL storage in Supabase
- LLM Wiki attachments with PDF, DOCX, text, markdown, and image support
- Knowledge graph UI with `cytoscape` and `cytoscape-fcose`

## Local Development

```sh
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

Required local setup:

- Fill `.env.local` with Supabase, AWS, OpenAI, OpenClaw, and Avaturn values from `.env.example`.
- Run the Supabase SQL files in `supabase/migrations` in order.
- Enable Google in Supabase Auth providers.
- Add `http://localhost:3000/auth/callback` to Supabase Auth redirect URLs.
- Keep real `.env` files out of Git. `.gitignore` and `.dockerignore` exclude them.

Useful commands:

```sh
npm run typecheck
npm run build
npm run wiki:backfill -- --email bunnyppl@gmail.com --dry-run
npm run start
```

There is no `lint` script currently.

## Wiki Graph Backfill

If an existing LLM Wiki has markdown pages but `/dashboard/graph` shows zero points, backfill the Supabase graph tables from OpenClaw:

```sh
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key npm run wiki:backfill -- --email bunnyppl@gmail.com --reset
```

Use `--dry-run` first to verify the project, markdown files, parsed nodes, and parsed edges without writing rows. The script loads `.env.local` and `.env`, reads each ready project with an `openclaw_project_slug`, calls `clawmacdo wiki-tree` and `clawmacdo wiki-read`, then upserts `wiki_pages`, `wiki_nodes`, `wiki_page_nodes`, and `wiki_edges`.

## Environment

Supabase accepts either public Next.js names or Railway plugin aliases:

```txt
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_legacy_anon_key
```

or:

```txt
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_legacy_anon_key
```

Set `NEXT_PUBLIC_SITE_URL` to the active public app origin:

```txt
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

For Railway production, use the Railway public URL, for example:

```txt
NEXT_PUBLIC_SITE_URL=https://your-app.up.railway.app
```

If `NEXT_PUBLIC_SITE_URL` is not set on Railway, the app falls back to `RAILWAY_PUBLIC_DOMAIN` when Railway provides it. Setting `NEXT_PUBLIC_SITE_URL` explicitly is still preferred because it keeps OAuth redirects independent from proxy/internal host headers.

Do not expose Supabase service role keys to the browser. Only use a service role key in a local shell or controlled maintenance job for admin scripts such as `npm run wiki:backfill`. Google OAuth credentials belong in Supabase Auth provider settings.

## Supabase

Run migrations in order from `supabase/migrations`:

```txt
0001_app_schema.sql
0002_onboarding_profile.sql
0003_avaturn_profile.sql
0004_enrolment_profile.sql
0005_openclaw_provision.sql
0006_full_openclaw_flow.sql
0007_telegram_pairing.sql
0008_wiki_graph.sql
0009_openclaw_identity_async.sql
0010_projects_multi_wiki_registry.sql
```

Auth redirect URLs:

```txt
http://localhost:3000/auth/callback
https://your-railway-domain.up.railway.app/auth/callback
```

Deployment notes are also in `docs/supabase-railway.md`.

## Railway

`railway.json` uses the root `Dockerfile`, starts the custom Next.js server with `node server/custom-server.js`, and uses `/api/health` as the health check.

The Docker image:

- Builds with `npm ci` and `npm run build`.
- Runs the Next.js standalone output.
- Uses a custom Node server so the OpenClaw SSH console can accept WebSocket upgrades.
- Uses Debian Trixie slim instead of Alpine/Bookworm so the `@clawmacdo/linux-x64` binary has the required glibc version on Railway.
- Installs runtime tools needed by provisioning: `aws-cli`, `bash`, and `openssh-client`.
- Sets writable app-owned `HOME`, cache, config, OpenClaw, and avatar storage paths for the non-root runtime user.
- Copies `@clawmacdo` into the runtime image for the OpenClaw CLI binary.
- Copies `@napi-rs` into the runtime image for PDF parsing canvas polyfills.
- Copies `ssh2`, `ws`, and their runtime dependencies into the image for the authenticated SSH console.

Railway variables must include the same required values as `.env.example`. At minimum, login requires one Supabase URL and one anon/publishable key.

For constrained Railway containers, keep OpenClaw CLI work serialized and thread-light:

```txt
CLAWMACDO_MAX_CONCURRENCY=1
CLAWMACDO_SPAWN_RETRIES=3
CLAWMACDO_SPAWN_RETRY_DELAY_MS=1500
CLAWMACDO_TOKIO_WORKER_THREADS=1
CLAWMACDO_RAYON_NUM_THREADS=1
```

The Dockerfile also declares build args for public values used by Next.js during `npm run build`:

```txt
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
NEXT_PUBLIC_SITE_URL
NEXT_PUBLIC_AVATURN_URL
```

Only public/browser-safe values are passed this way. Keep AWS keys, OpenAI keys, Telegram tokens, Supabase service role keys, and the `SUPABASE_ANON_KEY` runtime alias as Railway runtime variables only.

## Product Flow

1. User logs in with Google through Supabase OAuth.
2. Onboarding collects owner name, avatar name, avatar gender, and Telegram bot token.
3. Avaturn avatar setup downloads/stores the GLB staging data.
4. OpenClaw provisioning runs `clawmacdo ls-restore-fast` to restore the Lightsail snapshot and prepare Telegram, identity, and Remotion environment settings in one CLI call.
5. Telegram pairing waits for user approval and shows progress.
6. After approval, the app routes to the dashboard.
7. Dashboard side menu exposes OpenClaw Gateway UI, Remotion Avatar, LLM Wiki, Knowledge Graph, Telegram token change, destroy workspace, and logout.
8. LLM Wiki supports generating multiple wiki projects, each stored with a Supabase UUID and OpenClaw project folder.
9. Markdown pages can be viewed, edited, saved, exported, and synced into the knowledge graph.

## LLM Wiki

The LLM Wiki dashboard supports:

- Creating multiple wiki projects from intent prompts.
- Uploading images, PDFs, TXT, Markdown, and DOCX files during generation.
- Converting non-image documents into markdown source pages.
- Embedding image attachments into generated markdown source pages.
- Listing generated wikis with search and pagination.
- Opening a recursive markdown tree for each wiki project.
- Deleting a wiki project and its tied OpenClaw workspace directory.

Wiki project names sent to OpenClaw use a generated numeric slug such as `wiki-1234567890`. The user-facing title and Supabase project UUID are stored in the `projects` table.

## Knowledge Graph

Knowledge graphs are scoped per LLM Wiki project, not global. The graph sync reads the selected project's markdown tree, extracts page nodes and linked concepts, and stores them in Supabase graph tables.

The UI uses `cytoscape` with the `fcose` layout for draggable knowledge-graph exploration, semantic edge styling, and layout re-runs. For large wikis, graph generation should be run per project/intent to avoid a single slow global graph.

## OpenClaw And clawmacdo

The app depends on `clawmacdo` for:

- Fast Lightsail restore/destroy.
- Telegram setup and pairing.
- Remotion avatar setup.
- OpenClaw identity setup.
- Wiki generation, tree, read, write, export, and delete.

The installed package is managed through `package.json`. To upgrade:

```sh
npm install clawmacdo@latest
npm run typecheck
npm run build
```

Commit and redeploy after upgrading so Railway rebuilds the Docker image with the updated platform binary.

## Important Routes

- `/` marketing homepage
- `/login` Google OAuth login
- `/auth/login` starts Google OAuth
- `/auth/callback` handles Supabase OAuth callback
- `/onboarding` enrolment, avatar, provision, and Telegram approval wizard
- `/dashboard` authenticated dashboard shell
- `/dashboard/openclaw` OpenClaw settings markdown
- `/dashboard/openclaw` also includes a pop-up SSH console that proxies through the app and reads SSH deploy records from `CLAWMACDO_STATE_DIR`
- `/dashboard/wiki` LLM Wiki generation and project list
- `/dashboard/wiki?projectId=...` selected wiki markdown editor
- `/dashboard/graph` knowledge graph project selector
- `/dashboard/graph?projectId=...` selected wiki graph
- `/api/health` deployment health check

## Troubleshooting

If login shows `Supabase credentials are required before login can run`, the running server cannot see a Supabase URL and anon/publishable key. Check Railway Variables for `NEXT_PUBLIC_SUPABASE_URL` plus `NEXT_PUBLIC_SUPABASE_ANON_KEY`, or `SUPABASE_URL` plus `SUPABASE_ANON_KEY`.

If Google OAuth redirects to `0.0.0.0`, the app is using Railway's internal request host for a browser redirect. Set `NEXT_PUBLIC_SITE_URL` to the real Railway public URL, redeploy, and make sure that URL is allowed in Supabase Auth redirect URLs. `/api/health` reports `env.siteUrlConfigured` and `env.siteUrlSource` to confirm which public-origin setting is active.

If PDF startup logs mention `@napi-rs/canvas`, rebuild with the current Dockerfile. The runtime image must copy `node_modules/@napi-rs`.

If provisioning logs show `spawn /app/node_modules/@clawmacdo/linux-x64/bin/clawmacdo ENOENT` or `GLIBC_2.39 not found`, the container base image is too old for the published clawmacdo Linux binary. Rebuild with the current Debian Trixie slim Dockerfile; it runs `clawmacdo --version` during image build to catch binary/linker issues before deployment.

If provisioning logs show `Permission denied (os error 13)` immediately after starting clawmacdo, the runtime user cannot write to its home/cache/config/workspace path. Rebuild with the current Dockerfile; it chowns `/app` and validates clawmacdo as the non-root `nextjs` user.

If provisioning fails, check Railway logs for sanitized `[clawmacdo]` events, AWS variables, snapshot name, region, and whether the `clawmacdo` version in Railway matches `package-lock.json`.

If logs show `spawn ... EAGAIN`, `Resource temporarily unavailable`, or a Tokio panic saying the OS cannot spawn a worker thread, the container has hit its process/thread limit. Keep `CLAWMACDO_MAX_CONCURRENCY=1`, `CLAWMACDO_TOKIO_WORKER_THREADS=1`, and `CLAWMACDO_RAYON_NUM_THREADS=1`; the app will queue `clawmacdo` calls and retry transient spawn failures.
