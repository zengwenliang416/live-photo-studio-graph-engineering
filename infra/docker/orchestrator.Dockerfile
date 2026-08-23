FROM node:24-bookworm-slim AS base
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm -r build
CMD ["pnpm", "--filter", "@live-photo-studio/orchestrator", "start"]
