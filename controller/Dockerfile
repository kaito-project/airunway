# Build the manager binary
FROM --platform=$BUILDPLATFORM golang:1.25 AS builder
ARG TARGETOS
ARG TARGETARCH
# GAIE_VERSION is the upstream Gateway API Inference Extension version pinned in
# /versions.env. When provided (e.g. via `make controller-docker-build`), it is
# injected into the controller binary via -ldflags so the in-image default tracks
# versions.env. When unset (hand-run `docker build`), the Go source fallback wins.
ARG GAIE_VERSION

WORKDIR /workspace

# Copy the Go Modules manifests
COPY controller/go.mod controller/go.sum controller/
# cache deps before building and copying source so that we don't need to re-download as much
# and so that source changes don't invalidate our downloaded layer
RUN cd controller && go mod download

# Copy the controller Go source
COPY controller/ controller/

# Build
# the GOARCH has no default value to allow the binary to be built according to the host where the command
# was called. For example, if we call make docker-build in a local env which has the Apple Silicon M1 SO
# the docker BUILDPLATFORM arg will be linux/arm64 when for Apple x86 it will be linux/amd64. Therefore,
# by leaving it empty we can ensure that the container and binary shipped on it will have the same platform.
RUN cd controller && CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH} \
    go build -a \
      -ldflags="${GAIE_VERSION:+-X github.com/kaito-project/airunway/controller/internal/gateway.DefaultGAIEVersion=${GAIE_VERSION}}" \
      -o manager cmd/main.go

# Use distroless as minimal base image to package the manager binary
# Refer to https://github.com/GoogleContainerTools/distroless for more details
FROM gcr.io/distroless/static:nonroot
WORKDIR /
COPY --from=builder /workspace/controller/manager .
USER 65532:65532

ENTRYPOINT ["/manager"]
