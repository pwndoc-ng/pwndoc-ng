#!/bin/bash
# pwndoc-ng MongoDB: MongoDB 8 with a transparent migration of the data of MongoDB 4.x installations
#
# Volume /data/db (same volume as the previous installations):
#   <MongoDB 4.x data files>    data of the previous installation, never modified: kept as a backup
#   mongodb/                    MongoDB 8 data (dbpath), usable once mongodb/.pwndoc-ready exists
#   .pwndoc-migration/          dump and logs of the migration
#
# Migration: the 4.x data is exported by MongoDB 4.4 (mongodump) and imported in MongoDB 8 (mongorestore),
# then the number of documents of every collection is compared. No intermediate version is needed
# (an in-place upgrade needs 4.4 -> 5.0 -> 6.0 -> 7.0 -> 8.0, each one requiring AVX).
# If the migration fails, MongoDB 4.4 keeps serving the previous data and the migration is retried at the next start.
#
# CPU: MongoDB >= 5.0 needs AVX (x86_64) or ARMv8.2-A (arm64). Without them, a MongoDB 8 build without AVX is used
# when the image contains one (/opt/mongodb-noavx/bin/mongod), otherwise MongoDB 4.4 keeps serving the 4.x data.
#
# Data folder: /data/db is the folder mongodb/mongo-data of the host. Installations made before kept their data in a
# Docker volume, mounted at /data/previous-volume: copied once into the empty data folder, the volume is left unchanged.
set -uo pipefail

PREVIOUS_VOLUME=/data/previous-volume
VOLUME=/data/db
DBPATH=$VOLUME/mongodb
READY=$DBPATH/.pwndoc-ready
WORK=$VOLUME/.pwndoc-migration
OFFICIAL_MONGOD=/usr/bin/mongod
NOAVX_MONGOD=/opt/mongodb-noavx/bin/mongod
LEGACY_MONGOD=/opt/mongodb-legacy/bin/mongod
LEGACY_PORT=27018
NEW_PORT=27019

log() { echo "[pwndoc-mongodb] $*"; }

# mongosh keeps its history and settings in $HOME (/data/db for the mongodb user): not in the data volume
mongosh() { HOME=/tmp command mongosh "$@"; }

# First argument: the default command of the image ("mongod"), the other ones are passed to mongod
if [ "${1:-}" = "mongod" ]; then shift; fi

legacy_mongod() { gosu mongodb env LD_LIBRARY_PATH=/opt/mongodb-legacy/lib "$LEGACY_MONGOD" "$@"; }

has_legacy_data() { [ -f "$VOLUME/WiredTiger" ] || [ -f "$VOLUME/storage.bson" ]; }

# CPU able to run the official MongoDB 8 binaries (PWNDOC_MONGODB_CPU=legacy forces the fallback, for tests)
cpu_supports_official() {
    [ "${PWNDOC_MONGODB_CPU:-auto}" != "legacy" ] || return 1
    case "$(uname -m)" in
        x86_64) grep -qw avx /proc/cpuinfo ;;
        aarch64) grep -qw atomics /proc/cpuinfo ;;  # ARMv8.1 atomics, absent from ARMv8.0 CPUs (Raspberry Pi 4)
        *) return 0 ;;
    esac
}

# MongoDB 8 binary usable on this CPU (empty if none)
select_mongod8() {
    if cpu_supports_official && "$OFFICIAL_MONGOD" --version >/dev/null 2>&1; then
        echo "$OFFICIAL_MONGOD"
    elif [ "${PWNDOC_MONGODB_CPU:-auto}" != "legacy" ] && [ -x "$NOAVX_MONGOD" ] && "$NOAVX_MONGOD" --version >/dev/null 2>&1; then
        echo "$NOAVX_MONGOD"
    fi
}

wait_for() { # port, timeout in seconds
    for _ in $(seq 1 "$2"); do
        mongosh --quiet --host 127.0.0.1 --port "$1" --eval 'db.adminCommand({ping: 1}).ok' >/dev/null 2>&1 && return 0
        sleep 1
    done
    return 1
}

