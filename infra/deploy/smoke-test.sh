#!/bin/sh
set -eu

compose_file="${COMPOSE_FILE:-infra/deploy/docker-compose.production.yml}"
env_file="${DEPLOY_ENV_FILE:-/opt/live-photo-studio/.env}"

read_env_value() {
  file="$1"
  key="$2"
  value="$(
    sed -n "s/^${key}=//p" "$file" |
      tail -n 1
  )"
  case "$value" in
    \"*\")
      value="${value#\"}"
      value="${value%\"}"
      ;;
    \'*\')
      value="${value#\'}"
      value="${value%\'}"
      ;;
  esac
  printf '%s' "$value"
}

public_url="$(read_env_value "$env_file" PUBLIC_URL)"
auth_env_file="$(read_env_value "$env_file" CANARY_AUTH_ENV_FILE)"
object_storage_endpoint="$(read_env_value "$env_file" OBJECT_STORAGE_ENDPOINT)"
object_storage_bucket="$(read_env_value "$env_file" OBJECT_STORAGE_BUCKET)"

auth_env_file="${auth_env_file:-/opt/live-photo-studio/canary-auth.env}"

docker compose --env-file "$env_file" -f "$compose_file" ps

docker compose --env-file "$env_file" -f "$compose_file" exec -T api \
  node -e "fetch('http://127.0.0.1:4000/v1/stream-health',{headers:{'x-user-id':'health-check'}}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

docker compose --env-file "$env_file" -f "$compose_file" exec -T web \
  node -e "fetch('http://127.0.0.1:3000/projects').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

docker compose --env-file "$env_file" -f "$compose_file" port api 4000 |
  grep -Eq '^127\.0\.0\.1:'
docker compose --env-file "$env_file" -f "$compose_file" port web 3000 |
  grep -Eq '^127\.0\.0\.1:'

if [ -n "$public_url" ]; then
  if [ ! -r "$auth_env_file" ]; then
    printf 'canary auth file is not readable: %s\n' "$auth_env_file" >&2
    exit 66
  fi
  canary_basic_auth_user="$(read_env_value "$auth_env_file" CANARY_BASIC_AUTH_USER)"
  canary_basic_auth_password="$(read_env_value "$auth_env_file" CANARY_BASIC_AUTH_PASSWORD)"
  : "${canary_basic_auth_user:?CANARY_BASIC_AUTH_USER is required}"
  : "${canary_basic_auth_password:?CANARY_BASIC_AUTH_PASSWORD is required}"
  : "${object_storage_endpoint:?OBJECT_STORAGE_ENDPOINT is required}"
  : "${object_storage_bucket:?OBJECT_STORAGE_BUCKET is required}"

  public_unauthorized_status="$(
    curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
      --head --retry 12 --retry-delay 5 --retry-all-errors \
      "$public_url/"
  )"
  [ "$public_unauthorized_status" = "401" ]

  public_web_status="$(
    curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
      --user "${canary_basic_auth_user}:${canary_basic_auth_password}" \
      --retry 12 --retry-delay 5 --retry-all-errors \
      "$public_url/projects"
  )"
  [ "$public_web_status" = "200" ]

  public_api_status="$(
    curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
      --user "${canary_basic_auth_user}:${canary_basic_auth_password}" \
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
    "${object_storage_endpoint}/${object_storage_bucket}/live-photo-studio/cors-probe"
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
