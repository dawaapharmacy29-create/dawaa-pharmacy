#!/usr/bin/env bash
# Runs the conversation-review manager correction migration against a throwaway local Postgres
# (never Supabase): live-mirrored fixture -> committed guard/points migrations -> this migration -> tests.
# Usage: scripts/test-db-conversation-review-correction.sh   (needs Postgres server binaries; run as root or postgres)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
WORK="$(mktemp -d)"
chmod 755 "$WORK"
RUN=(); if [ "$(id -u)" = "0" ]; then chown postgres "$WORK"; RUN=(runuser -u postgres --); fi
PORT="${PGPORT_TEST:-55441}"
cleanup() { "${RUN[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
"${RUN[@]}" "$PGBIN/initdb" -D "$WORK/data" -U postgres -A trust >/dev/null
"${RUN[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null
PSQL=("${RUN[@]}" "$PGBIN/psql" -h "$WORK" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -f "$ROOT/supabase/tests/conversation_review_correction_session_v1.fixture.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261005124500_automatic_review_writer_guard_v2.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261005135500_automatic_review_guard_order_v2.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261005170000_conversation_review_points_staff_session_v1.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261008160000_conversation_review_manager_correction_versioning_v1.sql"
"${PSQL[@]}" -f "$ROOT/supabase/tests/conversation_review_correction_session_v1.test.sql"
