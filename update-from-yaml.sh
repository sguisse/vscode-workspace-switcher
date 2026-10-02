#!/bin/bash
set -euo pipefail

# Thin, hand-maintained trigger for the YAML-manifest generation pipeline.
# All generated file content lives in update.yaml (validated before any disk write by
# dev-tools/apply-yaml-on-codebase.js), never inline bash heredocs — see predefined-prompts.yaml
# entry 'prompt-4-external-use-yaml-manifest-replace' for the authoring rules.

MANIFEST_FILE="update.yaml"

if [ ! -f "$MANIFEST_FILE" ]; then
    echo "❌ Manifest not found: $MANIFEST_FILE"
    echo "ℹ️ Create $MANIFEST_FILE with a 'generation.files' list (see dev-tools/apply-yaml-on-codebase.js), then re-run this script."
    exit 1
fi

echo "🚀 Applying yaml generated manifest: $MANIFEST_FILE"
node dev-tools/apply-yaml-on-codebase.js "$MANIFEST_FILE" "$@"

cd modules/ai-architecture-auditor || exit 1

WAIT_FLAG=false
for arg in "$@"; do
    case "$arg" in
        *wait*)
            WAIT_FLAG=true
            break
            ;;
    esac
done

if [ "$WAIT_FLAG" = true ]; then
    echo "⏸️ Pause requested via --wait. Press Enter to run Maven build..."
    read -r _ < /dev/tty 2>/dev/null || read -r _ || true
fi

echo "🚀 Running Maven build to ensure generated files are compiled"
pwd
mvn clean install
