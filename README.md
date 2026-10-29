# AI CUBER

Next.js full-stack app for onboarding a user into an OpenClaw workspace, provisioning an AWS Lightsail instance, pairing Telegram approval, setting up a Remotion avatar, and maintaining multiple LLM Wiki projects with markdown editing and knowledge graphs.

## Stack

- Next.js App Router, React, and TypeScript
- Supabase Auth, SSR sessions, Postgres, and Google OAuth
- Railway deployment through the root `Dockerfile`
- AWS Lightsail provisioning through `clawmacdo`
- OpenClaw markdown/wiki commands through `clawmacdo`
- Remotion avatar setup and public URL storage in Supabase
- LLM Wiki attachments with PDF, DOCX, text, markdown, and image support
- Knowledge graph UI with `3d-force-graph`, plus a 2D `cytoscape` and `cytoscape-fcose` view

## Local Development

The app uses Node.js 26.12.1 or a newer 26.x security release. `.nvmrc` pins the version, and the Docker image uses the same release. For Windows, the following starts the app with a project-local copy of Node; if needed, it downloads the official archive and checks its SHA-256 checksum first:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/dev-local.ps1
```

With a Node version manager on other platforms, install and select the version in `.nvmrc` before running:

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

Optional WeChat website sign-in uses a Logto OIDC bridge and a Supabase custom provider. Follow [the WeChat setup guide](docs/wechat-login.md), then set `WECHAT_LOGIN_ENABLED=true` after the external configuration is ready.

## Email and password sign-in

Enable the Email provider and sign-ups in Supabase Authentication. Keep email confirmation enabled if users must verify their address before signing in. Add the application's `/auth/callback` URL to Supabase Auth's redirect allow list for each environment, and set the canonical production URL in `NEXT_PUBLIC_SITE_URL`. The confirmation and reset email templates must use Supabase's confirmation URL so that the requested redirect is preserved.

Configure a [custom SMTP server](https://supabase.com/docs/guides/auth/auth-smtp) in Supabase Authentication for production: Supabase's default sender only delivers to authorized project-team addresses and is rate limited. Review Auth rate limits for expected traffic; these server-side requests reach Supabase from the application server. Users must open their confirmation and password-reset links in the same browser and device where they requested them, because the flow uses PKCE. They can request a fresh link if the verifier expires or is unavailable. `npm run test:email-auth` tests the local authentication and callback behavior without sending email.

## Workspace AI chat

Set the server-only `OPENROUTER_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY`, then apply migrations through `0033_chat_file_outputs.sql`. Restart the app after changing environment variables. The key must have sufficient OpenRouter credit and access to the selected models. Without either key or the migration, chat cannot send requests. Docker Compose users can alternatively set `OPENROUTER_API_KEY` in the optional Docker secrets workflow.

Chat supports one PDF, PNG, JPEG, WebP, XLSX, CSV or DOCX attachment, or a pair consisting of one fillable PDF, DOCX or PPTX template and one XLSX/CSV spreadsheet, up to 20 MiB per file. File cards in chat include preview and download controls. Attachments and generated files can be viewed in the side panel: PDFs and images display in the browser, DOCX previews show formatted content and embedded images where supported, and spreadsheet previews show up to 100 rows and 50 columns per sheet. DOCX previews are approximations and can differ from Word. DOCX text sent for analysis is limited to 28 KB; formatting and embedded images are not included in that analysis. Select Ask about on a supported file in a chat to process it again for a follow-up; regular AI and OCR charges apply. New uploads are stored in the private Supabase Storage bucket `aicuber-chat-uploads`; their account-owned metadata is in `chat_files`. Saved files can be downloaded or attached again from My files in the chat header or Saved files in the composer, including on another device. Downloads are also available in Payment settings when AI credits are exhausted. Chat conversations and extracted text remain stored only in the browser. Image transcription and spreadsheet analysis use Gemini 2.5 Flash; PDFs use OpenRouter's Mistral OCR parser with Gemini. The model selector locks to Gemini while a file is attached and returns to the previous chat model after the attachment is removed or sent. Image and PDF requests automatically include OCR instructions as well as the user's question. Removing an attachment from the composer does not remove the saved file. New OCR Markdown and spreadsheet analysis JSON are also saved to My files as generated outputs, linked to their source upload. Chat does not currently generate a modified XLSX workbook. PDFs are limited to 20 pages. Extracted text appears in a Markdown panel and is saved with chat history in browser storage. File data is sent to OpenRouter; only the first 6,000 characters of extracted data are included in later questions. Spreadsheet uploads provide full data up to a 28 KB extracted-data limit, plus computed numeric column statistics. The model can interpret this data, but calculations beyond the provided statistics should be independently verified; this is not a full spreadsheet calculation engine. Formulas need saved cached values.

For batch document generation, attach one fillable PDF, DOCX or PPTX template and one XLSX/CSV file. For DOCX, mark each replacement with a simple placeholder such as `{{Name}}` or `{{Address}}`; placeholders can be repeated and retain the template formatting. Only simple placeholders are supported, not Word form controls, expressions, loops or raw XML. One editable DOCX is saved per row when the template is DOCX. Apply `0035_chat_docx_generation.sql` before deploying DOCX generation.

PowerPoint generation supports either a PPTX template and an XLSX/CSV spreadsheet or a prompt in the **PowerPoint** chat mode. Template text uses simple `{{Name}}` placeholders, mapped to spreadsheet columns to produce one editable PPTX per row. Repeating slides, replacing images and editing charts are not supported in templates. Prompt generation asks Gemini to write a cover and up to ten content slides with editable text; long or extra bullets may continue onto additional slides. It does not generate images or charts. If the AI response cannot be converted, the returned content remains visible in chat. If the presentation is created but storage fails, download it or retry saving without another AI request; the recovery copy remains available only while the page is open. PowerPoint files have a visual preview with slide navigation and can be downloaded from My files; the preview may differ from PowerPoint. Prompt generation AI costs are recorded as `pptx_generation`; template batches use approved mappings and do not call AI. Apply `0040_chat_pptx_generation.sql` before deploying the feature. Examples and expected results are in `test-data/test-8` and `test-data/README.md`.

To apply a new look to an existing presentation, attach two PPTX files in chat: the content deck first and the design template second. The file roles are displayed, can be swapped and must be confirmed before transfer. The result is an editable presentation saved in My files; no AI credits are used. The transfer retains source text, embedded images and charts where supported. It selects a template slide with enough clear space, removes its sample text, repositions the source objects together and checks their bounding boxes against retained design elements. Source slides with overlapping, tightly spaced or rotated objects are rejected, as are templates whose inherited design elements cannot be checked safely. Review every slide in PowerPoint for contrast, text fit and chart rendering, which may vary by application. Both decks must have the same slide size and at most 30 slides and 100 objects per slide. Each file is limited to 20 MB. Grouped objects, SmartArt, embedded files and external links are rejected; speaker notes, transitions and animations are not transferred. See `test-data/test-10` for an example.

For batch PDF generation, attach one fillable PDF and one XLSX/CSV file. The first row of the first sheet must contain unique, non-empty column names. Review the suggested field mappings and choose a column for every field before generating; up to 100 subsequent non-empty rows each produce a separate document saved privately in My files. Progress and row-level errors are shown as files are processed, and successful results can be downloaded as a ZIP. Text fields, checkboxes and dropdowns are supported; XFA forms, signature fields and other field types are not. Unmapped fields stop the batch. A spreadsheet must fit the 28 KB analysis limit, and generated output is limited to 20 MiB per file and 60 MiB per batch. Store identifiers with leading zeros as text. Font/character support depends on the PDF renderer; unsupported characters cause an error rather than silent substitution. The mapping review and batch generation do not call OpenRouter or use AI credits; generating the PDFs does not invoke OCR. Review generated PDFs before using them. Apply `0034_chat_pdf_generation.sql` before deploying this feature.

Chat also offers prompt-based image generation with Seedream 4.5 and three-second, 480p video generation with Grok Imagine Video 1.5 Lite. The app checks current OpenRouter pricing before reserving credits, and records the provider's actual cost when supplied. Generated media is saved privately in My files and has a 20 MiB limit. Video jobs are stored in Supabase and checked while the user has chat open; returning to chat resumes checks for the same job without resubmitting it. OpenRouter output retention is temporary, so the user should return to chat promptly if they leave before the video completes. Unconfirmed costs retain their reservation for review. Apply `0036_chat_media_generation.sql` and `0037_chat_video_jobs.sql` before deploying this feature.

OpenRouter chat requests reserve and settle AI credits, and are recorded in `chat_credit_requests`. Admins with MFA can review itemized usage at Admin → Billing → View AI usage. Each row reports the user, operation, model, provider cost when confirmed, credits, token counts when provided, and PDF page count. PDF cost is the provider's combined request cost; it is not a separate OCR line. The app retries a delayed PDF cost lookup and still displays a successful response if the cost remains unavailable. In that case, usage is marked unconfirmed and the reservation remains held for administrator review; it is not a final charge. Requests predating itemization can lack detail. Existing credits are already debited, so the report must not be used to debit them again. Changes require applying migration `0029_chat_usage_itemization.sql` before deploying the app. Apply `0030_chat_usage_summary.sql` for the user-facing chat usage breakdown and `0031_chat_files.sql` for private file storage , `0032_chat_file_delete_guard.sql` to ensure account deletion cleans up stored objects first, and `0033_chat_file_outputs.sql` for generated file metadata. The Supabase project’s global Storage file-size limit must be at least 20 MiB; the private bucket also enforces that limit. Uploads use the server-side service role and require `SUPABASE_SERVICE_ROLE_KEY`. Storage transfers above 6 MB use a standard upload and may need to be retried on an unstable connection.


The chat offers GPT-6.1 Sol, Claude Sonnet 5.5, Kimi K3.1 Pro, DeepSeek V4.1 Flash, and GLM 5.3. Model availability and pricing are checked against the OpenRouter catalog at request time. Conversation history is stored in DuckDB-Wasm in the current browser's origin-private file system, scoped to the signed-in account. Ten recent conversations are shown initially; older ones can be loaded. The previous single browser-saved chat is migrated after the new cache is successfully written. Chat data is not synchronized to the server or other devices and may be removed when browser data is cleared. The most recent messages are sent for context. The server never exposes the provider key to the browser.

Persistent history requires a secure origin (HTTPS or localhost), OPFS, Web Workers, WebAssembly and Web Locks. If browser storage is unavailable, chat can continue for the current page session with a visible warning; previously saved data is not removed. DuckDB 1.32.0 is pinned because a newer published build has a known OPFS durability regression. `predev` and `prebuild` copy the versioned worker and WASM assets into `public/duckdb` for same-origin hosting.

Chat credits follow the existing $30 / 7.5 million credit rate. Before a request, the app reserves a conservative estimate based on current model pricing, message size and the output limit; it then charges the provider-reported cost and releases any unused reservation. The estimate is not a hard spending cap: the actual charge can exceed it if provider pricing or token use differs from the estimate. Admin accounts retain the existing quota exemption. A timeout or unknown provider result holds the reservation for review rather than assuming the request was free. Each request is recorded in `chat_credit_requests` without storing conversation text. If a server process dies, a stale in-flight request is marked `uncertain` on the user's next request, with its reservation held.

To reconcile an uncertain request, an operator must verify the actual OpenRouter charge (using the recorded provider request ID when available) or establish that the request was not billed. As the service role, call `settle_chat_credits` with the original user and request IDs, `completed` plus `ceil(cost_usd * 250000)` credits and the verified cost, or `failed` plus zero credits for a confirmed unbilled request. The function adjusts the balance and ledger atomically. If Redis quota publishing is enabled, publish the updated profile balance after manual reconciliation so connected services see it. Do not guess or automatically refund a request whose provider status is unknown.

Useful commands:

```sh
npm run typecheck
npm run test:chat
npm run test:solana
npm run build
npm run admin:load -- --email owner@example.com --replace
npm run wiki:backfill -- --email bunnyppl@gmail.com --dry-run
npm run start
```

There is no `lint` script currently.

Prefer containers? See [Docker Compose](#docker-compose) to run the app with the
same image used in production, including a Docker-secrets workflow.

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

Set `NEXT_PUBLIC_SITE_URL` to the active app origin:

```txt
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