stop_mongod() { # port
    mongosh --quiet --host 127.0.0.1 --port "$1" admin --eval 'db.shutdownServer({timeoutSecs: 30})' >/dev/null 2>&1
    for _ in $(seq 1 60); do
        mongosh --quiet --host 127.0.0.1 --port "$1" --eval '1' >/dev/null 2>&1 || return 0
        sleep 1
    done
    return 1
}

# Number of documents of every collection of the application databases, as sorted "db.collection count" lines
count_documents() { # port
    mongosh --quiet --host 127.0.0.1 --port "$1" --eval '
        const lines = []
        db.adminCommand({listDatabases: 1}).databases.map(d => d.name)
            .filter(name => !["admin", "config", "local"].includes(name))
            .forEach(name => {
                const database = db.getSiblingDB(name)
                database.getCollectionNames().filter(c => !c.startsWith("system.")).forEach(c => {
                    lines.push(name + "." + c + " " + database.getCollection(c).countDocuments({}))
                })
            })
        print(lines.sort().join("\n"))'
}

migrate() { # mongod8 binary
    local mongod8=$1
    rm -rf "$DBPATH" "$WORK"
    mkdir -p "$DBPATH" "$WORK"
    chown mongodb:mongodb "$DBPATH" "$WORK"

    local used available
    used=$(du -sk --exclude=mongodb --exclude=.pwndoc-migration "$VOLUME" | cut -f1)
    available=$(df -Pk "$VOLUME" | awk 'NR == 2 { print $4 }')
    if [ "$available" -lt $((used + 102400)) ]; then
        log "Not enough disk space for the migration: ${used} KB of data, ${available} KB available"
        return 1
    fi

    log "Starting MongoDB 4.4 on the previous data"
    legacy_mongod --dbpath "$VOLUME" --port "$LEGACY_PORT" --bind_ip 127.0.0.1 --fork --logpath "$WORK/mongodb-legacy.log" >/dev/null || return 1
    if ! wait_for "$LEGACY_PORT" 120; then log "MongoDB 4.4 did not start"; return 1; fi
    log "Previous data: $(mongosh --quiet --host 127.0.0.1 --port "$LEGACY_PORT" --eval 'db.adminCommand({getParameter: 1, featureCompatibilityVersion: 1}).featureCompatibilityVersion.version' 2>/dev/null) (feature compatibility version)"

    count_documents "$LEGACY_PORT" > "$WORK/counts-legacy.txt" || return 1
    log "Exporting $(wc -l < "$WORK/counts-legacy.txt") collections"
    mongodump --quiet --host 127.0.0.1 --port "$LEGACY_PORT" --archive="$WORK/dump.archive.gz" --gzip || return 1
    stop_mongod "$LEGACY_PORT" || { log "MongoDB 4.4 did not stop"; return 1; }

    log "Importing the data in MongoDB 8"
    gosu mongodb "$mongod8" --dbpath "$DBPATH" --port "$NEW_PORT" --bind_ip 127.0.0.1 --fork --logpath "$WORK/mongodb-8.log" >/dev/null || return 1
    if ! wait_for "$NEW_PORT" 120; then log "MongoDB 8 did not start"; return 1; fi
    mongorestore --quiet --host 127.0.0.1 --port "$NEW_PORT" --archive="$WORK/dump.archive.gz" --gzip \
        --nsExclude 'admin.*' --nsExclude 'config.*' --nsExclude 'local.*' || return 1

    count_documents "$NEW_PORT" > "$WORK/counts-mongodb-8.txt" || return 1
    if ! cmp -s "$WORK/counts-legacy.txt" "$WORK/counts-mongodb-8.txt"; then
        log "Imported data differs from the previous data:"
        diff "$WORK/counts-legacy.txt" "$WORK/counts-mongodb-8.txt"
        return 1
    fi
    stop_mongod "$NEW_PORT" || { log "MongoDB 8 did not stop"; return 1; }

    echo "Migrated from MongoDB 4.x on $(date -u +%Y-%m-%dT%H:%M:%SZ), $(wc -l < "$WORK/counts-legacy.txt") collections" > "$READY"
    chown mongodb:mongodb "$READY"
    log "Migration completed: the previous data files are kept in $VOLUME (they can be deleted once the migration is checked)"
}

