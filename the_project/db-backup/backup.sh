#!/usr/bin/env bash
set -euo pipefail

: "${PGHOST:?PGHOST must be set}"
: "${PGPORT:?PGPORT must be set}"
: "${PGUSER:?PGUSER must be set}"
: "${PGPASSWORD:?PGPASSWORD must be set}"
: "${PGDATABASE:?PGDATABASE must be set}"
: "${BUCKET_NAME:?BUCKET_NAME must be set}"
: "${GOOGLE_APPLICATION_CREDENTIALS:?GOOGLE_APPLICATION_CREDENTIALS must be set}"

TIMESTAMP=$(date -u +%Y-%m-%d_%H-%M-%S)
BACKUP_FILE="/tmp/backup-${TIMESTAMP}.sql"

echo "Dumping $PGDATABASE from $PGHOST..."
pg_dump -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" > "$BACKUP_FILE"

echo "Authenticating to Google Cloud..."
gcloud auth activate-service-account --key-file="$GOOGLE_APPLICATION_CREDENTIALS"

echo "Uploading to gs://${BUCKET_NAME}/backup-${TIMESTAMP}.sql..."
gcloud storage cp "$BACKUP_FILE" "gs://${BUCKET_NAME}/backup-${TIMESTAMP}.sql"

rm -f "$BACKUP_FILE"
echo "Backup complete."
