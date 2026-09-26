# Self-built MinIO object storage (server + mc client), published to GHCR by CI.
#
# MinIO Inc. archived the open-source MinIO/mc projects: dl.min.io answers
# "410 Gone" for every community release and quay.io / Docker Hub refuse
# anonymous pulls of minio/minio and minio/mc. This image is compiled from the
# upstream release tags (still public on GitHub) so every deploy host and CI
# run pulls one image this repository controls.
#
# Pinned to the releases the production server already runs (its CPU has no
# AVX; see .env.example). GOAMD64=v1 keeps the binaries on the baseline x86-64
# instruction set, and the runtime keeps the official image's contract:
# data in /data, runs as root (existing volumes stay readable), `server /data`
# or `minio server /data` both work, and `mc` + `curl` are available for
# health checks and bucket setup.
ARG GO_VERSION=1.19.13

FROM golang:${GO_VERSION}-alpine AS build
RUN apk add --no-cache git
ARG MINIO_RELEASE=RELEASE.2022-10-24T18-35-07Z
ARG MC_RELEASE=RELEASE.2022-10-20T23-26-33Z
ENV CGO_ENABLED=0 GOAMD64=v1 GOFLAGS=-mod=mod
WORKDIR /src
RUN git clone --depth 1 --branch "${MINIO_RELEASE}" https://github.com/minio/minio.git minio \
 && cd minio \
 && go build -tags kqueue -trimpath -ldflags "$(go run buildscripts/gen-ldflags.go)" -o /out/minio . \
 && /out/minio --version
RUN git clone --depth 1 --branch "${MC_RELEASE}" https://github.com/minio/mc.git mc \
 && cd mc \
 && go build -tags kqueue -trimpath -ldflags "$(go run buildscripts/gen-ldflags.go)" -o /out/mc . \
 && /out/mc --version

FROM alpine:3.20
ARG MINIO_RELEASE=RELEASE.2022-10-24T18-35-07Z
ARG SOURCE_REPO=https://github.com/hisham7961/InfluenceOS
LABEL org.opencontainers.image.title="influenceos-minio" \
      org.opencontainers.image.version="${MINIO_RELEASE}" \
      org.opencontainers.image.source="${SOURCE_REPO}" \
      org.opencontainers.image.licenses="AGPL-3.0"
RUN apk add --no-cache ca-certificates curl
COPY --from=build /out/minio /out/mc /usr/bin/
COPY docker-entrypoint.sh /usr/bin/docker-entrypoint.sh
RUN chmod +x /usr/bin/docker-entrypoint.sh && mkdir -p /data
EXPOSE 9000 9001
VOLUME ["/data"]
ENTRYPOINT ["/usr/bin/docker-entrypoint.sh"]
CMD ["server", "/data"]
