#!/bin/sh
set -eu

export DATABASE_URL="${DATABASE_URL:-file:/app/data/tato-prod.db}"

DB_PATH="${DATABASE_URL#file:}"

if [ "${NODE_ENV:-production}" = "production" ] && [ -n "${RAILWAY_ENVIRONMENT:-}" ]; then
  if [ -z "${RAILWAY_VOLUME_MOUNT_PATH:-}" ]; then
    echo "Refusing to start on Railway without a mounted persistent volume."
    echo "Attach a Railway Volume and mount it to /app/data before deploying."
    exit 1
  fi

  if [ "${RAILWAY_VOLUME_MOUNT_PATH}" != "/app/data" ]; then
    echo "Refusing to start because Railway volume is mounted at ${RAILWAY_VOLUME_MOUNT_PATH}."
    echo "This app requires the volume mount path to be /app/data."
    exit 1
  fi

  case "$DATABASE_URL" in
    file:/app/data/*) ;;
    *)
      echo "Refusing to start because DATABASE_URL is not using the Railway persistent volume."
      echo "Set DATABASE_URL to a file path under /app/data, for example: file:/app/data/tato-prod.db"
      exit 1
      ;;
  esac
fi

mkdir -p /app/data

if [ "$DB_PATH" != "$DATABASE_URL" ]; then
  mkdir -p "$(dirname "$DB_PATH")"
fi

if [ "$DB_PATH" != "$DATABASE_URL" ] && [ -f "$DB_PATH" ]; then
  mkdir -p /app/data/backups
  cp "$DB_PATH" "/app/data/backups/$(basename "$DB_PATH" .db)-predeploy-$(date +%Y%m%d%H%M%S).db"
fi

if ! npx prisma db push; then
  echo "Prisma schema sync failed without applying destructive changes."
  echo "Existing data was left untouched. Review the schema diff and ship a safe migration before redeploying."
  exit 1
fi

npx tsx prisma/bootstrap-admins.ts

PORT="${PORT:-3000}"

exec npx next start -H 0.0.0.0 -p "$PORT"
