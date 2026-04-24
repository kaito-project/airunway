KUSTOMIZE ?= ../../controller/bin/kustomize
IMG ?= ghcr.io/kaito-project/airunway/dynamo-provider:latest
PLATFORM ?= linux/amd64
PUSH ?= false
PUSH_ENABLED := $(filter true TRUE 1 yes YES on ON,$(PUSH))
IMAGE_OUTPUT_FLAG := $(if $(PUSH_ENABLED),--push,--load)

.PHONY: build docker-build deploy generate-deploy-manifests setup-dynamo cleanup-dynamo test-e2e

## Build the provider binary
build:
	go build -o bin/provider ./cmd/main.go
	@echo "✅ Dynamo provider built"

## Build provider Docker image
docker-build:
	docker buildx build --platform $(PLATFORM) $(IMAGE_OUTPUT_FLAG) -f Dockerfile -t $(IMG) ../..
	@echo "✅ Dynamo provider image built: $(IMG) ($(PLATFORM), $(if $(PUSH_ENABLED),pushed,loaded locally))"

## Deploy provider to the K8s cluster
deploy:
	cd config/manager && ../../$(KUSTOMIZE) edit set image IMAGE_PLACEHOLDER=$(IMG)
	$(KUSTOMIZE) build config/default | kubectl apply -f -
	@git checkout config/manager/kustomization.yaml 2>/dev/null || true
	@echo "✅ Dynamo provider deployed"

## Generate deploy manifest
generate-deploy-manifests:
	@mkdir -p deploy
	cd config/manager && ../../$(KUSTOMIZE) edit set image IMAGE_PLACEHOLDER=$(IMG)
	$(KUSTOMIZE) build config/default > deploy/dynamo.yaml
	@git checkout config/manager/kustomization.yaml 2>/dev/null || true
	@echo "✅ Generated deploy/dynamo.yaml"

## Install Dynamo platform on the cluster (run before test-e2e)
DYNAMO_NAMESPACE ?= dynamo-system
DYNAMO_VERSION ?= 1.0.2
DYNAMO_CHART_URL := https://helm.ngc.nvidia.com/nvidia/ai-dynamo/charts/dynamo-platform-$(DYNAMO_VERSION).tgz
DYNAMO_PRE_DEPLOY_URL := https://raw.githubusercontent.com/ai-dynamo/dynamo/main/deploy/pre-deployment/pre-deployment-check.sh

setup-dynamo:
	@echo "Running Dynamo pre-deployment checks..."
	@TMPSCRIPT=$$(mktemp --suffix=.sh) && \
		curl -fsSL "$(DYNAMO_PRE_DEPLOY_URL)" -o "$$TMPSCRIPT" && \
		chmod +x "$$TMPSCRIPT" && \
		bash "$$TMPSCRIPT" && \
		rm -f "$$TMPSCRIPT"
	@echo "Installing Dynamo platform v$(DYNAMO_VERSION)..."
	@CHART_TGZ="dynamo-platform-$(DYNAMO_VERSION).tgz" && \
		helm fetch "$(DYNAMO_CHART_URL)" && \
		helm upgrade -i dynamo-platform "$$CHART_TGZ" \
			--namespace $(DYNAMO_NAMESPACE) \
			--create-namespace \
			--set "dynamo-operator.controllerManager.manager.image.tag=$(DYNAMO_VERSION)" && \
		rm -f "$$CHART_TGZ"
	@echo "✅ Dynamo platform v$(DYNAMO_VERSION) installed in namespace $(DYNAMO_NAMESPACE)"

## Uninstall Dynamo platform from the cluster
cleanup-dynamo:
	helm uninstall dynamo-platform --namespace $(DYNAMO_NAMESPACE)
	@echo "✅ Dynamo platform uninstalled from namespace $(DYNAMO_NAMESPACE)"

## Run e2e tests (requires DYNAMO_INSTALLED=true and a cluster with dynamo provider deployed)
test-e2e:
	DYNAMO_INSTALLED=true go test -tags=e2e -v -timeout 45m ./test/e2e/
