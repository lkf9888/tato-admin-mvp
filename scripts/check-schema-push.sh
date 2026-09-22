#!/bin/sh
#
# Can this commit's schema actually be applied to the database the running
# deploy has?
#
# ⚠️ This is the check that was missing when v0.88.0 took tatocar.co down for
# an hour. CI was green: the code compiled, the types checked, the production
# build succeeded. None of that touches a database that already exists, and
# the failure was `prisma db push` refusing to add a unique constraint to a
# table it had not created itself -- which the entrypoint turns into a crash
# loop and a 502 on every route.
#
# A build that compiles is not a deploy that boots. This step closes the gap by
# doing to a throwaway database exactly what the container does to the real
# one:
#
#   1. build a database with the schema from the commit that is deployed now
#   2. run scripts/schema-predeploy.sh, the same additive DDL the entrypoint
#      runs
#   3. run `prisma db push` with its guard armed, and fail if it refuses
#
# ⚠️ No rows are inserted, and that is not an oversight. Prisma decides from
# the schema diff, not from what is in the tables: an empty database of the
# old shape reproduces the v0.88.0 failure exactly, at exit code 1. Seeding
# would make this slower, make it depend on every required column in the
# repo, and catch nothing more.
set -eu

# On a pull request the deployed schema is the base branch's. On a push to
# main it is whatever main pointed at before the push -- which is the honest
# reference even when the push carries six commits, as the calendar release
# did.
REF="${BASE_SHA:-}"
[ -n "$REF" ] || REF="${BEFORE_SHA:-}"

case "$REF" in
  "" | 0000000000000000000000000000000000000000)
    echo "No previous commit to compare against. Nothing to check."
    exit 0
    ;;
esac

if ! git cat-file -e "${REF}^{commit}" 2>/dev/null; then
  echo "::warning::${REF} is not in this checkout, so the schema push check was skipped."
  exit 0
fi

PROBE_DIR="$(mktemp -d)"
trap 'rm -rf "$PROBE_DIR"' EXIT

if ! git show "${REF}:prisma/schema.prisma" > "$PROBE_DIR/deployed.prisma" 2>/dev/null; then
  echo "::warning::${REF} has no prisma/schema.prisma, so there is nothing to upgrade from."
  exit 0
fi

DATABASE_URL="file:$PROBE_DIR/probe.db"
export DATABASE_URL

echo "Building a throwaway database with the schema at ${REF}..."
if ! npx prisma db push --schema="$PROBE_DIR/deployed.prisma" --skip-generate; then
  # The baseline failing is not this commit's fault, and failing the build for
  # it would teach people to ignore this step.
  echo "::warning::The schema at ${REF} could not be built, so the upgrade could not be checked."
  exit 0
fi

sh scripts/schema-predeploy.sh

echo "Applying this commit's schema to it, exactly as the container does..."
if npx prisma db push --skip-generate; then
  echo "This schema can be deployed onto the database currently running."
  exit 0
fi

cat >&2 <<'MESSAGE'

This commit's schema cannot be applied to the database the current deploy is
running. `prisma db push` refused it, and refusing is the correct behaviour --
it will not make a change it cannot prove is safe for the data already there.

In the container that refusal is fatal. scripts/docker-entrypoint.sh runs
under `set -eu`, so the script ends before `next start`, Railway restarts the
container, and the next boot fails the same way: a crash loop, and a 502 on
every route until somebody pushes a fix.

Two ways forward, in order of preference:

  1. Make the change additive. A new nullable column is free; a new unique
     constraint on an existing column is not.

  2. If the warning is vacuous -- a unique constraint on a column that is
     itself new, for instance, where every existing row takes NULL -- add the
     DDL that makes it additive to scripts/schema-predeploy.sh. Prisma then
     finds nothing destructive left to do and pushes with its guard intact.

What is not a way forward is --accept-data-loss in the entrypoint. It is
permanent, and it would wave through every future destructive change as well.
MESSAGE
echo "::error::This commit's schema cannot be pushed onto the deployed database. See the log above."
exit 1
