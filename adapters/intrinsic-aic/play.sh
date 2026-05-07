#!/usr/bin/env bash
# intrinsic-aic adapter — Play mode launcher.
#
# Owned by Workbench's intrinsic-aic adapter pack. Invoked indirectly by
# the user via `psf run --mode play` from their project directory.
#
# Brings up the AIC sim WITHOUT the evaluator: sim + controllers +
# task board + cable on gripper, all visible, no fixed trial schedule,
# no scoring pressure. The user iterates on their policy against this.
#
# Inputs (env vars, supplied by Workbench's CLI from psf.project.yaml):
#   PSF_AIC_WS                  Path to the AIC pixi workspace
#   PSF_AIC_GUI                 Show Gazebo window (true/false)
#   PSF_AIC_RVIZ                Show RViz window (true/false)
#   PSF_AIC_GROUND_TRUTH        Expose ground-truth /tf (true/false)
#   PSF_AIC_SPAWN_TASK_BOARD    Spawn task board (true/false)
#   PSF_AIC_SPAWN_CABLE         Spawn cable (true/false)
#   PSF_AIC_ATTACH_CABLE        Attach cable to gripper at start (true/false)
#   PSF_AIC_CABLE_TYPE          Cable model (sfp_sc_cable | sfp_sc_cable_reversed)

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

if [[ ! -d "$PSF_AIC_WS" ]]; then
  echo "[intrinsic-aic/play] AIC workspace not found: $PSF_AIC_WS"
  exit 1
fi

cat <<EOF
[intrinsic-aic/play] Launching Play mode
                     workspace          = $PSF_AIC_WS
                     gazebo_gui         = $GUI
                     launch_rviz        = $RVIZ
                     ground_truth       = $GROUND_TRUTH
                     spawn_task_board   = $SPAWN_TASK_BOARD
                     spawn_cable        = $SPAWN_CABLE
                     attach_cable       = $ATTACH_CABLE
                     cable_type         = $CABLE_TYPE

                     no aic_engine, no scoring, no trial schedule
                     ctrl-c to stop
EOF

cd "$PSF_AIC_WS"

exec pixi run ros2 launch aic_bringup aic_gz_bringup.launch.py \
  start_aic_engine:=false \
  shutdown_on_aic_engine_exit:=false \
  gazebo_gui:=$GUI \
  launch_rviz:=$RVIZ \
  ground_truth:=$GROUND_TRUTH \
  spawn_task_board:=$SPAWN_TASK_BOARD \
  spawn_cable:=$SPAWN_CABLE \
  attach_cable_to_gripper:=$ATTACH_CABLE \
  cable_type:=$CABLE_TYPE
