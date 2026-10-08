#!/usr/bin/env bash
# Runs the Evidence V17 link command migration against a throwaway local Postgres (never Supabase).
# Usage: scripts/test-db-evidence-journey-link.sh   (needs Postgres server binaries; run as root or postgres)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
WORK="$(mktemp -d)"
chmod 755 "$WORK"
RUN=(); if [ "$(id -u)" = "0" ]; then chown postgres "$WORK"; RUN=(runuser -u postgres --); fi
PORT="${PGPORT_TEST:-55439}"
cleanup() { "${RUN[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
"${RUN[@]}" "$PGBIN/initdb" -D "$WORK/data" -U postgres -A trust >/dev/null
"${RUN[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null
PSQL=("${RUN[@]}" "$PGBIN/psql" -h "$WORK" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -f "$ROOT/supabase/tests/whatsapp_evidence_journey_link_session_v1.fixture.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261008104059_whatsapp_evidence_journey_link_staff_session_v1.sql"
"${PSQL[@]}" -f "$ROOT/supabase/tests/whatsapp_evidence_journey_link_session_v1.test.sql"
