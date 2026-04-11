#!/bin/sh
set -eu

export DATABASE_URL="${DATABASE_URL:-file:/app/data/tato-prod.db}"

DB_PATH="${DATABASE_URL#file:}"

mkdir -p /app/data

if [ "$DB_PATH" != "$DATABASE_URL" ]; then
  mkdir -p "$(dirname "$DB_PATH")"
fi

npx prisma db push --accept-data-loss

PORT="${PORT:-3000}"

exec npx next start -H 0.0.0.0 -p "$PORT"
