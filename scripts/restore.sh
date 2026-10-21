#!/usr/bin/env bash
set -euo pipefail
umask 077
if [[ "${1:-}" != '--confirm-restore' || -z "${2:-}" || -z "${AGE_IDENTITY:-}" ]]; then
  printf '%s\n' 'Usage: AGE_IDENTITY=/private/backup-key.txt bash scripts/restore.sh --confirm-restore /path/to/backup-directory' >&2
  printf '%s\n' 'This replaces the current freelance and n8n database contents. Read docs/deployment.md first.' >&2
  exit 1
fi
project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
restore_dir="$(cd -- "$2" && pwd)"
cd "$project_dir"
command -v age >/dev/null
[[ -r "$restore_dir/freelance.dump.age" && -r "$restore_dir/n8n.dump.age" ]]
[[ -r "$AGE_IDENTITY" ]]
# Prove both backup files decrypt before touching the current databases.
for database_name in freelance n8n; do
  age --decrypt --identity "$AGE_IDENTITY" "$restore_dir/$database_name.dump.age" > /dev/null
done
docker compose stop app n8n
for database_name in freelance n8n; do
  if [[ "$database_name" == freelance ]]; then restore_role=freelance_app; else restore_role=n8n_app; fi
  age --decrypt --identity "$AGE_IDENTITY" "$restore_dir/$database_name.dump.age" \
    | docker compose exec -T postgres pg_restore --username postgres --role "$restore_role" \
      --dbname "$database_name" --clean --if-exists --no-owner --exit-on-error
done
printf '%s\n' 'Database restore completed. App and n8n remain stopped.'
printf '%s\n' 'Confirm that .env contains the original N8N_ENCRYPTION_KEY before restarting. See docs/deployment.md.'
