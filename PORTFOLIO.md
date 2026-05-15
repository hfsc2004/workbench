# PSF Workbench

*A robotics deployment product, designed and built in two weeks, stress-tested against a live industry challenge.*

---

## TL;DR

In two weeks, Pseudo Science Fiction designed and shipped **Workbench v0.2.5** — a deployable wrapper around the ROS 2 / Gazebo / MuJoCo robotics tooling ecosystem, with an Electron desktop app, a CLI, an adapter architecture, a behavior-deck editor, and integrated code generation.

To prove the architecture under real conditions, we authored the `intrinsic-aic` adapter and entered the **Intrinsic AI for Industry Challenge 2026** cable-insertion contest using *only* Workbench as the development and submission environment. The contest was the stress test. Workbench is the product.

---

## 1. Problem

Modern robotics is blocked less by raw capability than by integration cost. The capability has been there for years. The blocker is the cost of going from "interesting tech" to "running on Tuesday afternoon at Bob's Machine Shop in Cleveland."

Concretely, that means:

- ROS 2, Gazebo, MoveIt, Nav2, ros2_control, and vendor SDKs are each individually mature, but composing them into a working development loop takes days of host-machine yak-shaving per project.
- Iteration on perception-to-control policies is slow because the dev loop is fragile: orphan containers, lost log handles, mismatched environments between local play and official eval.
- There is no single tool that owns the verbs an engineer actually presses — `run`, `eval`, `submit`, `diagnose` — across the whole stack, in a way that lets the underlying tooling stay unchanged.

The thesis: wrap, never replace. Make the existing ecosystem deployable without rewriting it.

---

## 2. What was built

### Workbench (the product)

| Component | Status in v0.2.5 |
|---|---|
| Architecture & design (`DESIGN.md`, nine load-bearing rules) | Stable |
| `workbench` CLI: `run` (play/eval/submit), `diagnose`, `help` | Shipped |
| `intrinsic-aic` adapter pack (Play, Eval, Submit, Diagnose) | Shipped |
| Electron desktop UI: splash → chooser → onboarding → operator view | Shipped |
| Behavior Deck editor (compose policies as named cards with parameters) | Shipped |
| Code editor (CodeMirror 6) with autocomplete, search, conflict-aware save | Shipped |
| Code generator: `deck.yaml` → working `policy.py` | Shipped |
| Subprocess lifecycle: clean SIGINT, `docker stop`, orphan-container sweep | Shipped |
| Policy ↔ live sim auto-launch in Play mode | Shipped |
| Eval mode managed by Workbench | Planned |
| Log Intelligence (logs become human status) | Planned |
| Submission flow + fingerprints | Planned |
| Storage Manager | Planned |

The dev loop today: open a project in the desktop app, compose a policy by adding behavior cards (Approach, Descend, Wiggle, Spiral search, Back off, Insert), tweak parameters, click **Save & Generate code**. Workbench writes `deck.yaml` and `policy.py` into the project. Click **Run Play mode** — Gazebo opens and the simulator runs with the policy loaded.

### `intrinsic-aic` adapter (the worked example)

A complete adapter pack that wraps Intrinsic's AI for Industry Challenge:

- `play.sh` — sim + controllers + task board + cable on gripper + the project's policy container.
- `eval.sh` — full evaluator run with `ground_truth:=false`.
- `submit.sh` — builds the submission OCI image and pushes it to the team's AWS ECR repo.
- `diagnose.sh` — inventories ROS topics in the running model container.

The adapter demonstrates that the wrap-never-replace pattern is viable: a third-party robotics challenge with its own simulator, eval harness, and submission pipeline was wrapped without modifying any of the underlying tools.

### Cable-insertion policy (the contest entry)

The policy that ran inside Workbench during the AIC:

