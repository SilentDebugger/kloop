# kloop — single production image: API + workers + built web app + CLI.
# Multi-stage: build everything with pnpm, ship a slim runtime.

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

# ---------- install & build ----------
FROM base AS build
COPY pnpm-workspace.yaml package.json .npmrc turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --filter '!@kloop/mobile' --filter '!create-kloop'

COPY packages/shared packages/shared
COPY apps/server apps/server
COPY apps/web apps/web
RUN pnpm --filter @kloop/shared build \
 && pnpm --filter @kloop/web build \
 && pnpm --filter @kloop/server build
# web build output is copied into the server's static dir
RUN mkdir -p apps/server/static && cp -r apps/web/dist/* apps/server/static/

# ---------- runtime ----------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/apps/server/dist ./dist
COPY --from=build /app/apps/server/drizzle ./drizzle
COPY --from=build /app/apps/server/static ./static
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server/package.json ./package.json

RUN mkdir -p /data/storage
VOLUME /data/storage

EXPOSE 8787
# `kloop` CLI inside the container: node dist/cli.js <migrate|admin|seed|doctor>
ENTRYPOINT ["node"]
CMD ["dist/index.js"]