When one Supabase project must support both production and local social login,
use a comma-separated list with the production DNS first:

```txt
NEXT_PUBLIC_SITE_URL=https://kere.ceo,http://localhost:3000
```

For Railway production, keep the canonical DNS first, for example
`NEXT_PUBLIC_SITE_URL=https://kere.ceo`. If `NEXT_PUBLIC_SITE_URL` is not set
on Railway, the app falls back to `RAILWAY_PUBLIC_DOMAIN` when Railway provides
it. Setting `NEXT_PUBLIC_SITE_URL` explicitly is still preferred because it
keeps OAuth redirects independent from proxy/internal host headers.

Do not expose Supabase service role keys to the browser. Only use a service role key in a local shell or controlled maintenance job for admin scripts such as `npm run wiki:backfill`. Google OAuth credentials belong in Supabase Auth provider settings.

Marketplace workflow launches use short-lived signed URLs. To also revoke already-open workflow tool tabs when a user logs out, set `MARKETPLACE_LAUNCH_VERIFY_SECRET` in AI CUBER and set the same value plus `MARKETPLACE_LAUNCH_VERIFY_URL=https://your-2ndbrain-domain/api/marketplace/launch-session/verify` in each deployed workflow tool.

Meeting Minutes runs as a separate Railway service. Set `MEETING_MINUTES_URL` to its public `/api/2ndbrain/launch` endpoint and `MEETING_MINUTES_SESSION_SECRET` to the same 32-byte minimum secret configured on that service. Both services also need the same `MARKETPLACE_LAUNCH_VERIFY_SECRET`; set the minutes service's `MARKETPLACE_LAUNCH_VERIFY_URL` to this app's `/api/marketplace/launch-session/verify`. The meeting-minutes repository documents its volume, Zoom credentials, and deployment settings. The listing uses the standard 10,000 AI credit monthly workflow price.