- **Trinocular vision** (L / C / R cameras) with pixel-to-base_link back-projection.
- **CAGEVERIFY.C** green-rect detector with corner-triple refinement for cage centering.
- **R-camera dark-triangle detector** for fine alignment.
- **Active perception** — moves to look (clear-sky pose, perspective shift, retreat-saccade) rather than tuning more detectors.
- **Cartesian impedance control** with `ff_force_z` feed-forward for plug seating.
- **Force-trip contact detection** at 1.5 N threshold.
- **Telephone-pole standup** — rotation about plug tip with lever math for the SFP geometry.
- **Multi-cage selection** for NICs with two SFP cages.
- **Jam-probe** with NORTH/SOUTH x-sub-probes and WEST shift for relieving EAST-leaning plug wedges.
- **SC yaw-pulse seek** with CCW/CW wiggle on first-drop detection.

---

## 3. Evidence

*Capture during the live run — to attach before publishing:*

- [ ] Screenshot: Workbench splash and chooser.
- [ ] Screenshot: operator view with Code tab open on `policy.py`.
- [ ] Screenshot: Behavior Deck editor with cards composed.
- [ ] Screenshot: Play mode running, Gazebo window with the task board and cable.
- [ ] Short video: a clean SC trial insertion in Play mode.
- [ ] Screenshot: an AWS ECR submission line in the run log.
- [ ] Screenshot: an Intrinsic eval result line with the per-trial breakdown.
- [ ] Metrics timeline: local-eval score progression across iterations.

### Failure analysis (the most honest part)

Five bugs that were caught and diagnosed during the live run, each preserved here because the diagnosis is the engineering signal — not the fix:

1. **`ff_force_z` sign convention was inverted.** Docstring claimed negative = down. Experimental flip of `PRESS_FF_FORCE_N` from −8 to +8 revealed the opposite: negative values were lifting the wrist 26–35 mm per stage. All SFP `ff_force_z` values were flipped to positive after measurement, not after reading documentation.

2. **`CAGEVERIFY.C` only ran when the R-camera detector succeeded.** A guard clause (`if cage_result is not None`) meant that when R-camera detection failed — which it did, hard, on bad approach angles — the green-rect verifier never ran and no debug PPM was saved. Removing the guard surfaced the actual failure mode.

3. **Multi-cage selection picked the wrong cage on T1.** Initial convention (`cage_idx=0` → lower u) caused a −12 "Incorrect Port" penalty. Flipped the convention so `cage_idx=0` → higher u (right cage in image). Verified by the penalty going away on the next run.

4. **Five survivors → picked a false positive.** Multi-cage select with all survivors picked a PCB feature instead of a cage. Filtered to "two southernmost (largest cy)" then sorted by u descending.

5. **Local-vs-Intrinsic environment parity gap.** Local eval scored 94 on T1 with a clean full insertion; Intrinsic's eval scored 27 on T1 with the same submitted image and reported "Final plug port distance: 0.10 m." This is the discrepancy that defines v2's first investigation: figure out *why* local and official eval diverge, before tuning anything else.

---

## 4. Technical depth

- **ROS 2 lifecycle + action integration** under a Workbench-managed subprocess tree, with clean SIGINT propagation and orphan-container sweep on next start.
- **Gazebo / RViz workflow** auto-launched from the project YAML, with CLI flag overrides (`--gui` / `--no-gui` / `--rviz` / `--no-rviz` / `--headless`) for headless CI.
- **Perception heuristics + model hooks.** Geometry-only vision detectors (grayscale luminance, edges, shape) with a model-loading path for an offset-correction model.
- **Determinism vs robustness tradeoffs.** Deterministic Cartesian moves for known-good geometry; probe-and-press loops for slot search; force-trip thresholds for contact confirmation. The active-perception pattern — move to look, rather than tune another detector — was a deliberate choice after measuring that detector-tuning hit diminishing returns.
- **Adapter architecture.** Adapters provide nouns, Workbench owns verbs. The `intrinsic-aic` adapter is one of an open set; the design extends to MuJoCo, microcontroller endpoints (ESP32, RP2040), and industrial protocols (PLC, Modbus, OPC-UA).
- **Code generation pipeline.** `deck.yaml` (composed in the UI) → `policy.py` (derived from `aic_model.policy.Policy`) → loaded into the policy container at runtime. Generated artifacts land on disk in the user's project — readable, editable, and version-controllable. No hidden state.

