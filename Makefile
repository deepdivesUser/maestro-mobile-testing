# --- Configuration ---
APP_ID ?= com.example.app
ENV ?= staging
MAESTRO_BIN ?= maestro
FLOW_DIR ?= .maestro/flows

.PHONY: test-all test-smoke test-regression test-e2e test-auth \
        list-devices discover launch test \
        ai-generate ai-interactive ai-list \
        clean ensure-dirs

# --- Device discovery ---

list-devices discover:
	@./scripts/discover-devices.sh

launch:
	@./scripts/launch-device.sh

launch-ios:
	@./scripts/launch-device.sh ios

launch-android:
	@./scripts/launch-device.sh android

# --- Test targets (auto-discover + run) ---

test test-smoke:
	@./scripts/maestro-test.sh smoke --env=$(ENV) --device=$(or $(DEVICE),)

test-auth:
	@./scripts/maestro-test.sh auth --env=$(ENV) --device=$(or $(DEVICE),)

test-regression:
	@./scripts/maestro-test.sh regression --env=$(ENV) --device=$(or $(DEVICE),)

test-e2e:
	@./scripts/maestro-test.sh e2e --env=$(ENV) --device=$(or $(DEVICE),)

test-all:
	@./scripts/maestro-test.sh all --env=$(ENV) --device=$(or $(DEVICE),)

# --- Direct maestro (skip discovery, for CI or known device) ---

maestro-smoke:
	$(MAESTRO_BIN) test --env APP_ID=$(APP_ID) $(FLOW_DIR)/smoke/

maestro-all:
	$(MAESTRO_BIN) test --env APP_ID=$(APP_ID) $(FLOW_DIR)/

# --- Utilities ---

ensure-dirs:
	@mkdir -p test-results screenshots

list-flows:
	@find $(FLOW_DIR) -name '*.yaml' -o -name '*.yml' | sort

clean:
	rm -rf test-results screenshots

# --- AI-powered test generation ---

# Generate a flow from natural language
# Usage:
#   make ai-generate TEST="test that search returns results"
#   make ai-generate TEST="verify login works" CATEGORY=auth
#   make ai-generate TEST="app launches" DRY=1
#   make ai-generate EDIT=auth/login-success.yaml TEST="add screenshot after login"
TEST ?=
CATEGORY ?=
OUTPUT ?=
EDIT ?=
DRY ?=

ai-generate:
	@node scripts/ai-generate.mjs "$(TEST)" \
	  $(if $(CATEGORY),--category $(CATEGORY)) \
	  $(if $(OUTPUT),--output $(OUTPUT)) \
	  $(if $(EDIT),--edit $(EDIT)) \
	  $(if $(filter 1 true yes,$(DRY)),--dry-run)

# Interactive AI flow generation REPL
ai-interactive:
	@node scripts/ai-interactive.mjs

# List existing flows (for reference)
ai-list:
	@node scripts/ai-generate.mjs --list