# Stops the MongoDB servers started by a failed migration
cleanup_failed_migration() {
    stop_mongod "$LEGACY_PORT" >/dev/null 2>&1
    stop_mongod "$NEW_PORT" >/dev/null 2>&1
    rm -rf "$DBPATH"
}

serve_legacy() { # reason, args
    log "$1: MongoDB 4.4 keeps serving the previous data (the migration to MongoDB 8 will be retried at the next start)"
    shift
    exec gosu mongodb env LD_LIBRARY_PATH=/opt/mongodb-legacy/lib "$LEGACY_MONGOD" --bind_ip_all --dbpath "$VOLUME" "$@"
}

serve_mongod8() { # binary, args
    local mongod8=$1; shift
    if [ "$mongod8" = "$OFFICIAL_MONGOD" ]; then
        exec docker-entrypoint.sh mongod --dbpath "$DBPATH" "$@"
    fi
    exec gosu mongodb "$mongod8" --bind_ip_all --dbpath "$DBPATH" "$@"
}

# Copy of the previous Docker volume, in a folder of the data folder then moved to its root: an interrupted copy
# (no complete marker) is removed and done again at the next start, an interrupted move is finished.
COPY=$VOLUME/.pwndoc-volume-copy
COPY_COMPLETE=$COPY/.pwndoc-copy-complete

finish_volume_copy() {
    find "$COPY" -mindepth 1 -maxdepth 1 ! -name "$(basename "$COPY_COMPLETE")" -exec mv -t "$VOLUME" {} + \
        || { log "Copy of the previous Docker volume: move into the data folder failed"; exit 1; }
    rm -f "$COPY_COMPLETE"
    rmdir "$COPY"
    log "Data of the previous Docker volume copied into the data folder (the volume is unchanged, kept as a backup)"
}

copy_previous_volume() {
    if [ -d "$COPY" ]; then
        if [ -f "$COPY_COMPLETE" ]; then
            finish_volume_copy
            return
        fi
        log "Interrupted copy of the previous Docker volume: done again"
        rm -rf "$COPY"
    fi
    [ -d "$PREVIOUS_VOLUME" ] && [ -n "$(ls -A "$PREVIOUS_VOLUME")" ] || return 0
    [ -z "$(ls -A "$VOLUME")" ] || return 0 # Data folder already in use: the volume is ignored
    log "Data folder empty, previous Docker volume with data: copy into the data folder"
    mkdir "$COPY"
    if ! cp -a "$PREVIOUS_VOLUME/." "$COPY/"; then
        rm -rf "$COPY"
        log "Copy of the previous Docker volume failed (disk space?): nothing started, retried at the next start"
        exit 1
    fi
    touch "$COPY_COMPLETE"
    finish_volume_copy
}

copy_previous_volume
# Folder of the host created by Docker (root): MongoDB 4.4 uses it as dbpath, the migration writes in it
chown mongodb:mongodb "$VOLUME"

MONGOD8=$(select_mongod8)

if [ -f "$READY" ]; then
    [ -n "$MONGOD8" ] || { log "This CPU cannot run MongoDB 8 (AVX or ARMv8.2-A required) and the data has already been migrated to MongoDB 8"; exit 1; }
    serve_mongod8 "$MONGOD8" "$@"
fi

if has_legacy_data; then
    [ -n "$MONGOD8" ] || serve_legacy "This CPU cannot run MongoDB 8 (AVX or ARMv8.2-A required)" "$@"
    log "MongoDB 4.x data found: migration to MongoDB 8"
    if ! migrate "$MONGOD8"; then
        cleanup_failed_migration
        serve_legacy "Migration failed (logs: $WORK)" "$@"
    fi
    serve_mongod8 "$MONGOD8" "$@"
fi

# New installation
if [ -z "$MONGOD8" ]; then
    log "This CPU cannot run MongoDB 8 (AVX or ARMv8.2-A required): MongoDB 4.4 is used"
    exec gosu mongodb env LD_LIBRARY_PATH=/opt/mongodb-legacy/lib "$LEGACY_MONGOD" --bind_ip_all --dbpath "$VOLUME" "$@"
fi
mkdir -p "$DBPATH"
echo "New installation on $(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$READY"
chown -R mongodb:mongodb "$DBPATH"
serve_mongod8 "$MONGOD8" "$@"
