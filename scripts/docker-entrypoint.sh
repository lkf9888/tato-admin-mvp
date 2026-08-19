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

UPLOAD_ROOT="${TATO_UPLOAD_DIR:-/app/data/uploads}"

if [ "${NODE_ENV:-production}" = "production" ]; then
  case "$UPLOAD_ROOT" in
    /app/data|/app/data/*) ;;
    *)
      echo "Refusing to start because TATO_UPLOAD_DIR is not using the persistent data directory."
      echo "Set TATO_UPLOAD_DIR to a path under /app/data, or leave it empty to use /app/data/uploads."
      exit 1
      ;;
  esac
fi

mkdir -p "$UPLOAD_ROOT"

if [ "$DB_PATH" != "$DATABASE_URL" ]; then
  mkdir -p "$(dirname "$DB_PATH")"
fi

if [ "$DB_PATH" != "$DATABASE_URL" ] && [ -f "$DB_PATH" ]; then
  # Pre-deploy DB snapshot. Two cleanups baked in:
  #
  # 1. Prune BEFORE the new snapshot. Keep the 3 most recent backups
  #    and delete everything older. Without this the backups directory
  #    grew unbounded — by v0.22.x the Railway volume filled up, every
  #    deploy's `cp` failed with ENOSPC, and `set -eu` exited the
  #    script before `next start`, putting the container into a tight
  #    crash loop.
  #
  #    That fix kept ten snapshots, which was right when the database
  #    was small and became the next incarnation of the same problem
  #    when it was not: measured at 90.6% full, backups were 332.6 MB
  #    of a 433 MB volume -- 84% of everything used, against 19.6 MB
  #    of actual uploads. Ten copies of a 30 MB database is not a
  #    retention policy, it is the largest thing on the disk. Three is
  #    what a rollback reaches for: the deploy that just broke, the one
  #    before it, and one more for nerve. `ls -t` orders by mtime newest-first; `tail -n +4`
  #    drops the first 3; `xargs -r rm -f` deletes the rest. The
  #    `2>/dev/null` and final `|| true` make the prune itself never
  #    abort the entrypoint, even if the directory doesn't exist or
  #    glob matches nothing.
  #
  # 2. Tolerate ENOSPC on the snapshot itself. Even after pruning, an
  #    /app/data full of attachment uploads could leave too little
  #    headroom for a fresh DB copy. The DB is still untouched on
  #    disk, so we'd rather start the app without a fresh snapshot
  #    than refuse to come up at all. Log the skip so it's visible in
  #    Railway's deploy logs.
  mkdir -p /app/data/backups || true
  ls -t /app/data/backups/*.db 2>/dev/null | tail -n +4 | xargs -r rm -f -- || true
  if ! cp "$DB_PATH" "/app/data/backups/$(basename "$DB_PATH" .db)-predeploy-$(date +%Y%m%d%H%M%S).db"; then
    echo "[entrypoint] Pre-deploy DB snapshot failed (volume full?). Skipping snapshot and continuing."
  fi
fi

if ! npx prisma db push; then
  echo "Prisma schema sync failed without applying destructive changes."
  echo "Existing data was left untouched. Review the schema diff and ship a safe migration before redeploying."
  exit 1
fi

npx tsx prisma/bootstrap-admins.ts
npx tsx prisma/bootstrap-workspaces.ts

PORT="${PORT:-3000}"

exec npx next start -H 0.0.0.0 -p "$PORT"
