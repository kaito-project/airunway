#!/usr/bin/env bash
set -euo pipefail

cluster_name="${1:?usage: preload-kaito-images.sh <kind-cluster-name>}"
repo_root="${GITHUB_WORKSPACE:-}"
if [[ -z "${repo_root}" ]]; then
  repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
fi

# shellcheck source=/dev/null
source "${repo_root}/versions.env"

images=(
  "mcr.microsoft.com/aks/kaito/workspace:${KAITO_VERSION}"
  "mcr.microsoft.com/acstor/local-csi-driver:v0.2.9"
  "mcr.microsoft.com/acstor/local-csi-manager:v0.2.9"
  "mcr.microsoft.com/oss/v2/kubernetes-csi/csi-provisioner:v5.2.0"
  "mcr.microsoft.com/oss/v2/kubernetes-csi/csi-resizer:v1.13.2"
  "mcr.microsoft.com/oss/v2/kubernetes-csi/csi-node-driver-registrar:v2.13.0"
)

for image in "${images[@]}"; do
  echo "Preloading ${image} into kind cluster ${cluster_name}"
  for attempt in 1 2 3; do
    if docker image inspect "${image}" >/dev/null 2>&1 || docker pull "${image}"; then
      break
    fi
    if [[ "${attempt}" == "3" ]]; then
      echo "Failed to pull ${image} after ${attempt} attempts" >&2
      exit 1
    fi
    sleep_seconds=$((attempt * 15))
    echo "Retrying ${image} in ${sleep_seconds}s"
    sleep "${sleep_seconds}"
  done
  kind load docker-image "${image}" --name "${cluster_name}"
done
