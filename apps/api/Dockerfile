# Build from repo root: fly deploy --config apps/api/fly.toml
FROM oven/bun:1 AS deps
WORKDIR /repo
COPY package.json bun.lock* ./
COPY apps/api/package.json ./apps/api/
RUN bun install --frozen-lockfile

FROM oven/bun:1 AS build
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/api/node_modules ./apps/api/node_modules 2>/dev/null || true
COPY prisma/ ./prisma/
COPY apps/api/ ./apps/api/
RUN cd apps/api && bunx prisma generate --config prisma.config.ts

FROM oven/bun:1
WORKDIR /app
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/api ./
EXPOSE 3001
CMD ["bun", "src/index.ts"]
