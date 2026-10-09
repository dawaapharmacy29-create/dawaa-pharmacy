#!/usr/bin/env bash
# Runs the contract A regression (one open follow-up per customer + branch) against a throwaway local Postgres (never Supabase).
# Usage: scripts/test-db-followup-contract-a.sh   (needs Postgres server binaries; run as root or postgres)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
WORK="$(mktemp -d)"
chmod 755 "$WORK"
RUN=(); if [ "$(id -u)" = "0" ]; then chown postgres "$WORK"; RUN=(runuser -u postgres --); fi
PORT="${PGPORT_TEST:-55442}"
cleanup() { "${RUN[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
"${RUN[@]}" "$PGBIN/initdb" -D "$WORK/data" -U postgres -A trust >/dev/null
"${RUN[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null
PGHOST="$WORK" PGPORT="$PORT" PGUSER=postgres node "$ROOT/scripts/test-followup-contract-a-db.mjs"
