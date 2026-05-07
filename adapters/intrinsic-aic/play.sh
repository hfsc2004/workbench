#!/usr/bin/env bash
# intrinsic-aic adapter — Play mode launcher.
#
# Owned by Workbench's intrinsic-aic adapter pack. Invoked indirectly
# via `workbench run --mode play` from a project directory.
#
# Play mode brings up the AIC sim WITHOUT the evaluator: sim + controllers
# + task board + cable on the gripper, all visible. No engine, no scoring,
# no fixed trial schedule. The user iterates on their policy against this.
#
# Implementation note:
#   The AIC eval Docker image (ghcr.io/intrinsic-dev/aic/aic_eval) ships
#   with aic_bringup and friends already built and installed. Trying to
#   run the launch file from the host pixi workspace fails because
#   aic_bringup is not in the pixi env (only aic_model, aic_interfaces,
#   and aic_example_policies are). So Play mode runs the launch file
#   *inside* the eval container, just with engine-disabled args.
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
  # If the container we started is still around, stop it cleanly.
  if [[ -n "${CONTAINER_NAME:-}" ]]; then
    docker stop -t 5 "$CONTAINER_NAME" >/dev/null 2>&1 || true
    docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

CONTAINER_NAME="workbench-aic-play-$$"

# Machine-readable line so the parent process (Workbench main) can capture
# the container name and kill it directly on shutdown. This is the
# belt-and-suspenders that protects against a forceful Electron exit not
# letting our trap finish.
echo "[workbench-meta] container_name=$CONTAINER_NAME"

cat <<EOF
[intrinsic-aic/play] Launching Play mode
                     image              = $EVAL_IMAGE
                     gazebo_gui         = $GUI
                     launch_rviz        = $RVIZ
                     ground_truth       = $GROUND_TRUTH
                     spawn_task_board   = $SPAWN_TASK_BOARD
                     spawn_cable        = $SPAWN_CABLE
                     attach_cable       = $ATTACH_CABLE
                     cable_type         = $CABLE_TYPE
                     container          = $CONTAINER_NAME

                     no aic_engine, no scoring, no trial schedule
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

DOCKER_ARGS=(
  run
  --rm
  --gpus all
  --net host
  --name "$CONTAINER_NAME"
  -e "DISPLAY=${DISPLAY:-:0}"
  -e "QT_X11_NO_MITSHM=1"
  -e "NVIDIA_DRIVER_CAPABILITIES=all"
  -v /tmp/.X11-unix:/tmp/.X11-unix:rw
)

if [[ -n "${XAUTHORITY:-}" && -f "$XAUTHORITY" ]]; then
  DOCKER_ARGS+=( -v "$XAUTHORITY:/root/.Xauthority:rw" )
fi

DOCKER_ARGS+=( "$EVAL_IMAGE" )

# Args to the eval image's entrypoint. The image's entrypoint already
# does `ros2 launch aic_bringup aic_gz_bringup.launch.py "$@"`, so we
# just pass the launch arguments here.
LAUNCH_ARGS=(
  start_aic_engine:=false
  shutdown_on_aic_engine_exit:=false
  gazebo_gui:=$GUI
  launch_rviz:=$RVIZ
  ground_truth:=$GROUND_TRUTH
  spawn_task_board:=$SPAWN_TASK_BOARD
  spawn_cable:=$SPAWN_CABLE
  attach_cable_to_gripper:=$ATTACH_CABLE
  cable_type:=$CABLE_TYPE
)

# Run. Using exec would replace this shell, but we need the trap to fire,
# so we don't exec — we let docker run be a child and propagate its exit
# status.
docker "${DOCKER_ARGS[@]}" "${LAUNCH_ARGS[@]}"
