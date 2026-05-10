#!/usr/bin/env bash
# intrinsic-aic adapter — Play mode launcher.
#
# Owned by Workbench's intrinsic-aic adapter pack. Invoked indirectly
# via `workbench run --mode play` from a project directory.
#
# Play mode brings up the AIC sim AND the user's policy so the iteration
# loop is "edit policy.py → click Play → watch in Gazebo". Two containers
# share localhost via `--net host`:
#   - eval container  : sim + controllers + aic_engine (dispatches the task)
#   - model container : aic_model loading the project's policy class
#
# Implementation note:
#   The AIC eval Docker image (ghcr.io/intrinsic-dev/aic/aic_eval) ships
#   with aic_bringup and friends already built and installed. Trying to
#   run the launch file from the host pixi workspace fails because
#   aic_bringup is not in the pixi env (only aic_model, aic_interfaces,
#   and aic_example_policies are). So Play mode runs the launch file
#   *inside* the eval container.
#
# Inputs (env vars, supplied by Workbench's CLI from workbench.project.yaml):
#   PSF_AIC_WS                  Path to the AIC pixi workspace
#                               (used for context; not strictly required for
#                                Play mode since the launch happens in-container)
#   PSF_AIC_GUI                 Show Gazebo window (true/false)
#   PSF_AIC_RVIZ                Show RViz window (true/false)
#   PSF_AIC_GROUND_TRUTH        Expose ground-truth /tf (true/false)
#   PSF_AIC_SPAWN_TASK_BOARD    Spawn task board (true/false)
#   PSF_AIC_SPAWN_CABLE         Spawn cable (true/false)
#   PSF_AIC_ATTACH_CABLE        Attach cable to gripper at start (true/false)
#   PSF_AIC_CABLE_TYPE          Cable model (sfp_sc_cable | sfp_sc_cable_reversed)
#   PSF_AIC_EVAL_IMAGE          Override eval image (default: ghcr.io/intrinsic-dev/aic/aic_eval:latest)
#   PSF_AIC_MODEL_IMAGE         Submission image holding the policy class
#                               (default: my-solution:v2 — the locally-built image
#                                that derives from aic_model and installs the
#                                project's reflex_policy package)
#   PSF_AIC_START_ENGINE        Engine on/off in Play mode (default: true).
#                               Set to false for the legacy "sim only, no task
#                               dispatch" behavior.

set -euo pipefail

: "${PSF_AIC_WS:?PSF_AIC_WS not set — adapter invoked outside of Workbench?}"

# Defaults if Workbench didn't set something — keeps adapter self-contained.
GUI="${PSF_AIC_GUI:-true}"
RVIZ="${PSF_AIC_RVIZ:-true}"
GROUND_TRUTH="${PSF_AIC_GROUND_TRUTH:-true}"
SPAWN_TASK_BOARD="${PSF_AIC_SPAWN_TASK_BOARD:-true}"
SPAWN_CABLE="${PSF_AIC_SPAWN_CABLE:-true}"
ATTACH_CABLE="${PSF_AIC_ATTACH_CABLE:-true}"
CABLE_TYPE="${PSF_AIC_CABLE_TYPE:-sfp_sc_cable}"
EVAL_IMAGE="${PSF_AIC_EVAL_IMAGE:-ghcr.io/intrinsic-dev/aic/aic_eval:latest}"
MODEL_IMAGE="${PSF_AIC_MODEL_IMAGE:-my-solution:v2}"
START_ENGINE="${PSF_AIC_START_ENGINE:-true}"

# GPU selection. On hybrid-GPU hosts (e.g. a workstation with one display GPU
# and one headless compute card), `--gpus all` lets Gazebo's renderer land on
# the headless card whose framebuffer never reaches the X display — the
# windows open black. To avoid that, prefer the GPU that's actually driving
# the display. Detection order:
#   1. PSF_AIC_GPU_DEVICE env override (anything `docker run --gpus` accepts).
#   2. The GPU whose UUID matches Xorg's primary device (single-GPU hosts
#      naturally fall through to "device=GPU-...").
#   3. "all" — single-GPU hosts work fine; this is also the safe default for
#      machines where detection fails.
detect_display_gpu() {
  command -v nvidia-smi >/dev/null 2>&1 || return 1
  command -v xrandr     >/dev/null 2>&1 || return 1
  # Card actively driving the X display, by PCI bus id.
  local bus
  bus="$(nvidia-smi --query-gpu=pci.bus_id,display_active --format=csv,noheader 2>/dev/null \
        | awk -F', *' '$2 == "Enabled" { print tolower($1); exit }')"
  [[ -n "$bus" ]] || return 1
  # Strip the leading "00000000:" docker doesn't want, then look up the UUID.
  local short="${bus#00000000:}"
  nvidia-smi --query-gpu=pci.bus_id,uuid --format=csv,noheader 2>/dev/null \
    | awk -F', *' -v b="$short" '
        { gsub(/^00000000:/, "", $1); if (tolower($1) == b) { print $2; exit } }
      '
}
if [[ -n "${PSF_AIC_GPU_DEVICE:-}" ]]; then
  GPU_DEVICE="$PSF_AIC_GPU_DEVICE"
