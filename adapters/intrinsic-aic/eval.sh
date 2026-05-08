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
EVAL_VISUAL="${PSF_AIC_EVAL_VISUAL:-false}"
GAZEBO_GUI="false"
LAUNCH_RVIZ="false"
XHOST_GRANTED=0
if [[ "$EVAL_VISUAL" == "true" ]]; then
  GAZEBO_GUI="${PSF_AIC_GUI:-true}"
  LAUNCH_RVIZ="${PSF_AIC_RVIZ:-true}"
  if command -v xhost >/dev/null 2>&1; then
    xhost +local:docker >/dev/null 2>&1 && XHOST_GRANTED=1 || true
  fi
fi
echo "                     eval_visual   = $EVAL_VISUAL"
echo "                     gazebo_gui    = $GAZEBO_GUI"
echo "                     launch_rviz   = $LAUNCH_RVIZ"
echo

cleanup() {
  if (( XHOST_GRANTED == 1 )) && command -v xhost >/dev/null 2>&1; then
    xhost -local:docker >/dev/null 2>&1 || true
  fi
  docker compose -f "$COMPOSE_FILE" down >/dev/null 2>&1 || true
  if [[ -n "${OVERRIDE_FILE:-}" ]]; then
    rm -f "$OVERRIDE_FILE" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

cd "$PSF_AIC_WS"

# Always reset containers before Eval. If a previous run leaves aic_model in
# lifecycle state "finalized", compose can reuse that stale container and the
# engine immediately fails model validation.
docker compose -f "$COMPOSE_FILE" down --remove-orphans >/dev/null 2>&1 || true

OVERRIDE_FILE="$(mktemp /tmp/workbench-aic-eval-override.XXXXXX.yaml)"
cat > "$OVERRIDE_FILE" <<EOF
services:
  eval:
    command: >
      gazebo_gui:=$GAZEBO_GUI
      launch_rviz:=$LAUNCH_RVIZ
      ground_truth:=false
      start_aic_engine:=true
      shutdown_on_aic_engine_exit:=true
      model_discovery_timeout_seconds:=600
EOF

if [[ "$EVAL_VISUAL" == "true" ]]; then
  cat >> "$OVERRIDE_FILE" <<EOF
    environment:
      DISPLAY: "${DISPLAY:-:0}"
      QT_X11_NO_MITSHM: "1"
      NVIDIA_VISIBLE_DEVICES: "all"
      NVIDIA_DRIVER_CAPABILITIES: "graphics,utility,compute,display"
      __NV_PRIME_RENDER_OFFLOAD: "1"
      __GLX_VENDOR_LIBRARY_NAME: "nvidia"
      __VK_LAYER_NV_optimus: "NVIDIA_only"
      MESA_LOADER_DRIVER_OVERRIDE: "nvidia"
      LIBGL_ALWAYS_SOFTWARE: "0"
      QT_OPENGL: "desktop"
    volumes:
      - /tmp/.X11-unix:/tmp/.X11-unix:rw
EOF
fi

exec docker compose -f "$COMPOSE_FILE" -f "$OVERRIDE_FILE" up --force-recreate --abort-on-container-exit
