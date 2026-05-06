# 2ndBrain.ceo

Next.js full-stack app initialized from `design.md` with Supabase SSR auth, Google OAuth,
Railway standalone deployment settings, and a warm Lovable-inspired frontend system.

## Stack

- Next.js App Router
- React and TypeScript
- Supabase Auth and Postgres through `@supabase/ssr`
- Google OAuth via Supabase
- Railway-ready standalone Next.js output

## Quick start

```sh
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

Fill `.env.local` with your Supabase project URL and publishable key before using login.
Do not commit real `.env` files; `.gitignore` and `.dockerignore` exclude them.
Google OAuth client secrets should stay in the Supabase Auth provider settings, not in
the Next.js app or Docker image.

## Supabase setup

Run the schema in `supabase/migrations/0001_app_schema.sql` from the Supabase SQL Editor.
Then enable Google in Supabase Auth providers and add these redirect URLs:

```txt
http://localhost:3000/auth/callback
https://your-railway-domain.up.railway.app/auth/callback
```

More deployment notes live in `docs/supabase-railway.md`.

## Railway

`railway.json` pins Railway to the root `Dockerfile`, starts the standalone
Next.js server with `node server.js`, and uses `/api/health` as the deployment
health check. The Docker image is a multi-stage build that runs `npm ci`,
executes `npm run build`, and copies Next.js standalone output into the runtime
image.

Runtime configuration comes from Railway Variables, matching `.env.example`.
No Supabase keys or OAuth secrets are baked into the Dockerfile.

## Routes

- `/` marketing homepage
- `/login` Google OAuth login
- `/dashboard` protected product dashboard
- `/onboarding` design-system onboarding surface
- `/api/health` backend health check
- `/api/projects` authenticated project API