else
  _display_uuid="$(detect_display_gpu || true)"
  if [[ -n "$_display_uuid" ]]; then
    GPU_DEVICE="device=$_display_uuid"
  else
    GPU_DEVICE="all"
  fi
fi

# ── pre-flight ─────────────────────────────────────────────────────────

if ! command -v docker >/dev/null 2>&1; then
  echo "[intrinsic-aic/play] docker not found on host" >&2
  exit 1
fi

if ! docker image inspect "$EVAL_IMAGE" >/dev/null 2>&1; then
  echo "[intrinsic-aic/play] eval image not pulled locally: $EVAL_IMAGE" >&2
  echo "[intrinsic-aic/play] run: docker pull $EVAL_IMAGE" >&2
  exit 1
fi

if ! docker image inspect "$MODEL_IMAGE" >/dev/null 2>&1; then
  echo "[intrinsic-aic/play] model image not built locally: $MODEL_IMAGE" >&2
  echo "[intrinsic-aic/play] build it from your project, e.g.:" >&2
  echo "[intrinsic-aic/play]   cd <your project>; docker build -f docker/Dockerfile -t $MODEL_IMAGE ." >&2
  echo "[intrinsic-aic/play] or override with PSF_AIC_MODEL_IMAGE=<your image>." >&2
  exit 1
fi

# X11 forwarding so Gazebo / RViz windows open on the user's desktop.
# We grant access at start, revoke at exit. xhost is safe to call
# multiple times.
XHOST_GRANTED=0
if [[ "$GUI" == "true" || "$RVIZ" == "true" ]]; then
  if command -v xhost >/dev/null 2>&1; then
    xhost +local:docker >/dev/null 2>&1 && XHOST_GRANTED=1 || true
  fi
fi

