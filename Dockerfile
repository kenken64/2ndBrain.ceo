# syntax=docker/dockerfile:1

FROM node:26.12.1-trixie-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG SUPABASE_URL
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_AVATURN_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV SUPABASE_URL=$SUPABASE_URL
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_AVATURN_URL=$NEXT_PUBLIC_AVATURN_URL
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:26.12.1-trixie-slim AS runner
WORKDIR /app

ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG SUPABASE_URL
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_AVATURN_URL

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV SUPABASE_URL=$SUPABASE_URL
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_AVATURN_URL=$NEXT_PUBLIC_AVATURN_URL
ENV HOME=/app
ENV XDG_CACHE_HOME=/app/.cache
ENV XDG_CONFIG_HOME=/app/.config
ENV CLAWMACDO_STATE_DIR=/app/.clawmacdo

RUN apt-get update \
  && apt-get install -y --no-install-recommends awscli bash ca-certificates openssh-client unzip \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs --home-dir /app --shell /usr/sbin/nologin nextjs \
  && mkdir -p /app/.cache /app/.clawmacdo /app/.config /app/.openclaw /app/storage/avatars /app/storage/integrations

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/server ./server
COPY --from=builder --chown=nextjs:nodejs /app/scripts/hermes-instance-setup.py ./scripts/hermes-instance-setup.py
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/@clawmacdo ./node_modules/@clawmacdo
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/@napi-rs ./node_modules/@napi-rs
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/@supabase ./node_modules/@supabase
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/asn1 ./node_modules/asn1
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/bcrypt-pbkdf ./node_modules/bcrypt-pbkdf
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/cookie ./node_modules/cookie
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/iceberg-js ./node_modules/iceberg-js
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/safer-buffer ./node_modules/safer-buffer
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/ssh2 ./node_modules/ssh2
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/tweetnacl ./node_modules/tweetnacl
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/tslib ./node_modules/tslib
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/ws ./node_modules/ws

COPY --chmod=0755 scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chown -R nextjs:nodejs /app

USER nextjs

RUN if [ "$(uname -m)" = "x86_64" ]; then ./node_modules/@clawmacdo/linux-x64/bin/clawmacdo --version; fi

EXPOSE 3000

# Loads any mounted Docker secrets (/run/secrets/*) into env vars, then runs CMD.
# No-op passthrough when no secrets are mounted (e.g. Railway).
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

CMD ["node", "server/custom-server.js"]
