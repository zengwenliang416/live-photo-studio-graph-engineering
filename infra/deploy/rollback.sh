#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  printf 'usage: %s <previous-image-tag>\n' "$0" >&2
  exit 64
fi

export APP_IMAGE="$1"
compose_file="${COMPOSE_FILE:-infra/deploy/docker-compose.production.yml}"
env_file="${DEPLOY_ENV_FILE:-/opt/live-photo-studio/.env}"

docker image inspect "$APP_IMAGE" >/dev/null
docker compose --env-file "$env_file" -f "$compose_file" up -d \
  api orchestrator worker-ai worker-media web

COMPOSE_FILE="$compose_file" DEPLOY_ENV_FILE="$env_file" \
  sh infra/deploy/smoke-test.sh
