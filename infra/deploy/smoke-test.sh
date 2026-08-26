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
object_storage_endpoint="$(read_env_value "$env_file" OBJECT_STORAGE_ENDPOINT)"
object_storage_bucket="$(read_env_value "$env_file" OBJECT_STORAGE_BUCKET)"

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
  : "${object_storage_endpoint:?OBJECT_STORAGE_ENDPOINT is required}"
  : "${object_storage_bucket:?OBJECT_STORAGE_BUCKET is required}"

  public_headers="$(mktemp)"
  cookie_jar="$(mktemp)"
  registration_headers="$(mktemp)"
  cors_headers="$(mktemp)"
  trap 'rm -f "$public_headers" "$cookie_jar" "$registration_headers" "$cors_headers"' EXIT

  public_web_status="$(
    curl --silent --show-error --output /dev/null \
      --dump-header "$public_headers" --write-out '%{http_code}' \
      --retry 12 --retry-delay 5 --retry-all-errors \
      "$public_url/login"
  )"
  [ "$public_web_status" = "200" ]
  ! grep -qi '^www-authenticate:' "$public_headers"

  public_api_status="$(
    curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
      --retry 12 --retry-delay 5 --retry-all-errors \
      "$public_url/v1/stream-health"
  )"
  [ "$public_api_status" = "200" ]

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
    curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
      --header 'x-user-id: forged-smoke-user' \
      "$public_url/v1/projects"
  )"
  [ "$forged_identity_status" = "401" ]

  registration_status="$(
    curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
      --cookie-jar "$cookie_jar" \
      --dump-header "$registration_headers" \
      --request POST \
      --header "Origin: $public_url" \
      --header 'Content-Type: application/json' \
      --data "$registration_body" \
      "$public_url/v1/auth/register"
  )"
  [ "$registration_status" = "201" ]
  grep -qi '^set-cookie: lps_session=' "$registration_headers"
  grep -i '^set-cookie: lps_session=' "$registration_headers" |
    grep -qi 'httponly'
  grep -i '^set-cookie: lps_session=' "$registration_headers" |
    grep -qi 'samesite=lax'
  grep -i '^set-cookie: lps_session=' "$registration_headers" |
    grep -qi 'secure'

  session_status="$(
    curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
      --cookie "$cookie_jar" \
      "$public_url/v1/auth/session"
  )"
  [ "$session_status" = "200" ]

  projects_status="$(
    curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
      --cookie "$cookie_jar" \
      "$public_url/v1/projects"
  )"
  [ "$projects_status" = "200" ]

  logout_status="$(
    curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
      --cookie "$cookie_jar" \
      --request POST \
      --header "Origin: $public_url" \
      "$public_url/v1/auth/logout"
  )"
  [ "$logout_status" = "200" ]

  revoked_session_status="$(
    curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
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
