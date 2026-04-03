#!/bin/sh
set -eu

mkdir -p /app/data

npx prisma db push

PORT="${PORT:-3000}"

exec npx next start -H 0.0.0.0 -p "$PORT"
