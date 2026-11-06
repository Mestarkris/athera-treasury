#!/usr/bin/env bash
# Adds NEARAI_API_KEY to .env without showing it on screen or in shell history.
set -euo pipefail
cd "$(dirname "$0")/.."
read -rs -p "Paste your NEAR AI key, then press Enter: " key
echo
key="$(printf '%s' "$key" | tr -d '[:space:]')"
if [ -z "$key" ]; then
  echo "Nothing was pasted; .env is unchanged." >&2
  exit 1
fi
touch .env
chmod 600 .env
# Replace an existing line, or append one.
grep -v '^NEARAI_API_KEY=' .env > .env.tmp || true
printf 'NEARAI_API_KEY=%s\n' "$key" >> .env.tmp
mv .env.tmp .env
chmod 600 .env
unset key
echo "Saved NEARAI_API_KEY to .env (value not shown)."
