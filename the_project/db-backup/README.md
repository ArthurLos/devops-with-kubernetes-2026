# db-backup

A `CronJob` (`manifests/cronjob.yaml`) that runs once every 24 hours (`0 0 * * *`, midnight UTC) and backs up the todo database to Google Cloud Storage.

`backup.sh` does the actual work:
1. `pg_dump`s the `todos` database (same Postgres instance `../todo-backend` uses) to a local temp file, named `backup-<UTC timestamp>.sql`.
2. Authenticates to Google Cloud with a service account key mounted from a Secret.
3. Uploads it to the GCS bucket via `gcloud storage cp`.

Configuration is entirely via environment variables, no hardcoded ports/URLs/bucket names in the script (consistent with exercise 2.6's project-wide rule) — all set in `manifests/cronjob.yaml`:
- `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` — same `postgres-credentials` Secret `../todo-backend` already uses.
- `BUCKET_NAME` — `dwk-gke-512012-todo-backup`.
- `GOOGLE_APPLICATION_CREDENTIALS` — path to the mounted service account key file.

## The GCS service account key (exercise 3.10's main setup step)

Per the exercise instructions, this Secret is **deliberately not** part of `../kustomization.yaml` or the GitHub Actions pipeline — it's created once by hand, directly against the cluster, and never committed:

```bash
# one-time: bucket + a dedicated service account scoped to just that bucket
gcloud storage buckets create gs://dwk-gke-512012-todo-backup \
  --project=dwk-gke-512012 --location=europe-west4 --uniform-bucket-level-access

gcloud iam service-accounts create todo-backup-sa --display-name="Todo DB Backup SA"

gcloud storage buckets add-iam-policy-binding gs://dwk-gke-512012-todo-backup \
  --member=serviceAccount:todo-backup-sa@dwk-gke-512012.iam.gserviceaccount.com \
  --role=roles/storage.objectCreator

gcloud storage buckets add-iam-policy-binding gs://dwk-gke-512012-todo-backup \
  --member=serviceAccount:todo-backup-sa@dwk-gke-512012.iam.gserviceaccount.com \
  --role=roles/storage.objectViewer

# generate a key and turn it straight into a Secret — never leave key.json on disk
gcloud iam service-accounts keys create /tmp/key.json \
  --iam-account=todo-backup-sa@dwk-gke-512012.iam.gserviceaccount.com
kubectl create secret generic storage-sa-key -n project --from-file=key.json=/tmp/key.json
shred -u /tmp/key.json   # or: rm -f /tmp/key.json
```

Note the IAM bindings are scoped to the **bucket**, not the whole project (`gcloud storage buckets add-iam-policy-binding`, not `gcloud projects add-iam-policy-binding` as the course example shows) — least-privilege, and no harder to set up.

**Branch environments (exercise 3.7):** since `storage-sa-key` isn't a Kustomize-managed resource, a new per-branch namespace won't have it. `db-backup`'s pods there will fail to start (`FailedMount`, missing Secret) until someone creates the same Secret in that namespace too — acceptable for this exercise, since backups only really matter for the `project` namespace's data.

## Build and deploy

```bash
# build the image (bump the tag when the code changes)
docker build -t db-backup:1.0.0 .

gcloud auth configure-docker europe-west4-docker.pkg.dev
docker tag db-backup:1.0.0 europe-west4-docker.pkg.dev/<project-id>/dwk-repo/db-backup:1.0.0
docker push europe-west4-docker.pkg.dev/<project-id>/dwk-repo/db-backup:1.0.0

# deployed as part of ../kustomization.yaml (see ../README.md) — not applied standalone
```

## Testing

A `CronJob` only fires on schedule, so to test it immediately, trigger a one-off `Job` from it instead of waiting a day:

```bash
kubectl create job -n project --from=cronjob/db-backup db-backup-manual-test
kubectl logs -n project job/db-backup-manual-test

# confirm the backup actually landed
gcloud storage ls -l gs://dwk-gke-512012-todo-backup/

# clean up the test job (the CronJob itself keeps running on schedule)
kubectl delete job -n project db-backup-manual-test
```

Backups can be browsed and downloaded from the [Cloud Storage browser](https://console.cloud.google.com/storage/browser) in the GCP Console.
