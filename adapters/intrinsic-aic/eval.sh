#!/usr/bin/env bash
# intrinsic-aic adapter — Eval mode launcher.
#
# Runs the official AIC evaluator stack (ground_truth:=false) via the
# upstream docker-compose file. This is the qualification-truth path.

set -euo pipefail

: "${PSF_AIC_WS:?PSF_AIC_WS not set — adapter invoked outside of Workbench?}"

if ! command -v docker >/dev/null 2>&1; then
  echo "[intrinsic-aic/eval] docker not found on host" >&2
  exit 1
fi

COMPOSE_FILE="$PSF_AIC_WS/docker/docker-compose.yaml"
if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "[intrinsic-aic/eval] missing compose file: $COMPOSE_FILE" >&2
  exit 1
fi

echo "[intrinsic-aic/eval] Launching official evaluator"
echo "                     workspace     = $PSF_AIC_WS"
echo "                     compose file  = $COMPOSE_FILE"
echo

cleanup() {
  docker compose -f "$COMPOSE_FILE" down >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

cd "$PSF_AIC_WS"
exec docker compose -f "$COMPOSE_FILE" up --abort-on-container-exit

