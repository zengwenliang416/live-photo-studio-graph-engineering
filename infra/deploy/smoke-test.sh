#!/bin/sh
set -eu

compose_file="${COMPOSE_FILE:-infra/deploy/docker-compose.production.yml}"
env_file="${DEPLOY_ENV_FILE:-/opt/live-photo-studio/.env}"

. "$env_file"

public_url="${PUBLIC_URL:-}"
auth_env_file="${CANARY_AUTH_ENV_FILE:-/opt/live-photo-studio/canary-auth.env}"

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
  if [ ! -r "$auth_env_file" ]; then
    printf 'canary auth file is not readable: %s\n' "$auth_env_file" >&2
    exit 66
  fi
  . "$auth_env_file"
  : "${CANARY_BASIC_AUTH_USER:?CANARY_BASIC_AUTH_USER is required}"
  : "${CANARY_BASIC_AUTH_PASSWORD:?CANARY_BASIC_AUTH_PASSWORD is required}"

  public_unauthorized_status="$(
    curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
      --head --retry 12 --retry-delay 5 --retry-all-errors \
      "$public_url/"
  )"
  [ "$public_unauthorized_status" = "401" ]

  public_web_status="$(
    curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
      --user "${CANARY_BASIC_AUTH_USER}:${CANARY_BASIC_AUTH_PASSWORD}" \
      --retry 12 --retry-delay 5 --retry-all-errors \
      "$public_url/projects"
  )"
  [ "$public_web_status" = "200" ]

  public_api_status="$(
    curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
      --user "${CANARY_BASIC_AUTH_USER}:${CANARY_BASIC_AUTH_PASSWORD}" \
      --header 'x-user-id: health-check' \
      --retry 12 --retry-delay 5 --retry-all-errors \
      "$public_url/v1/stream-health"
  )"
  [ "$public_api_status" = "200" ]

  cors_headers="$(mktemp)"
  trap 'rm -f "$cors_headers"' EXIT
  curl --fail --silent --show-error --output /dev/null \
    --dump-header "$cors_headers" \
    --request OPTIONS \
    --header "Origin: $public_url" \
    --header 'Access-Control-Request-Method: PUT' \
    --header 'Access-Control-Request-Headers: content-type' \
    --retry 12 --retry-delay 5 --retry-all-errors \
    "${OBJECT_STORAGE_ENDPOINT}/${OBJECT_STORAGE_BUCKET}/live-photo-studio/cors-probe"
  allowed_origin="$(
    grep -i '^access-control-allow-origin:' "$cors_headers" |
      head -n 1 |
      cut -d: -f2- |
      tr -d '\r' |
      sed 's/^[[:space:]]*//'
  )"
  [ "$allowed_origin" = "$public_url" ]
fi

printf 'live-photo-studio smoke checks passed\n'
