#!/bin/sh
set -eu

install -d -o postgres -g postgres "$PGDATA" /data/assets

if [ ! -s "$PGDATA/PG_VERSION" ]; then
    gosu postgres initdb -D "$PGDATA" --auth-local=trust --auth-host=trust
fi

gosu postgres postgres -D "$PGDATA" -c listen_addresses=127.0.0.1 &
postgres_pid=$!
app_pid=""

stop_children() {
    if [ -n "$app_pid" ]; then
        kill -TERM "$app_pid" 2>/dev/null || true
    fi
    kill -TERM "$postgres_pid" 2>/dev/null || true
}
trap stop_children TERM INT

until gosu postgres pg_isready -h 127.0.0.1 -p 5432 -U postgres >/dev/null 2>&1; do
    if ! kill -0 "$postgres_pid" 2>/dev/null; then
        wait "$postgres_pid"
        exit $?
    fi
    sleep 1
done

if ! gosu postgres psql -h 127.0.0.1 -U postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname = 'roomcraft'" | grep -q 1; then
    gosu postgres createuser -h 127.0.0.1 -U postgres roomcraft
fi

if ! gosu postgres psql -h 127.0.0.1 -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname = 'roomcraft'" | grep -q 1; then
    gosu postgres createdb -h 127.0.0.1 -U postgres -O roomcraft roomcraft
fi

gosu postgres /app/RoomCraft.Host &
app_pid=$!

if wait "$app_pid"; then
    status=0
else
    status=$?
fi

kill -TERM "$postgres_pid" 2>/dev/null || true
wait "$postgres_pid" 2>/dev/null || true
exit "$status"
