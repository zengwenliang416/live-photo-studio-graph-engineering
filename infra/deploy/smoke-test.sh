#!/bin/sh
set -eu

compose_file="${COMPOSE_FILE:-infra/deploy/docker-compose.production.yml}"
env_file="${DEPLOY_ENV_FILE:-/opt/live-photo-studio/.env}"
public_url="${PUBLIC_URL:-}"

. "$env_file"

docker compose --env-file "$env_file" -f "$compose_file" ps

api_status="$(
  curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --header 'x-user-id: health-check' \
    --retry 12 --retry-delay 5 --retry-all-errors \
    "http://127.0.0.1:${API_BIND_PORT:-4040}/v1/stream-health"
)"
[ "$api_status" = "200" ]

web_status="$(
  curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --retry 12 --retry-delay 5 --retry-all-errors \
    "http://127.0.0.1:${WEB_BIND_PORT:-3030}/projects"
)"
[ "$web_status" = "200" ]

if [ -n "$public_url" ]; then
  curl --fail --silent --show-error --head \
    --retry 12 --retry-delay 5 --retry-all-errors \
    "$public_url/" >/dev/null
fi

printf 'live-photo-studio smoke checks passed\n'
