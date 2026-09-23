#!/bin/sh
#
# Additive DDL that must exist before `prisma db push` runs.
#
# ⚠️ Run by two callers, and that is the point: `docker-entrypoint.sh` runs it
# at boot, and CI runs it inside the check that pushes this commit's schema
# onto the previously deployed one. A guard that tests something other than
# what the container does is a guard that passes while production is down.
#
# Everything in here must be additive and idempotent. Each statement fails on
# every deploy after the first -- "duplicate column name", "index already
# exists" -- and that is the intended steady state, which is why failures are
# logged and swallowed. Nothing is masked by doing so: `prisma db push` runs
# immediately afterwards with its own guard fully armed, and if a statement
# did not take, that push fails exactly as it would have anyway.
#
# ## Why anything is here at all
#
# v0.88.0 added `OrderAttachment.shareToken String? @unique`. On SQLite a
# unique constraint is a separate index, and `prisma db push` will not add one
# to an existing table without `--accept-data-loss`: it cannot know the values
# already in the column are not duplicates. It exits non-zero, the entrypoint
# runs under `set -eu`, and the container dies before `next start` -- a crash
# loop that took tatocar.co down with a 502 on every route.
#
# The warning was vacuous there. The column was new, so every existing row
# takes NULL, and SQLite permits unlimited NULLs in a unique index. But
# `--accept-data-loss` in the entrypoint is permanent and would wave through
# every future destructive change as well, so the column and its index are
# created here instead, under Prisma's own naming, leaving `db push` with
# nothing destructive left to do.
#
# ## Deleting from here
#
# A statement can go once every environment has booted at least once on the
# version that introduced it. Nothing breaks if one is left behind -- it
# simply fails and logs forever -- but this file is a list of things that went
# wrong, and a list nobody prunes stops being read.
#
#   shareToken / OrderAttachment_shareToken_key -- added v0.89.1
#   renterToken / Order_renterToken_key -- added v0.95.0
set -eu

for statement in \
  'ALTER TABLE "OrderAttachment" ADD COLUMN "shareToken" TEXT;' \
  'CREATE UNIQUE INDEX "OrderAttachment_shareToken_key" ON "OrderAttachment"("shareToken");' \
  'ALTER TABLE "Order" ADD COLUMN "renterToken" TEXT;' \
  'CREATE UNIQUE INDEX "Order_renterToken_key" ON "Order"("renterToken");'
do
  if echo "$statement" | npx prisma db execute --stdin --schema=prisma/schema.prisma >/dev/null 2>&1; then
    echo "[schema-predeploy] applied: $statement"
  else
    echo "[schema-predeploy] already present, skipping: $statement"
  fi
done
