#!/usr/bin/env bash
# Adds the hosted store's REST URL and token to .env. The token is not shown on screen or saved
# in shell history. Both come from Vercel → your project → Storage → the Upstash database → .env.local tab.
set -euo pipefail
cd "$(dirname "$0")/.."
read -r -p "KV_REST_API_URL (https://….upstash.io): " url
read -rs -p "KV_REST_API_TOKEN (hidden), then Enter: " token
echo
url="$(printf '%s' "$url" | tr -d '[:space:]"')"
token="$(printf '%s' "$token" | tr -d '[:space:]"')"
case "$url" in https://*) ;; *) echo "The URL should start with https://; .env is unchanged." >&2; exit 1 ;; esac
if [ -z "$token" ]; then echo "No token pasted; .env is unchanged." >&2; exit 1; fi
touch .env
chmod 600 .env
grep -v -e '^KV_REST_API_URL=' -e '^KV_REST_API_TOKEN=' .env > .env.tmp || true
printf 'KV_REST_API_URL=%s\nKV_REST_API_TOKEN=%s\n' "$url" "$token" >> .env.tmp
mv .env.tmp .env
chmod 600 .env
unset token
echo "Saved KV_REST_API_URL and KV_REST_API_TOKEN to .env (token not shown)."
