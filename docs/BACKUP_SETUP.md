# DAWAA Pharmacy backup setup

This repository contains `.github/workflows/supabase-backup.yml`.

## What the workflow backs up

- Supabase database roles (`roles.sql`)
- Database schema, functions, triggers, policies and grants (`schema.sql`)
- Table data (`data.sql`)
- A complete Git bundle containing all repository branches and tags
- SHA-256 checksums for integrity verification
- Metadata identifying the repository, commit and Supabase project

The result is compressed into one `.tar.gz` file. It is retained as a private GitHub Actions artifact for 30 days and uploaded to the Google Drive folder `01 - Pharmacy App`.

## Required GitHub Actions secrets

Create these under **Repository Settings → Secrets and variables → Actions**:

### `SUPABASE_DB_URL`

Use the database connection string for project `jkjqeqkshllustwlzzbf` (`dawaa-pharmacy-os`). Prefer the Supabase session pooler connection string if GitHub's runner cannot reach the direct IPv6 database endpoint.

The value has this general shape:

```text
postgresql://postgres.PROJECT_REF:DATABASE_PASSWORD@HOST:5432/postgres
```

Never commit this value to the repository.

### `RCLONE_CONFIG_GDRIVE`

This is the complete contents of an rclone configuration containing a Google Drive remote named `gdrive`.

Create it on a trusted computer:

```bash
rclone config
```

Choose:

1. `n` for a new remote
2. Name: `gdrive`
3. Storage: Google Drive
4. Complete browser authorization using the Google account that owns `DAWAA SYSTEM BACKUPS`
5. Copy the resulting rclone configuration file contents into the GitHub secret

Do not commit `rclone.conf` to GitHub.

## Schedule

The workflow runs daily at `01:15 UTC`, which is `04:15` in Cairo during UTC+3. It can also be started manually from the Actions tab.

## Restore order

Extract the archive and restore in this order:

```bash
psql "$TARGET_DB_URL" -f roles.sql
psql "$TARGET_DB_URL" -f schema.sql
psql "$TARGET_DB_URL" -f data.sql
```

For repository recovery:

```bash
git clone repository.bundle restored-repository
```

Before restoring into production, create a new empty Supabase project and test the restore there. Verify row counts, authentication, RLS policies, RPC functions, storage buckets and application login before changing Vercel environment variables.

## Important limitations

The logical SQL dump does not contain Storage object bytes. Storage bucket metadata may be represented in the database, but uploaded images, receipts and attachments require a separate Storage copy workflow.

Supabase Auth users are stored in managed schemas. Test authentication carefully after restore and follow Supabase's current migration documentation rather than assuming application tables alone recreate all user sessions.
