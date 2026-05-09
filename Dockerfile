# syntax=docker/dockerfile:1.7

# ---------- Builder ----------
# Compiles a static, stripped binary. CGO off so the result runs on a
# scratch-style base. BuildKit cache mounts keep go.mod downloads and
# go-build artifacts across rebuilds.
FROM golang:1.26.3-alpine AS builder

WORKDIR /src

# Pull deps in a layer of their own so source edits don't bust the
# module cache.
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

COPY . .

ARG TARGETOS=linux
ARG TARGETARCH=amd64

RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build \
        -trimpath \
        -ldflags="-s -w" \
        -o /out/champRoulette \
        ./cmd/champRoulette

# ---------- Runtime ----------
# distroless/static includes CA certs (needed for the Data Dragon TLS
# call at startup), /etc/passwd with the nonroot user (UID/GID 65532),
# and nothing else — no shell, no package manager.
FROM gcr.io/distroless/static-debian12:nonroot AS runtime

LABEL org.opencontainers.image.source="https://github.com/Odery/ChampRoulette"
LABEL org.opencontainers.image.description="Random League of Legends tournament drafter"
LABEL org.opencontainers.image.licenses="MIT"

WORKDIR /app

COPY --from=builder --chown=65532:65532 /out/champRoulette /app/champRoulette
COPY --chown=65532:65532 static /app/static

ENV PORT=8080 \
    STATIC_DIR=/app/static \
    LOG_LEVEL=INFO

USER 65532:65532
EXPOSE 8080

ENTRYPOINT ["/app/champRoulette"]