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

wait_for_service() {
  service="$1"
  probe="$2"
  attempt=1
  while [ "$attempt" -le 12 ]; do
    if docker compose --env-file "$env_file" -f "$compose_file" exec -T "$service" \
      node -e "$probe"; then
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 5
  done
  return 1
}

wait_for_service api \
  "fetch('http://127.0.0.1:4000/v1/stream-health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
wait_for_service web \
  "fetch('http://127.0.0.1:3000/projects').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

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

  public_curl() {
    curl --user "${canary_basic_auth_user}:${canary_basic_auth_password}" "$@"
  }

  public_unauthorized_status="$(
    curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
      --head --retry 12 --retry-delay 5 --retry-all-errors \
      "$public_url/"
  )"
  [ "$public_unauthorized_status" = "401" ]

  public_web_status="$(
    public_curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
      --retry 12 --retry-delay 5 --retry-all-errors \
      "$public_url/login"
  )"
  [ "$public_web_status" = "200" ]

  public_api_status="$(
    public_curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
      --retry 12 --retry-delay 5 --retry-all-errors \
      "$public_url/v1/stream-health"
  )"
  [ "$public_api_status" = "200" ]

  cookie_jar="$(mktemp)"
  cors_headers="$(mktemp)"
  trap 'rm -f "$cookie_jar" "$cors_headers"' EXIT

  smoke_suffix="$(
    od -An -N8 -tx1 /dev/urandom |
      tr -d ' \n'
  )"
  smoke_email="release-smoke-${smoke_suffix}@example.invalid"
  smoke_password="LpsSmoke-${smoke_suffix}-A9!"
  registration_body="$(
    printf '{"email":"%s","password":"%s","displayName":"Release Smoke"}' \
      "$smoke_email" "$smoke_password"
  )"

  forged_identity_status="$(
    public_curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
      --header 'x-user-id: forged-smoke-user' \
      "$public_url/v1/projects"
  )"
  [ "$forged_identity_status" = "401" ]

  registration_status="$(
    public_curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
      --cookie-jar "$cookie_jar" \
      --request POST \
      --header "Origin: $public_url" \
      --header 'Content-Type: application/json' \
      --data "$registration_body" \
      "$public_url/v1/auth/register"
  )"
  [ "$registration_status" = "201" ]

  session_status="$(
    public_curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
      --cookie "$cookie_jar" \
      "$public_url/v1/auth/session"
  )"
  [ "$session_status" = "200" ]

  project_status="$(
    public_curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
      --cookie "$cookie_jar" \
      --request POST \
      --header "Origin: $public_url" \
      --header "Idempotency-Key: release-smoke-${smoke_suffix}" \
      --header 'Content-Type: application/json' \
      --data '{"title":"Release smoke project"}' \
      "$public_url/v1/projects"
  )"
  [ "$project_status" = "201" ]

  projects_status="$(
    public_curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
      --cookie "$cookie_jar" \
      "$public_url/v1/projects"
  )"
  [ "$projects_status" = "200" ]

  logout_status="$(
    public_curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
      --cookie "$cookie_jar" \
      --request POST \
      --header "Origin: $public_url" \
      "$public_url/v1/auth/logout"
  )"
  [ "$logout_status" = "200" ]

  revoked_session_status="$(
    public_curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
      --cookie "$cookie_jar" \
      "$public_url/v1/auth/session"
  )"
  [ "$revoked_session_status" = "401" ]

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
