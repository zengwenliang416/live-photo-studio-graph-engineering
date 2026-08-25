#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  printf 'usage: %s <new-image-tag>\n' "$0" >&2
  exit 64
fi

state_dir="${DEPLOY_STATE_DIR:-/opt/live-photo-studio}"
new_image="$1"
current_file="${state_dir}/current-image"
previous_file="${state_dir}/previous-image"
previous_image=""

if [ -f "$current_file" ]; then
  previous_image="$(cat "$current_file")"
fi

if [ -n "$previous_image" ] && [ "$previous_image" != "$new_image" ]; then
  printf '%s\n' "$previous_image" >"$previous_file"
fi
printf '%s\n' "$new_image" >"$current_file"

docker images live-photo-studio --format '{{.Repository}}:{{.Tag}}' |
  while IFS= read -r image; do
    [ -n "$image" ] || continue
    [ "$image" = "$new_image" ] && continue
    [ "$image" = "$previous_image" ] && continue
    docker image rm "$image" >/dev/null 2>&1 || true
  done
