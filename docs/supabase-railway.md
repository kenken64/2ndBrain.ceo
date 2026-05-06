# Supabase, Google OAuth, and Railway

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Fill in:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `NEXT_PUBLIC_SITE_URL=http://localhost:3000`
3. In Supabase SQL Editor, run `supabase/migrations/0001_app_schema.sql`.
4. In Supabase Auth, enable Google as a provider.
5. Add redirect URLs:
   - `http://localhost:3000/auth/callback`
   - `https://your-railway-domain.up.railway.app/auth/callback`

Do not commit `.env.local`. Google OAuth client ID and client secret belong in
the Supabase Auth provider settings. The app only needs the Supabase URL,
publishable key, and site URL.

## Railway deployment

This project uses Next.js standalone output through `next.config.ts` and builds
with the root `Dockerfile` on Railway.

Railway service variables:

```txt
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key
NEXT_PUBLIC_SITE_URL=https://your-railway-domain.up.railway.app
```

Keep these in Railway Variables. Do not add production values to the Dockerfile
or commit them to the repository.

Railway reads `railway.json`, which sets:

```json
{
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "Dockerfile"
  },
  "deploy": {
    "startCommand": "node server.js",
    "healthcheckPath": "/api/health"
  }
}
```

The Dockerfile build stage runs:

```sh
npm ci
npm run build
```

## Backend surface

- `GET /api/health` reports Supabase configuration and auth state.
- `GET /api/projects` returns the signed-in user's projects.
- `POST /api/projects` creates a signed-in user's draft project.

The API uses Supabase SSR cookies and row level security. Do not add a service role key
to browser-facing code.
