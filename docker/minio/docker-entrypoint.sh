#!/bin/sh
# Same calling convention as the official MinIO image: `server /data` and
# `minio server /data` both start the server; any other binary or shell
# command (mc, sh, /bin/…) runs as given.
set -e
case "$1" in
  minio | mc | sh | /*) ;;
  *) set -- minio "$@" ;;
esac
exec "$@"
