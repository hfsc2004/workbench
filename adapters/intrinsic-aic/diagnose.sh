#!/usr/bin/env bash
# diagnose.sh — intrinsic-aic adapter, diagnose verb.
#
# Inventories ROS topics inside the running model container during a
# live AIC eval/play run. The model container's docker network is
# `internal: true`, so we cannot introspect from the host — this script
# exec's into the container and dumps:
#   - ros2 topic list / list -t
#   - ros2 topic info on observation + control + TF channels
#   - 5s ros2 topic hz on the channels the policy loop will read
#
# Output is written to <project_root>/.workbench/diagnose/<UTC_TS>.md
# so the file lands inside the project but does not pollute hand-written
# notes/.
#
# Prereq: the eval stack must already be running, e.g.:
#   workbench run --mode play
# in another terminal. This script does not start the stack itself.
set -euo pipefail

# Find the project root the same way the workbench CLI does.
find_project_root() {
  local d
  d="$(pwd)"
  while [[ "$d" != "/" ]]; do
    if [[ -f "$d/workbench.project.yaml" ]]; then
      echo "$d"
      return 0
    fi
    d="$(dirname "$d")"
  done
  return 1
}

PROJECT_ROOT="$(find_project_root)" || {
  echo "[psf] no workbench.project.yaml found in cwd or any parent" >&2
  exit 1
}

OUT_DIR="$PROJECT_ROOT/.workbench/diagnose"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$OUT_DIR/$TS.md"
mkdir -p "$OUT_DIR"

# Locate the running model container. play.sh / eval.sh name it
# "workbench-aic-model-<pid>" (one per launch), and a fallback compose
# variant uses "aic-model-1". Match the first running container that
# fits either pattern.
MODEL_CTR=""
while IFS= read -r ctr; do
  case "$ctr" in
    workbench-aic-model-*|aic-model-1|aic_model_1|aic-model|aic_model)
      MODEL_CTR="$ctr"
      break
      ;;
  esac
done < <(docker ps --format '{{.Names}}' 2>/dev/null)

if [[ -z "$MODEL_CTR" ]]; then
  echo "[psf] no running model container found." >&2
  echo "[psf] start one first, e.g.: workbench run --mode play --headless" >&2
  echo "[psf] currently running:" >&2
  docker ps --format '  {{.Names}} ({{.Image}})' >&2 || true
  exit 1
fi

echo "[psf] container: $MODEL_CTR"
echo "[psf] writing:   $OUT"

# Activate the pixi env that ships ros2 + the aic_* message types.
# The activate.d scripts depend on CONDA_PREFIX being set (the workspace
# activate sources \$CONDA_PREFIX/setup.sh), and the model container
# never exports it — so we set it explicitly here.
PIXI_ENV=/ws_aic/src/aic/.pixi/envs/default
ROS_EXEC() {
  docker exec "$MODEL_CTR" bash -lc "
    export CONDA_PREFIX=$PIXI_ENV
    export PATH=$PIXI_ENV/bin:\$PATH
    source $PIXI_ENV/setup.sh 2>/dev/null || true
    export RMW_IMPLEMENTATION=rmw_zenoh_cpp
    $1
  " 2>&1 || true
}

{
  echo "# Diagnose — intrinsic-aic"
  echo
  echo "- Container: \`$MODEL_CTR\`"
  echo "- Captured: $TS"
  echo
  echo "## ros2 topic list"
  echo
  echo '```'
  ROS_EXEC "ros2 topic list"
  echo '```'
  echo
  echo "## ros2 topic list -t"
  echo
  echo '```'
  ROS_EXEC "ros2 topic list -t"
  echo '```'
  echo
  echo "## ros2 topic info"
  echo
  for topic in /wrist_wrench /joint_states /center_image /center_camera_info \
               /left_image /right_image /tf /tf_static; do
    echo "### \`$topic\`"
    echo
    echo '```'
    ROS_EXEC "ros2 topic info '$topic' --verbose"
    echo '```'
    echo
  done
  echo "## ros2 topic hz (5s sample)"
  echo
  for topic in /wrist_wrench /joint_states /center_image; do
    echo "### \`$topic\`"
    echo
    echo '```'
    ROS_EXEC "timeout 5s ros2 topic hz '$topic' || true"
    echo '```'
    echo
  done
} > "$OUT"

echo "[psf] done"
echo "[psf] wrote $OUT"
