FROM node:24-bookworm-slim AS base
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install
RUN pnpm --filter @live-photo-studio/orchestrator build
CMD ["pnpm", "--filter", "@live-photo-studio/orchestrator", "start"]
