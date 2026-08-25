#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  printf 'usage: %s <commit-sha>\n' "$0" >&2
  exit 64
fi

commit_sha="$1"
if ! printf '%s' "$commit_sha" | grep -Eq '^[0-9a-f]{40}$'; then
  printf 'commit SHA must be 40 lowercase hexadecimal characters\n' >&2
  exit 65
fi

compose_file="${COMPOSE_FILE:-infra/deploy/docker-compose.production.yml}"
env_file="${DEPLOY_ENV_FILE:-/opt/live-photo-studio/.env}"
state_dir="${DEPLOY_STATE_DIR:-/opt/live-photo-studio}"
deploy_sha="$(printf '%s' "$commit_sha" | cut -c1-12)"
export APP_IMAGE="live-photo-studio:$deploy_sha"

docker build --pull \
  --label "org.opencontainers.image.revision=$commit_sha" \
  --build-arg NEXT_PUBLIC_API_BASE= \
  --build-arg NEXT_PUBLIC_GRAPH_WORKFLOW_ENABLED=true \
  -t "$APP_IMAGE" \
  -f infra/docker/app.Dockerfile \
  .

docker compose --env-file "$env_file" -f "$compose_file" run --rm migrate
docker compose --env-file "$env_file" -f "$compose_file" run --rm checkpoint-setup
docker compose --env-file "$env_file" -f "$compose_file" up -d --remove-orphans

COMPOSE_FILE="$compose_file" DEPLOY_ENV_FILE="$env_file" \
  sh infra/deploy/smoke-test.sh
DEPLOY_STATE_DIR="$state_dir" sh infra/deploy/record-release.sh "$APP_IMAGE"
