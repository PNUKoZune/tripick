#!/usr/bin/env bash

set -euo pipefail

TASK_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK_MOBILE_DIR="$(cd "$TASK_SCRIPT_DIR/.." && pwd)"

export TRIPICK_UPLOAD_STORE_PASSWORD="${TRIPICK_UPLOAD_STORE_PASSWORD:-$(security find-generic-password -a tripick-upload -s com.tripick.place.upload-keystore -w)}"
export TRIPICK_UPLOAD_KEY_PASSWORD="${TRIPICK_UPLOAD_KEY_PASSWORD:-$TRIPICK_UPLOAD_STORE_PASSWORD}"

cd "$TASK_MOBILE_DIR/android"
exec ./gradlew :app:bundleRelease "$@"
