# PostGIS + WAL-G, for continuous WAL archiving and point-in-time recovery.
#
# Same base image as docker-compose.prod.yml (Alpine/musl), so switching to it
# does NOT change the collation library under an existing data directory.
# WAL-G is built from source as a static binary: the published release
# binaries are glibc builds and do not run on Alpine.
#
# Built and used by deploy/production/walg/docker-compose.walg.yml.
# See docs/operations/backup-and-restore.md.

ARG WALG_VERSION=v3.0.3

FROM golang:1.23-alpine AS walg
ARG WALG_VERSION
RUN apk add --no-cache git
RUN git clone --depth 1 --branch "${WALG_VERSION}" https://github.com/wal-g/wal-g.git /src
WORKDIR /src
# Pure-Go build: lz4/zstd compression and OpenPGP encryption need no cgo.
# (brotli and libsodium would; they are not used here.)
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o /usr/local/bin/wal-g ./main/pg \
 && /usr/local/bin/wal-g --version

FROM postgis/postgis:16-3.4-alpine
COPY --from=walg /usr/local/bin/wal-g /usr/local/bin/wal-g
