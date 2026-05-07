#!/bin/sh
set -eu

mkdir -p /app/data

npx prisma db push

exec npx next start -H 0.0.0.0 -p 3000
