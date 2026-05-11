# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN apk add --no-cache aws-cli bash openssh-client \
  && addgroup -S nodejs \
  && adduser -S nextjs -G nodejs \
  && mkdir -p /app/storage/avatars \
  && chown -R nextjs:nodejs /app/storage

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/@clawmacdo ./node_modules/@clawmacdo
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/@napi-rs ./node_modules/@napi-rs

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