---

## 5. Design discipline

The nine load-bearing rules from `DESIGN.md`, held under deadline pressure:

1. **Wrap, never replace.** Workbench does not reimplement what existing robotics tooling already does well.
2. **Workbench owns the verbs the user actually presses.** Adapters provide the nouns.
3. **Emit, don't hide.** Generated artifacts land on disk, readable and editable. No magical hidden state.
4. **Every run gets a fingerprint.** Reproducibility is the industrial trust layer.
5. **Logs become human status.** Workbench's log handling is a contextual interpreter, not a filter.
6. **Workbench owns storage layout.** When the user says "use the big drive," every tool's data root goes there. Migration is never silent.
7. **No telemetry by default.** Local-first means local-first.
8. **Secrets never leave the secrets store.** Never written to fingerprints, generated artifacts, logs, telemetry, or audit records.
9. **Engines never own actuation.** Every engine output passes through a deterministic safety gate.

These rules were not aspirational. They shaped concrete decisions during the AIC sprint — for example, refusing to embed AWS credentials in fingerprints (rule 8) even when it would have been faster, and refusing to silently relocate the user's data root when switching machines (rule 6).

---

## 6. Outcome

**Two weeks**, solo, from cold start to:

- A working v0.2.5 product with a desktop UI, a CLI, an adapter architecture, and a code-generating behavior-deck editor.
- A complete `intrinsic-aic` adapter that exercises every Workbench surface (`play`, `eval`, `submit`, `diagnose`).
- A vision-guided cable-insertion policy with trinocular triangulation, force-trip contact, active perception, multi-cage selection, telephone-pole standup, and jam-probe recovery.
- A live submission pipeline to AWS ECR, with the adapter handling tag bumps, region config, and image push.
- A live entry in the **Intrinsic AI for Industry Challenge 2026**, run end-to-end through Workbench, with local trial scores up to 94 on single-cable insertions during development.

The qualification eval surfaced a local-vs-official environment parity gap that v2 will address first. That gap is not a failure of the policy — it is the artifact of running a real challenge against a v0.2.5 product and learning what the v0.3 roadmap needs to include.

---

## 7. Lessons

**Environment parity is the first thing to verify on any new adapter.** Local "Play" and official "Eval" environments diverged on us mid-sprint, in ways that only surfaced when comparing scored runs. The v2 roadmap puts environment fingerprinting and parity-check tooling ahead of any further policy work.

**Headless robustness matters more than UI polish.** The CLI's `--headless` flag and the subprocess-lifecycle work — clean SIGINT, awaited `docker stop`, orphan sweep — were the single most-used features during the AIC sprint. The Electron UI was the entry point; the CLI was the workhorse.

**Wrap-never-replace held under pressure.** Every time we were tempted to fork a piece of upstream tooling to make our deadline, the discipline of writing an adapter shim instead paid off within hours. The shims are small and obvious. Forks would have been carrying weight today.

**Measurement beats blind tuning.** The single biggest jump in policy quality during the AIC came from one experimental sign flip on `ff_force_z`, not from any amount of constant-tweaking. The v2 plan front-loads characterization runs (force-vs-displacement, vision-detection-rate-vs-pose) before any tuning.

**What v2 looks like:**
- Eval mode managed by Workbench (not just dispatched to the adapter).
- Log Intelligence: structured score parsing, per-trial diff against last run, "what changed since the last passing build."
- Fingerprints: every run produces an auditable manifest of code, image digests, adapter version, and host config.
- Storage Manager: a single place to point all tool data roots, with explicit migration steps.
- Environment-parity checks between local Play and official Eval, run as a verb before submission.

---

*Copyright 2026 Pseudo Science Fiction*
