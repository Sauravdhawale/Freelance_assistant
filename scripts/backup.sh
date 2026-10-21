#!/usr/bin/env bash
set -euo pipefail
umask 077
project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"
backup_root="${BACKUP_DIR:-$project_dir/backups}"
if [[ -z "${AGE_RECIPIENT:-}" ]]; then
  printf '%s\n' 'Set AGE_RECIPIENT to your age public encryption recipient. See docs/deployment.md.' >&2
  exit 1
fi
command -v age >/dev/null || { printf '%s\n' 'Install age before running this backup.' >&2; exit 1; }
command -v docker >/dev/null || { printf '%s\n' 'Docker Compose is required.' >&2; exit 1; }
mkdir -p -- "$backup_root"
backup_stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="$backup_root/$backup_stamp"
mkdir -- "$backup_dir"
cleanup_failed_backup() { rm -rf -- "$backup_dir"; }
trap cleanup_failed_backup ERR INT TERM
for database_name in freelance n8n; do
  docker compose exec -T postgres pg_dump --username postgres --format custom --no-owner "$database_name" \
    | age --recipient "$AGE_RECIPIENT" --output "$backup_dir/$database_name.dump.age"
done
# The encryption key is needed to restore n8n credentials. Keep it encrypted.
age --recipient "$AGE_RECIPIENT" --output "$backup_dir/env.age" .env
trap - ERR INT TERM
printf 'Encrypted backup saved to %s\n' "$backup_dir"
printf '%s\n' 'Copy it off this server. Existing backups were retained.'
