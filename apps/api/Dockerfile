# Build from repo root: fly deploy --config apps/api/fly.toml
FROM oven/bun:1@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS deps
WORKDIR /repo
COPY package.json bun.lock* ./
COPY apps/api/package.json ./apps/api/
RUN bun install --frozen-lockfile

FROM oven/bun:1@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS build
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/api/node_modules ./apps/api/node_modules 2>/dev/null || true
COPY prisma/ ./prisma/
COPY apps/api/ ./apps/api/
RUN cd apps/api && bunx prisma generate --config prisma.config.ts

FROM oven/bun:1@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4
WORKDIR /app
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/api ./
EXPOSE 3001
CMD ["bun", "src/index.ts"]
