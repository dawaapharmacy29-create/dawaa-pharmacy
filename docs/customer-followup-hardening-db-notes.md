# Database safety notes

- Duplicate migration is diagnostics-only.
- No historical follow-up row is deleted.
- No unique index is created before legacy duplicate review.
- Any future find-or-create RPC must use a transaction/advisory lock or an equivalent concurrency guard.
- Anonymous write access must not be granted.