cleanup() {
  if (( XHOST_GRANTED == 1 )) && command -v xhost >/dev/null 2>&1; then
    xhost -local:docker >/dev/null 2>&1 || true
  fi
  # If either container we started is still around, stop it cleanly.
  for n in "${MODEL_CONTAINER_NAME:-}" "${CONTAINER_NAME:-}"; do
    [[ -z "$n" ]] && continue
    docker stop -t 5 "$n" >/dev/null 2>&1 || true
    docker rm -f "$n" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT INT TERM

CONTAINER_NAME="workbench-aic-play-$$"
MODEL_CONTAINER_NAME="workbench-aic-model-$$"

# Machine-readable line so the parent process (Workbench main) can capture
# the container name and kill it directly on shutdown. This is the
# belt-and-suspenders that protects against a forceful Electron exit not
# letting our trap finish. Workbench's main.js currently captures the first
# match only; the model container is caught by the orphan sweep on the
# `workbench-aic-` name prefix or by this script's trap.
echo "[workbench-meta] container_name=$CONTAINER_NAME"
echo "[workbench-meta] model_container_name=$MODEL_CONTAINER_NAME"

cat <<EOF
[intrinsic-aic/play] Launching Play mode
                     eval image         = $EVAL_IMAGE
                     model image        = $MODEL_IMAGE
                     gazebo_gui         = $GUI
                     launch_rviz        = $RVIZ
                     ground_truth       = $GROUND_TRUTH
                     spawn_task_board   = $SPAWN_TASK_BOARD
                     spawn_cable        = $SPAWN_CABLE
                     attach_cable       = $ATTACH_CABLE
                     cable_type         = $CABLE_TYPE
                     start_aic_engine   = $START_ENGINE
                     gpu_device         = $GPU_DEVICE
                     eval container     = $CONTAINER_NAME
                     model container    = $MODEL_CONTAINER_NAME

                     ctrl-c to stop
EOF

# ── launch ─────────────────────────────────────────────────────────────

# Build the docker args. We want:
#   --rm                    auto-remove on exit
#   --gpus all              expose NVIDIA devices for Gazebo rendering
#   --net host              easy on a single-host dev setup; matches the
#                           pattern AIC's own docker-compose uses internally
#   --name                  predictable container name so we can stop it
#   -e DISPLAY              X11 forwarding
#   -v /tmp/.X11-unix       X11 socket
#   -v $XAUTHORITY          X11 auth cookie

EVAL_DOCKER_ARGS=(
  run
  --rm
  --gpus "$GPU_DEVICE"
  --net host
  --name "$CONTAINER_NAME"
  -e "DISPLAY=${DISPLAY:-:0}"
  -e "QT_X11_NO_MITSHM=1"
  # Prefer hardware GL in Gazebo / RViz on hybrid-GPU hosts.
  # Without these hints, GLX may resolve to Mesa/llvmpipe even when
  # CUDA/NVIDIA devices are visible in-container.
  -e "NVIDIA_DRIVER_CAPABILITIES=graphics,utility,compute,display"
  -e "__GLX_VENDOR_LIBRARY_NAME=nvidia"
  -e "MESA_LOADER_DRIVER_OVERRIDE=nvidia"
  -e "LIBGL_ALWAYS_SOFTWARE=0"
  -e "QT_OPENGL=desktop"
  -v /tmp/.X11-unix:/tmp/.X11-unix:rw
)

if [[ -n "${XAUTHORITY:-}" && -f "$XAUTHORITY" ]]; then
  EVAL_DOCKER_ARGS+=( -v "$XAUTHORITY:/root/.Xauthority:rw" )
fi

EVAL_DOCKER_ARGS+=( "$EVAL_IMAGE" )

# Args to the eval image's entrypoint. The image's entrypoint already
# does `ros2 launch aic_bringup aic_gz_bringup.launch.py "$@"`, so we
# just pass the launch arguments here.
EVAL_LAUNCH_ARGS=(
  start_aic_engine:=$START_ENGINE
  shutdown_on_aic_engine_exit:=false
  gazebo_gui:=$GUI
  launch_rviz:=$RVIZ
  ground_truth:=$GROUND_TRUTH
  spawn_task_board:=$SPAWN_TASK_BOARD
  spawn_cable:=$SPAWN_CABLE
  attach_cable_to_gripper:=$ATTACH_CABLE
  cable_type:=$CABLE_TYPE
)

# Model container args. With `--net host`, both eval and model talk to the
# Zenoh router on localhost:7447. The model image's entrypoint calls
# `ros2 run aic_model aic_model "$@"`, so the CMD baked into the image
# (e.g. `--ros-args -p policy:=reflex_policy.ReflexPolicy ...`) is what
# selects which policy class loads.
#
# No --gpus here. The policy is pure Python + ros2 messaging; it doesn't
# render or run CUDA. Sharing the GPU with Gazebo causes EGL/DRI2 init
# races on dual-GPU setups (Maxwell + headless compute).
MODEL_DOCKER_ARGS=(
  run
  --rm
  --net host
  --name "$MODEL_CONTAINER_NAME"
  -e "AIC_ROUTER_ADDR=localhost:7447"
  -e "AIC_MODEL_PASSWD=CHANGE_IN_PROD"
  -e "RMW_IMPLEMENTATION=rmw_zenoh_cpp"
  -e "ZENOH_ROUTER_CHECK_ATTEMPTS=-1"
  -e "AIC_VISION_MODEL_ENABLE=${PSF_AIC_VISION_MODEL_ENABLE:-0}"
  -e "AIC_VISION_MODEL_PATH=${PSF_AIC_VISION_MODEL_PATH:-/ws_aic/src/aic_policy/data/models/vision_offset_model.npz}"
  -e "AIC_VISION_CAPTURE_DIR=${PSF_AIC_VISION_CAPTURE_DIR:-/ws_aic/src/aic_policy_capture}"
  "$MODEL_IMAGE"
)

# Eval first, in the background. Give it a head start so its EGL/Gazebo
# init doesn't race with the model container loading ROS/Zenoh. The model
# container's ZENOH_ROUTER_CHECK_ATTEMPTS=-1 will retry the router
# connection until eval is fully up, so the sleep is just a buffer to let
# Gazebo's renderer claim its GPU contexts first.
docker "${EVAL_DOCKER_ARGS[@]}" "${EVAL_LAUNCH_ARGS[@]}" &
EVAL_PID=$!

sleep 8

docker "${MODEL_DOCKER_ARGS[@]}" &
MODEL_PID=$!

# Wait for whichever container exits first, then let the trap clean up the
# other. The exit status of `wait -n` is the status of the first to finish.
wait -n "$EVAL_PID" "$MODEL_PID"