The 2D Game Development Tutorial runs as a separate Railway service from [aicuber-2d-game-dev-tutorial](https://github.com/kenken64/aicuber-2d-game-dev-tutorial). Set `GAME_DEV_TUTORIAL_URL` to its public `/api/2ndbrain/launch` endpoint and share a random `GAME_DEV_TUTORIAL_SESSION_SECRET` of at least 32 bytes with that service. Both services need the same `MARKETPLACE_LAUNCH_VERIFY_SECRET`; configure the tutorial's `MARKETPLACE_LAUNCH_VERIFY_URL` to this app's `/api/marketplace/launch-session/verify`. Its repository documents the volume and optional AI/cloud editor configuration. The listing uses the standard 10,000 AI credit monthly workflow price.

## Supabase

Run every file in `supabase/migrations` in filename order, in the Supabase SQL
Editor. They are idempotent, so re-running a file is safe.

Because they are applied by hand, a skipped file stays invisible until a write
fails at runtime — PostgREST rejects an entire `PATCH` when a single column is
unknown, so one missing column breaks a whole endpoint. To compare the
migrations against a live database:

```bash
DATABASE_URL=… npm run schema:check        # exits 1 on drift
DATABASE_URL=… npm run schema:check -- --sql   # SQL to paste for whatever is missing
```

Auth redirect URLs:

```txt
http://localhost:3000/auth/callback
https://your-railway-domain.up.railway.app/auth/callback
```

Deployment notes are also in `docs/supabase-railway.md`.

## Docker Compose

Run the whole app in a container with the same `Dockerfile` used on Railway. The
app is a single service; Supabase, AWS, Solana, and OpenClaw instances are
external. An optional Redis service is included for the token quota/usage pub-sub.

**Prerequisites:** Docker Engine 25+ and the Compose v2 plugin (`docker compose version`).

> `NEXT_PUBLIC_*` values are inlined into the browser bundle at **build time**, so
> Compose passes them as build args (substituted from `.env`). Compose reads `.env`
> (not `.env.local`), so the values must live there. If you change any
> `NEXT_PUBLIC_*` value, rebuild with `--build`.

### Option A — plain env file

1. Create `.env` from the template and fill in real values:

   ```sh
   cp .env.example .env
   ```

2. Build and start the app:

   ```sh
   docker compose up --build
   ```

3. Open `http://localhost:3000`. Check health at `http://localhost:3000/api/health`.

4. (Optional) Start the local Redis service for the token quota/usage listener,
   then point the app at it by setting `REDIS_URL=redis://redis:6379` in `.env`:

   ```sh
   docker compose --profile redis up --build
   ```

### Option B — with Docker secrets (recommended)

Keeps server-side secrets out of `.env`. Files live in `./secrets/` (git-ignored),
are mounted read-only at `/run/secrets/<NAME>`, and the image entrypoint
(`scripts/docker-entrypoint.sh`) exports each non-empty one as an env var, taking
precedence over the same key in `.env`. The entrypoint is a no-op passthrough when
no secrets are mounted, so the same image still runs on Railway. The managed
secrets are defined in `scripts/secrets.list`:

- **Generated** (random 32-byte hex if not already in `.env`): the `*_SESSION_SECRET`
  pairing secrets, `OPENCLAW_SSH_TOKEN_SECRET`, `MARKETPLACE_LAUNCH_VERIFY_SECRET`,
  `MARKETPLACE_RENEWAL_SECRET`.
- **Provide**: `SUPABASE_SERVICE_ROLE_KEY`, `AWS_ACCESS_KEY_ID`,
  `AWS_SECRET_ACCESS_KEY`, `OPENAI_API_KEY`.
- **Optional**: `GWS_OAUTH_CLIENT_SECRET`, `TOKEN_QUOTA_REDIS_URL`, `SOLANA_RPC_URL`.

1. Complete Option A step 1 (you still need `.env` for non-secret and
   `NEXT_PUBLIC_*` values).

2. Scaffold `./secrets/*` — generates random secrets and imports any existing
   values from `.env`. Safe to re-run; existing files are kept:

   ```sh
   ./scripts/init-secrets.sh
   ```

3. Fill any secret the previous step reported as `MISSING` (inline value, hidden
   prompt, or piped from stdin):

   ```sh
   ./scripts/set-secret.sh SUPABASE_SERVICE_ROLE_KEY "your_service_role_key"
   ./scripts/set-secret.sh AWS_SECRET_ACCESS_KEY            # prompts, input hidden
   printf '%s' "$VALUE" | ./scripts/set-secret.sh OPENAI_API_KEY -
   ```

4. Start the app with the secrets override layered on top of the base file:

   ```sh
   docker compose -f docker-compose.yml -f docker-compose.secrets.yml up --build
   ```

   To avoid repeating the `-f` flags, export once per shell instead:

   ```sh
   export COMPOSE_FILE=docker-compose.yml:docker-compose.secrets.yml
   docker compose up --build
   ```

5. (Optional) Once secrets are working, delete those keys from `.env` — the secret
   value wins either way. If you add or remove a secret, update both
   `scripts/secrets.list` and `docker-compose.secrets.yml`. Never commit
   `./secrets/` (it is git-ignored and excluded from the Docker build context).

### Common commands

```sh
docker compose logs -f web        # tail app logs
docker compose ps                 # service + health status
docker compose down               # stop (add -v to also drop the named volumes)
```

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

For the OpenClaw SSH console, set `OPENCLAW_SSH_TOKEN_SECRET` to a long random value. The browser asks the server for a short-lived SSH token, so the console does not require browser-exposed Supabase variables.

For the admin module, Railway must also include:

```txt
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

For self-hosted Supabase on Railway, the Supabase service commonly exposes `SERVICE_ROLE_KEY`; the app also accepts that name as a fallback, or you can set `SUPABASE_SERVICE_ROLE_KEY=${{YourSupabaseService.SERVICE_ROLE_KEY}}` on the app service.

Admin access is loaded into Supabase, not registered inside the app. After running `0014_admin_controls.sql`, load or reload the allowlist:

```sh
npm run admin:load -- --email owner@example.com --replace
```

You can also provide multiple emails with `--emails owner@example.com,ops@example.com`, a newline-delimited file with `--file admin-emails.txt`, or the optional local `ADMIN_EMAILS` env var as script input. The app authorizes admins from `public.admin_users`.

There is no separate admin password or in-app admin registration form. Admin pages and admin APIs require a Supabase Google session with TOTP MFA verified to `aal2`. Enable Supabase Auth MFA/TOTP for the project, load the admin email with `npm run admin:load`, sign in with that same Google account, then visit `/admin`; admins who have not verified MFA are redirected to `/admin/mfa` for authenticator app enrollment.

For external quota listeners such as the tty proxy, set Redis pub/sub variables on Railway:

```txt
TOKEN_QUOTA_REDIS_URL=redis://default:password@host:port
TOKEN_QUOTA_REDIS_CHANNEL=2ndbrain:token-quota
TOKEN_USAGE_REDIS_URL=redis://default:password@host:port
TOKEN_USAGE_REDIS_CHANNEL=openclaw:token_usage:v1
```

When configured, quota changes publish a JSON `token_quota.updated` event to the quota channel. The server also listens for tty proxy `openclaw.token_usage.v1` events on the usage channel. Incoming usage is mapped by `openclaw_instance` first, then `profile_id`, then email, and increments `profiles.llm_token_used` before publishing a refreshed quota snapshot. If Redis is not set, quota changes still succeed without publishing and usage events are not consumed.

For Solana credit purchases, Railway must include a treasury wallet public key. The browser connects to Phantom and sends Solana directly from the user wallet to this treasury address. The server verifies the on-chain transaction before incrementing the user's AI credit quota.

Use devnet first for payment testing. The app defaults to devnet when `SOLANA_PAYMENT_NETWORK` is not set, and selecting `devnet` uses `https://api.devnet.solana.com` unless `SOLANA_RPC_URL` overrides it. Switch Phantom to devnet before paying test quotes.

```txt
SOLANA_TREASURY_WALLET=your_solana_treasury_wallet_public_key
SOLANA_PAYMENT_NETWORK=devnet
# Optional custom devnet RPC:
# SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_QUOTE_TTL_MS=300000
```

For live paid purchases, set `SOLANA_PAYMENT_NETWORK=mainnet-beta` and use a funded production treasury wallet:

```txt
SOLANA_PAYMENT_NETWORK=mainnet-beta
# Optional custom mainnet RPC:
# SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
```

`SOLANA_RPC_URL`, `SOLANA_PAYMENT_NETWORK`, and `SOLANA_QUOTE_TTL_MS` are optional. If `SOLANA_RPC_URL` contains a provider key, keep it as a runtime variable only and do not expose it through `NEXT_PUBLIC_` build args.

The Dockerfile also declares build args for public values used by Next.js during `npm run build`:

```txt
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_URL
NEXT_PUBLIC_SITE_URL
NEXT_PUBLIC_AVATURN_URL
```

Only public/browser-safe values are passed this way. Use `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` for the browser build-time Supabase key. Keep AWS keys, OpenAI keys, Telegram tokens, Supabase service role keys, and non-public Supabase runtime aliases such as `SUPABASE_PUBLISHABLE_KEY` or `SUPABASE_ANON_KEY` as Railway runtime variables only.

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

The graph opens in a 3D galaxy powered by `3d-force-graph`. Search, type filters, node selection, and source links help explore the selected project; drag to orbit, scroll to zoom, and use Fit or Reflow to adjust the view. Switch to the 2D map for the existing `cytoscape` and `fcose` layout. Project-scope links are visual guides that bring otherwise disconnected nodes into the view. For large wikis, graph generation should be run per project/intent to avoid a single slow global graph.

## OpenClaw And clawmacdo

The app depends on `clawmacdo` for:

- Fast Lightsail restore/destroy.
- Telegram setup and pairing.
- Remotion avatar setup.
- OpenClaw identity setup.
- Google Workspace credential installation through `gws-login`.
- Wiki generation, tree, read, write, export, and delete.

The installed package is managed through `package.json`. To upgrade:

```sh
npm install clawmacdo@latest
npm run typecheck
npm run build
```

Commit and redeploy after upgrading so Railway rebuilds the Docker image with the updated platform binary.

### Google Workspace Auth

The Settings Google Workspace toggle is persistent user intent. When it is on, a fresh AI CUBER Google login sends the user to the integrations tab instead of running `gws-logout`.

Set `GWS_OAUTH_CLIENT_ID` and `GWS_OAUTH_CLIENT_SECRET`, then add `/api/openclaw/gws-auth/callback` for the local and production app origins to the Google OAuth client's allowed redirect URIs. The settings toggle requests a Google OAuth URL and opens it in a popup. After Google authorizes, the popup sends the OAuth code back to the settings page and closes; the settings page keeps the progress bar active while `/api/openclaw/gws-auth/complete` passes the code to `clawmacdo gws-login --code`.

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
- `/api/openclaw/gws-auth/start` returns the Google Workspace login URL when GWS OAuth env is configured
- `/api/openclaw/gws-auth/callback` captures the Google Workspace OAuth code and returns it to the settings page popup opener
- `/api/openclaw/gws-auth/complete` exchanges the captured code through `clawmacdo gws-login --code` and installs credentials on OpenClaw
- `/admin` script-loaded admin console for quotas, access disablement, workspace deletion, and Bedrock bearer-token overwrite
- `/admin/mfa` Supabase TOTP enrollment and verification for admin sessions
- `/api/health` deployment health check

## Troubleshooting

If login shows `Supabase credentials are required before login can run`, the running server cannot see a Supabase URL and anon/publishable key. Check Railway Variables for `NEXT_PUBLIC_SUPABASE_URL` plus `NEXT_PUBLIC_SUPABASE_ANON_KEY`, or `SUPABASE_URL` plus `SUPABASE_ANON_KEY`.

If Google OAuth redirects to `0.0.0.0`, the app is using Railway's internal request host for a browser redirect. Set `NEXT_PUBLIC_SITE_URL` to the real Railway public URL, redeploy, and make sure that URL is allowed in Supabase Auth redirect URLs. `/api/health` reports `env.siteUrlConfigured` and `env.siteUrlSource` to confirm which public-origin setting is active.

If `/auth/callback` logs `pkce_code_verifier_not_found` with `rawOrigin` or
`origin` containing `0.0.0.0`, remove any `0.0.0.0` value from Railway
Variables and set `NEXT_PUBLIC_SITE_URL=https://kere.ceo,http://localhost:3000`.
In Supabase Auth redirect URLs, allow both `https://kere.ceo/auth/callback` and
`http://localhost:3000/auth/callback`.

If PDF startup logs mention `@napi-rs/canvas`, rebuild with the current Dockerfile. The runtime image must copy `node_modules/@napi-rs`.

If provisioning logs show `spawn /app/node_modules/@clawmacdo/linux-x64/bin/clawmacdo ENOENT` or `GLIBC_2.39 not found`, the container base image is too old for the published clawmacdo Linux binary. Rebuild with the current Debian Trixie slim Dockerfile; it runs `clawmacdo --version` during image build to catch binary/linker issues before deployment.

If provisioning logs show `Permission denied (os error 13)` immediately after starting clawmacdo, the runtime user cannot write to its home/cache/config/workspace path. Rebuild with the current Dockerfile; it chowns `/app` and validates clawmacdo as the non-root `nextjs` user.

If provisioning fails, check Railway logs for sanitized `[clawmacdo]` events, AWS variables, snapshot name, region, and whether the `clawmacdo` version in Railway matches `package-lock.json`.

If logs show `spawn ... EAGAIN`, `Resource temporarily unavailable`, or a Tokio panic saying the OS cannot spawn a worker thread, the container has hit its process/thread limit. Keep `CLAWMACDO_MAX_CONCURRENCY=1`, `CLAWMACDO_TOKIO_WORKER_THREADS=1`, and `CLAWMACDO_RAYON_NUM_THREADS=1`; the app will queue `clawmacdo` calls and retry transient spawn failures.

## Zoom marketplace connection

Users connect Zoom in Marketplace or Settings → Integrations while retaining their existing 2ndBrain login. Meeting Minutes uses an authenticated server-to-server API and receives no Zoom credentials. Apply migration `0038_zoom_connections.sql`, configure the Supabase Zoom provider/manual identity linking and durable encryption-key storage, then complete the admin provider configuration. See [Zoom marketplace setup](docs/ZOOM_MARKETPLACE.md) for deployment steps and the callback allow list.
