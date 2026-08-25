FROM node:24-bookworm-slim AS build

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.20.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY apps ./apps
COPY packages ./packages

RUN pnpm install --frozen-lockfile

ARG NEXT_PUBLIC_API_BASE=""
ARG NEXT_PUBLIC_GRAPH_WORKFLOW_ENABLED=true
ENV NEXT_PUBLIC_API_BASE=${NEXT_PUBLIC_API_BASE}
ENV NEXT_PUBLIC_GRAPH_WORKFLOW_ENABLED=${NEXT_PUBLIC_GRAPH_WORKFLOW_ENABLED}
ENV NEXT_TELEMETRY_DISABLED=1

RUN pnpm -r build

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

RUN npm install --global pnpm@10.20.0
COPY --from=build --chown=node:node /app /app

USER node
CMD ["pnpm", "--filter", "@live-photo-studio/web", "start"]
