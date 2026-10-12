#!/usr/bin/env bash
# Backups of the hosted Bauwerk, pulled from the server to this PC, so a copy lives off the
# server and nothing on it is edited by hand (deploy/README.md, "Backups").
#
#   backup.sh         the app database every time, the LoD2 database when its newest copy is a
#                     week old (bauwerk-backup.timer runs this nightly)
#   backup.sh app     only the app database, now
#   backup.sh lod2    only the LoD2 database, now
#
# Each dump goes to a temporary name and is renamed only when pg_dump succeeded; any failure
# ends with a non-zero exit, so the systemd unit shows as failed.
set -euo pipefail
# The dumps hold accounts and projects: readable by this user only.
umask 077

HOST=${BAUWERK_BACKUP_HOST:-deploy@138.199.213.29}
DIR=${BAUWERK_BACKUP_DIR:-$HOME/backups/bauwerk}
KEEP_APP=7
KEEP_LOD2=4
COMPOSE='cd /srv/bauwerk && docker compose -f deploy/docker-compose.yml --env-file deploy/.env'

# The LoD2 data (about 3.6 GB in the database) from the postgis container.
LOD2_REMOTE="set -eu; $COMPOSE exec -T postgis pg_dump -U lod2 -d lod2 -Fc"

# The schema app, with pg_dump 17 from the postgis container. The Supabase address is read from
# deploy/.env on the server and handed to the container on stdin, so it is never printed nor
# put on a command line here. Without it the server runs on the local "bauwerk" database.
read -r -d '' APP_REMOTE <<'EOF' || true
set -eu
cd /srv/bauwerk
url=$(sed -n 's/^BAUWERK_DATABASE_URL=//p' deploy/.env | tail -n 1)
url=${url#\"}; url=${url%\"}; url=${url#\'}; url=${url%\'}
compose="docker compose -f deploy/docker-compose.yml --env-file deploy/.env"
if [ -n "$url" ]; then
  printf '%s\n' "$url" | $compose exec -T postgis sh -c 'read -r u && [ -n "$u" ] && exec pg_dump -Fc -n app -d "$u"'
else
  $compose exec -T postgis pg_dump -U lod2 -d bauwerk -Fc -n app
fi
EOF

mkdir -p "$DIR"
failed=0

# dump <kind> <keep> <remote command>
dump() {
  local kind=$1 keep=$2 remote=$3
  local final
  final="$DIR/$kind-$(date +%Y%m%d-%H%M%S).dump"
  local tmp="$final.part"
  if ! ssh -n -o BatchMode=yes -o ConnectTimeout=20 "$HOST" "$remote" >"$tmp"; then
    rm -f "$tmp"
    echo "bauwerk-backup: the $kind dump FAILED, no new copy kept" >&2
    return 1
  fi
  # A custom-format dump starts with PGDMP; anything else is an error text, not a backup.
  if [ "$(head -c 5 "$tmp")" != PGDMP ]; then
    rm -f "$tmp"
    echo "bauwerk-backup: the $kind dump is not a pg_dump file, no new copy kept" >&2
    return 1
  fi
  mv "$tmp" "$final" || return 1
  echo "bauwerk-backup: $final ($(du -h "$final" | cut -f1))"
  # Keep the newest $keep; the names sort by time.
  find "$DIR" -maxdepth 1 -name "$kind-*.dump" | sort -r | tail -n +"$((keep + 1))" | xargs -r rm --
}

lod2_due() {
  # Due when no LoD2 copy is younger than a week.
  [ -z "$(find "$DIR" -maxdepth 1 -name 'lod2-*.dump' -mtime -7)" ]
}

case "${1:-}" in
  app) dump app "$KEEP_APP" "$APP_REMOTE" || failed=1 ;;
  lod2) dump lod2 "$KEEP_LOD2" "$LOD2_REMOTE" || failed=1 ;;
  "")
    dump app "$KEEP_APP" "$APP_REMOTE" || failed=1
    if lod2_due; then dump lod2 "$KEEP_LOD2" "$LOD2_REMOTE" || failed=1; fi
    ;;
  *)
    echo "usage: backup.sh [app|lod2]" >&2
    exit 2
    ;;
esac
exit "$failed"
