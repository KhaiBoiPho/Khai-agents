#!/usr/bin/env sh
# Dump the application and Docmost databases to ./backups (owner-only),
# keeping the newest 14 of each. Run from cron, e.g. nightly:
#   15 3 * * *  /path/to/docker/stack/backup.sh
set -eu
cd "$(dirname "$0")"
umask 077
mkdir -p backups
stamp=$(date -u +%Y%m%dT%H%M%SZ)
for database in khai docmost; do
  docker compose exec -T postgres pg_dump -U postgres -d "$database" -Fc \
    > "backups/$database-$stamp.dump"
  ls -1t backups/"$database"-*.dump | tail -n +15 | xargs -r rm -f
done
echo "Backups written to $(pwd)/backups"
