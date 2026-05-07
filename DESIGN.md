# PSF Workbench

> Anything you'd have to set up by hand to use modern robotics tooling
> productively, Workbench sets up for you. The underlying software runs
> unchanged. The user's relationship with it changes.

This document describes PSF Workbench — a standalone robotics product whose
job is to make robotics tooling deployable and usable, so the end user can
focus on robotics instead of DevOps. The first deep target is the ROS 2
ecosystem (Gazebo, MoveIt, Nav2, ros2_control, vendor SDKs); the
architecture is built to extend cleanly to non-ROS targets — MuJoCo,
microcontroller endpoints (ESP32, RP2040), and industrial protocols (PLC,
Modbus, OPC-UA) — as adapters land.

PSF Workbench is built using parts from a shared internal parts bin, but
ships as its own coherent standalone product. There is no separate platform
to install, no daemon to run, no cross-product dependency at the user's
machine.

This is the *what we are building* document. It is not the next-eight-days
plan — that lives in `AIC-Submission/notes/PLAN.md`. **Workbench is the north
star; the AIC submission is the spear tip.** Until 2026-05-15 19:59 UTC, the
spear tip is the only thing being built.

---

## Part 1 — What this is

### The product, in one paragraph

PSF Workbench is a standalone robotics product that wraps the software
gauntlet around modern robotics work and makes it deployable and usable
without DevOps expertise. Its first and deepest coverage is the ROS 2
ecosystem (Gazebo, MoveIt, Nav2, ros2_control, vendor SDKs, simulators).
Its architecture is designed to extend to adjacent targets — MuJoCo,
microcontroller endpoints (ESP32, RP2040), and industrial protocols (PLC,
Modbus, OPC-UA) — without forcing them through ROS 2. The user works on
robotics; Workbench handles the software gauntlet around it.

### Who it's for

Three named users, in priority order. Workbench isn't done until all three
can be productive within an hour:

1. **The competitor.** Trying to qualify for a robotics challenge in days,
   not weeks, without a DevOps team.
2. **The lab tech.** Has a UR5e arm and a sponsor visit Tuesday. Wants to
   swap policies between three demos without learning ROS launch files.
3. **The shop floor engineer.** Twelve-employee CNC operation. Wants to add
   a vision-based defect classifier on the line. Cannot hire a roboticist.

### What it does, concretely

For ROS 2 — Workbench's first and deepest coverage area — Workbench targets
the workflows users repeatedly struggle to deploy: simulation, robot
description, motion planning, control, navigation, perception, logging,
replay, and packaging. The underlying software keeps doing what it does
well; Workbench provides the smoother surface above. For non-ROS targets
(MuJoCo, microcontrollers, industrial protocols), the same adapter pattern
applies as those adapters are built.

### Modes — the key abstraction for usable robotics

A Workbench project does not have one way to run. It has **modes**, and
the user picks the right one for what they're doing right now. This is one
of the most load-bearing UX ideas in the platform: the difference between
"developable robotics" and the current "test-only" experience comes down
to whether modes exist at all.

For a robotics project, the four canonical modes are:

| Mode | What runs | What it's for |
|---|---|---|
| **Play** | Sim + controllers + the user's policy. No evaluator, no scoring, no fixed trial schedule. | Develop, tweak, watch, iterate. The default mode while writing a policy. |
| **Eval** | The full evaluation stack as the host ships it (engine, scoring, trial sequencer). | Score against the rubric. Verify the policy passes. Submit-ready. |
| **Replay** | No live sim. Recorded bag/MCAP file feeds observations into the policy. | Test changes against past runs. Debug a specific failure deterministically. |
| **Submit** | Build OCI image, fingerprint, push to ECR or equivalent. | Ship the actual entry. |

The user picks a mode in the UI; Workbench handles the orchestration
differences underneath. Same source files. Same project. Different ways to
run it.

Why this matters: most robotics evaluation environments today only support
something like Eval mode. They package "run the test, get a score, tear
down" and call that the developer experience. It isn't. You can't iterate
on a policy if the only way to see it run is a 6-minute scored evaluation
that doesn't let you pause, change a parameter, or watch a single phase up
close. Play mode is what makes a robotics project actually *developable*.

For an adapter to be considered complete in Workbench, it must support at
least Play and Eval modes. Replay and Submit are mode-shaped features
that may or may not apply depending on what the underlying tooling
supports.

| Underlying software | Workbench provides |
|---|---|
| Nav2 | One-command Nav2 bring-up, sensible defaults, automatic config wiring |
| MoveIt | One-command MoveIt setup, motion-primitive API that calls MoveIt under the hood |
| ros2_control | Adapter that maps Workbench's canonical Action types to ros2_control commands |
| URDF / robot descriptions | "Register robot" step that loads URDF and exposes it as a Workbench object |
| TF / coordinate frames | The frame tree as a queryable Workbench object — no tf listener code |
| Lifecycle nodes / actions / topics | Hidden by default. User declares "I want to drive this robot"; Workbench handles the lifecycle dance |
| Bag recording / replay | First-class Workbench operation, automatically tied to fingerprints |
| Discovery / QoS profiles | Sensible defaults, overrideable, user never has to think about them |
| Vendor SDKs (UR, Franka, KUKA, ABB, …) | Adapters that wrap them; user picks a robot from a list |
| Simulators (Gazebo, MuJoCo, Isaac, …) | Adapters; user picks a sim from a list |
| Foxglove / Formant integration | Adapters or built-in views |
| MuJoCo (non-ROS path) | Direct adapter; no ROS bridge required |
| ESP32 / RP2040 microcontrollers | Endpoint adapter, serial/USB transport, schema mapping |
| PLC / Modbus / OPC-UA | Industrial endpoint adapters |

The pattern is the same one you've already shipped in Core's HF model
intake: paste a pointer, the platform does the rest, the user clicks Run /
Delete / Re-Run / Submit. Workbench applies that pattern across the
robotics software gauntlet.

### What it is not

- **Not a replacement for ROS 2 or any other underlying tooling.** ROS 2,
  Nav2, MoveIt, ros2_control, vendor SDKs, MuJoCo, microcontroller
  toolchains, and industrial protocol stacks all keep doing the heavy
  lifting. Workbench wraps them.
- **Not a new message bus.** Adapters bridge to existing buses and
  protocols (DDS, Zenoh, MQTT, Modbus, OPC-UA, serial, etc.). No new wire
  protocol.
- **Not primarily a model-training platform.** Workbench may orchestrate
  external training tools, but its core job is runtime, policy,
  deployment, diagnostics, evaluation, testing, and reproducibility.
- **Not certified safety.** Workbench provides safety primitives;
  certification of any specific deployment is the integrator's
  responsibility.
- **Not hardware.** Software-only.

### The thesis

Industry 4.0 and modern robotics are blocked less by raw capability than by
integration complexity. The capability has been there for years. The
blocker is the cost of going from "interesting tech" to "running on Tuesday
afternoon at Bob's Machine Shop in Cleveland." Workbench reduces that cost
by wrapping robotics tooling so domain experts can focus on the actual
machine.

---

## Part 2 — Standalone product, internal parts bin

PSF Workbench ships as a **standalone product**. There is no separate
platform, no daemon, no upstream service the user has to install or trust.
Workbench is internally built from a parts bin of well-engineered shared
modules, but the user never sees that. To the user, Workbench is one
thing.

Internally, Workbench draws from a shared library of parts:

```
parts the product uses (internal — invisible to user)
─────────────────────────────────────────────────────
catalog mechanism            (registers robots, sims, ROS packages)
log intelligence framework   (with robotics rule packs)
storage manager              (Docker / containerd / build cache)
runtime manager              (containers, processes)
build / run / package        (OCI images, compose generation)
fingerprinter                (every run, every artifact)
audit trail                  (decisions, overrides)
adapter substrate            (the framework adapters plug into)
deck-driven orchestration    (project graph, compile, run)
UI / CLI shell               (extended with robotics views)
```

The user installs Workbench. They get one product. The parts bin is an
implementation detail of how that product was built efficiently.

If future products are built from the same parts, they are **siblings** —
each its own coherent standalone product. Nothing requires the user to
think about other products to use Workbench.

---

## Part 3 — The Workbench design rules

These are non-negotiable rules Workbench holds itself to when using Core
parts and when adding its own robotics-specific code.

### Rule 1 — Wrap, never replace

Workbench does not reimplement what existing robotics tooling already does
well. Nav2, MoveIt, ros2_control, vendor SDKs, simulators, microcontroller
toolchains, industrial protocol stacks — all keep doing their jobs.
Workbench provides the deployment, configuration, and developer experience
around them.

If we ever feel the urge to write our own motion planner because MoveIt is
"too complex," that is the warning sign. The complexity is the price of
capability; our job is to manage it, not duplicate it.

### Rule 2 — Workbench owns the verbs the user actually presses

The user presses **Run, Stop, Score, Submit, Replay, Delete, Re-Run.**
Workbench owns those. Adapters provide the *nouns* — the robot kinds,
simulator kinds, package kinds, endpoint kinds. The verbs do not vary
across robots; the nouns do.

### Rule 3 — Emit, don't hide

Every artifact Workbench generates lands on disk in the user's project,
readable, editable, git-trackable. No magical hidden state. No opaque
caches that determine runtime behavior the user can't see.

```
project/
├── psf.project.yaml
├── policy/
├── generated/
│   ├── MANAGED.md          ← rules of the road
│   ├── Dockerfile          # workbench:owned
│   ├── docker-compose.yaml # workbench:owned
│   ├── entrypoint.sh       # workbench:editable
│   ├── policy_wrapper.py   # workbench:editable
│   └── ros2_launch.py      # workbench:owned
└── logs/
```

Three trust modes per generated file:

- `# workbench:owned` — fully regenerated on `psf sync`. Edits are lost.
- `# workbench:editable` — has marked sections (`>>> psf:start` /
  `<<< psf:end`) that Workbench rewrites; everything outside is preserved.
- `# workbench:detached` — was generated once and is now the user's.
  Workbench will not touch it again.

The break-glass command is `psf sync --regenerate`, which rebuilds every
file, ignoring local edits.

### Rule 4 — Every run gets a fingerprint

Every run produces a manifest tying the result to the exact source state
that produced it:

```json
{
  "project": "aic-cable",
  "run_id": "2026-05-07T13:01:18.273Z-7f3a",
  "policy_fingerprint": "sha256:...",
  "adapter": "intrinsic-aic",
  "adapter_version": "0.1.0",
  "docker_image_digest": "sha256:...",
  "runtime_config_hash": "sha256:...",
  "host_facts": {
    "os": "ubuntu-24.04",
    "kernel": "6.14.0-36-generic",
    "container_runtime": "docker-29.3.1",
    "gpu_class": "Quadro M5000",
    "driver": "535.247.01"
  },
  "score": 110.48,
  "timestamp": "2026-05-07T13:01:18Z"
}
```

`host_facts` captures *non-identifying* runtime facts needed for
reproducibility. It must not include usernames, hostnames, MAC addresses,
absolute home paths, or secrets.

Without fingerprints, "this exact thing produced this exact result under
these exact conditions" is unfalsifiable. Industrial users won't trust a
platform that can't replay a result.

### Rule 5 — Logs become human status

Workbench's log handling is a **contextual interpreter, not a filter**. A
filter throws data away; an interpreter classifies it without removing it.
Users see a friendly summary by default; raw lines are one click away.

Raw input the user used to suffer through:

```
double free or corruption (!prev)
component_container died
gz sim killed
```

Workbench output:

```
Evaluation completed successfully.
Ignored:
  • 4 known Gazebo shutdown artifacts
  • 1 RViz exit cleanup warning
Action needed: none.
Score: 3 trials, task not completed.
```

Adapter authors contribute *rules* to the interpreter. They don't write
their own classifiers. The classifier is a single shared component inside
Workbench; adapters contribute rule packs for ROS 2, Gazebo, AIC, vendor
SDKs, etc.

### Rule 6 — Workbench owns storage layout

When the user says "use the big drive," Workbench moves *every* tool's data
root that it knows about (Docker, containerd, build cache, model cache,
log archive, generated artifacts) and reports a single layout:

```
psf storage status

Project data:        /mnt/bigdrive/psf/projects   ✓ managed
Docker data:         /mnt/bigdrive/psf/docker     ✓ managed
containerd data:     /mnt/bigdrive/psf/containerd ✓ managed
Build cache:         /mnt/bigdrive/psf/build-cache ✓ managed
Logs archive:        /mnt/bigdrive/psf/logs       ✓ managed
Generated artifacts: /mnt/bigdrive/psf/generated  ✓ managed

⚠ Detected unmanaged storage:
  /var/lib/containerd using 22 GB
  Run: psf storage adopt /var/lib/containerd
```

This rule comes from a real wound: during the AIC bring-up, Docker silently
kept 22 GB on `/var/lib/containerd/` after we'd asked the system to use the
big drive. No diagnostic in the entire stack surfaced where that data lived.
Workbench owning the layout is the platform-level fix.

**Storage migration is never silent.** Workbench performs a dry run before
any move, shows the user exactly what will be moved and from where to where,
stops affected services cleanly, preserves rollback instructions in case
anything fails, and verifies the new layout works before deleting old data.
Running out of disk is bad; losing data because the platform "helpfully"
moved it without telling you is unforgivable.

### Rule 7 — No telemetry by default

Workbench is local-first. Local-first means local-first. Any telemetry
("rage report," anonymous error stats, usage stats) must be:

- Opt-in, off by default
- Inspectable before sending (user sees exactly what would go out)
- Scrubbed of secrets and identifiers

The platform's value comes from being trustworthy infrastructure, not from
exfiltrating user data.

### Rule 8 — Secrets never leave the secrets store

Secrets are never written to fingerprints, generated artifacts, logs,
telemetry reports, or audit records. Secret values are referenced by local
key name or profile only.

This applies to AWS access keys, ECR credentials, ROS 2 ACL passwords,
vendor SDK tokens, model API keys, MQTT broker credentials, and anything
else a user might reasonably configure. Workbench's verbs accept secret
*references* (`{{ secrets.aic_ecr_secret }}`, `--profile aic`) and resolve
them at runtime against a secrets store the user controls. The resolved
value never appears anywhere else.

This is non-optional. A platform that writes a user's AWS secret into a
log file is, in industry, a fired-vendor. We don't build that.

### Rule 9 — Engines never own actuation

Workbench hosts policy engines (Reflex, FSM, Model-Advised, Teleop /
Replay). Engines produce candidate `Action`s. **Every engine output passes
through a deterministic safety gate** that validates against pre-declared
bounds (force, velocity, position delta, joint limits) before any adapter
sees a command.

**No engine — learned, scripted, replayed, or human-driven — bypasses the
deterministic safety gate.** This is non-negotiable across all engine kinds.
Teleop is not an exception. Replay is not an exception. A future engine kind
is not an exception. The gate is the single chokepoint between policy and
actuator, and every command goes through it.

Engines suggest. Safety decides. The robot is never driven directly by a
learned model.

---

## Part 4 — Architecture

### Layered view

```
┌──────────────────────────────────────────────────────────────┐
│ User Intent                                                  │
│ "Insert this cable. Stop on excessive force. Submit to AIC." │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────┐
│ Policy Layer                                                 │
│ State machines, force guards, primitives, reflex selection   │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────┐
│ Workbench Engines                                            │
│ FSM | Reflex | Model-Advised | Teleop / Replay               │
│ All outputs pass through deterministic safety gate           │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────┐
│ Adapter Layer                                                │
│ AIC | Generic ROS 2 | Gazebo | MuJoCo | UR | Franka | ...    │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────┐
│ Workbench Verbs                                              │
│ Run | Stop | Log | Diagnose | Fingerprint | Package | Submit │
│ Replay | Audit | Sync | Storage                              │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────┐
│ ROS 2 Ecosystem (unchanged, doing the actual work)           │
│ Nav2 | MoveIt | ros2_control | vendor drivers | simulators   │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────┐
│ Runtime Substrate                                            │
│ Docker / containerd / pixi / NVIDIA / kernel                 │
└──────────────────────────────────────────────────────────────┘
```

Users primarily think in the top two layers and operate Workbench through
the verb layer. They should rarely need to reason about adapters, ROS 2
internals, or runtime substrate directly. Workbench owns the middle. The
underlying tooling keeps doing what it does well at the bottom.

### Engines

- **FSM Engine.** Finite state machine over phases. Pure declarative YAML.
  The default starting point for any policy. ~80% of users live here.
- **Reflex Engine.** SNN/STDP-flavored. Selects among safe primitives based
  on bounded learnable weights. Three modes: shadow, active, frozen. The
  inheritor of Core-Reflex's policy core.
- **Model-Advised Engine.** Uses an LLM or foundation model as an *advisor*.
  Model proposes; safety gate disposes. Works whether the model is local
  Gemma on a P4 or hosted Claude.
- **Teleop / Replay Engine.** Human or recorded trajectory drives the robot.
  For demos, training data collection, shadow comparison.

All four obey Rule 8: never own actuation directly. Output is validated and
clamped before it reaches an adapter.

### Adapter responsibilities

An adapter for a robotics resource (a robot kind, a simulator kind, a ROS
2 package kind) provides a small, fixed set of responsibilities:

1. **Discovery / fetch** — given a pointer (URL, package name, git ref),
   know how to identify and fetch the resource.
2. **Schemas** — translate between Workbench's canonical Observation /
   Action types and the resource's native messages.
3. **Lifecycle** — how to bring this resource up and down (compose template,
   ros2 launch invocation, env vars, ready/health checks).
4. **Configuration** — user-facing config knobs the resource exposes.
5. **Diagnostics** — log rules contributed to Workbench's log interpreter.

Anything else (build images, push to a registry, classify logs, manage
storage) belongs in Workbench's own verbs, not in adapters. Adapters are
thin by rule.

### The schema

**Convention over enforcement.** Tagged dict, hierarchical keys, strict
timestamp.

```python
Observation(
    t=12345.678,
    fields={
        "tcp.pose.actual": Pose3D(...),
        "tcp.pose.target": Pose3D(...),
        "tcp.velocity":    Twist6D(...),
        "wrench.wrist":    Wrench6D(...),
        "joint.angles":    Vec(...),
        "vision.center":   Image(...),
        "task.target":     Pose3D(...),
        "frames.tf":       FrameTree(...),
    },
)

Action(
    t=12345.700,
    primitive="move_relative",
    params={
        "dx_mm": 0.2, "dy_mm": -0.1, "dz_mm": -0.5,
        "speed": "slow",
        "force_limit_n": 8.0,
    },
)
```

Adapters fill the dict from whatever underlying ROS 2 messages they wrap;
policies read from a known schema.

**Schema growth is bounded by review, not by hard cap.** Soft budget:
~25 action primitives, ~20 observation field families. New entries
require proof that existing entries cannot express the behavior safely or
clearly. Discipline lives in code review.

### Primitive families (sketch)

The action vocabulary is broad because ROS 2's robotics scope is broad:

- **Manipulation:** pose targets, joint targets, force-controlled motion,
  gripper actions
- **Locomotion:** waypoint navigation, velocity commands, follow-path
- **Aerial:** altitude hold, position hold, waypoint, takeoff/land
- **Perception:** detect objects, segment scene, track target
- **Coordination:** rendezvous, formation, handoff
- **Safety:** emergency stop, soft limit, watchdog reset

We don't ship all of these in v1. The first delivery covers the
**manipulation slice** (because that's what AIC needs). Later versions add
families as adapters land.

### The Reflex Engine specifically

The Reflex Engine inherits the SNN/STDP work from Core-Reflex with these
non-negotiable constraints:

- Output is **selection among finite primitives**, never continuous joint
  commands.
- Each primitive has hard pre-validated bounds enforced *after* selection.
- **STDP weights are frozen during evaluation.** Learning happens only in
  a designated training mode.
- Every decision produces an audit record:

```json
{
  "time": 12345.72,
  "phase": "contact_search",
  "selected_primitive": "micro_wiggle_left",
  "reason": "right lateral force increased while insertion depth stalled",
  "signals": {"force.y": 6.8, "depth_progress_rate": 0.0},
  "alternatives": [
    {"primitive": "back_off", "score": 0.61},
    {"primitive": "descend",  "score": 0.12}
  ],
  "safety_gate": {"allowed": true, "max_delta_mm": 0.2, "force_limit_n": 8.0},
  "policy_fingerprint": "sha256:...",
  "frozen_weights": true,
  "rule_pack_versions": {"safety": "1.2.0", "primitives": "0.7.1"}
}
```

The audit record turns "AI voodoo" into "explainable automation."
Industrial users will reject the platform without it; with it, they have
a forensic trail.

---

## Part 5 — Policy authoring

Three levels, gradient is explicit.

**Level 1 — Behavior Deck (YAML).** Most users.

```yaml
task: insert_cable

states: [init, align, descend, contact, micro_search, insert, verify, recover, done]

safety:
  max_force_n: 18
  sustained_force_limit_n: 12
  backoff_distance_mm: 2

motion:
  descend_step_mm: 0.5
  micro_wiggle_mm: 0.2
  speed: slow
```

**Level 2 — Decision function (Python).** When YAML stops being expressive
enough.

```python
def decide(obs, state):
    if obs.fields["wrench.wrist"].fz > 12:
        return Action(primitive="back_off", params={"distance_mm": 2})
    if state.phase == "contact":
        return Action(primitive="micro_wiggle", params={"distance_mm": 0.2})
    return Action(primitive="descend", params={"step_mm": 0.5})
```

**Level 3 — Raw plugin / direct ROS 2 access.** Documented escape hatch.
A small minority of users need this; the platform shouldn't pretend they
don't exist, but shouldn't make them the default path either.

UI surface: right-click a YAML state → "open as Python." The upgrade path
is visible.

---

## Part 6 — CLI and UI

### CLI (automation surface)

```bash
psf project new aic-cable --adapter intrinsic-aic
psf adapter install intrinsic-aic
psf policy generate --template reflex-fsm
psf run                           # local eval, headless
psf run --gui                     # local eval, Gazebo + RViz on screen
psf score --last
psf submit --version aic-q-0.1.0
psf storage status
psf storage migrate --to /mnt/bigdrive/psf
psf logs --last --explain
psf replay <run_id>
```

### UI (trust surface, demo surface)

The CLI is for CI/CD and power users. The UI is for humans who need to
*see* what's happening.

A running policy view shows the things a robotics user actually wants to
see: force/torque traces, pose error, the current state machine phase, the
current primitive, safety overrides, score timeline, log classification.

```
┌──────────────────────────────────────────────────────────────────┐
│ Project: aic-cable          Adapter: intrinsic-aic     ● Running │
├──────────────────────────────────────────────────────────────────┤
│ Engine: Reflex (frozen)     Phase: contact_search                │
│                                                                  │
│   Force (N) ▁▂▃▅▇▆▅▆▇▇▆▅▄  current 7.2  limit 18                 │
│   Pose err  0.3 mm                                               │
│   Depth     12.4 / 25.0 mm                                       │
│                                                                  │
│ Selected primitive: micro_wiggle_left                            │
│ Reason: right lateral force increased while depth stalled        │
│ Safety gate: ✓ allowed (Δ ≤ 0.2 mm, force ≤ 8 N)                 │
│                                                                  │
│ Score timeline:    trial_1: 1.0    trial_2: pending    --        │
│ Logs: ✓ 0 fatal   ⚠ 0 action needed   ◌ 3 ignored                │
└──────────────────────────────────────────────────────────────────┘
```

This is the "oh, I understand what's happening" moment that wins industrial
trust.

---

## Part 7 — Open source vs. commercial

### Open source

- Workbench core (everything in this document, in its base form)
- Adapters for open-source runtimes: AIC, generic ROS 2, Gazebo, MuJoCo
- Policy deck format and reference templates
- All four engine kinds (FSM, basic Reflex, basic Model-Advised, basic
  Teleop / Replay)
- Basic rule packs for log intelligence

### Commercial

- Adapters for proprietary runtimes (Isaac Sim, vendor-specific PLC
  integrations, proprietary industrial runtimes)
- Advanced Reflex tuning and audit tooling
- Industrial adapter bundles (pre-validated configs for common deployments)
- Validated / certified primitive libraries
- Premium diagnostics and rule packs
- Support and SLAs
- Fleet / multi-tenant edition (multi-user, RBAC, signed deployments)

The open-source side carries reputation. The commercial side funds
development. Standard pattern.

---

## Part 8 — Failure modes

The four most likely ways Workbench fails over the next 18 months:

**Niche-tool-trap.** Beloved by 50 users, never grows. *Watch:* explicit
user-count milestones at 6 / 12 / 24 months. If the curve flattens, we're
in this trap and need to act.

**Vendor-flank.** A NVIDIA Isaac, an Intrinsic Flowstate, etc. ships a
competing platform that eats our oxygen. *Mitigate:* keep open-source
license clear and the architecture modular, so even if a vendor outflanks
the commercial tier, the open core remains usable.

**Complexity creep.** By year 2 we've added 30 features and become the
sprawling thing we were supposed to replace. *Watch:* the design rules
above must be enforced ruthlessly. Schema growth is a tracked metric. If
we breach the soft budget without strong justification, we have a problem.

**Wrong problem.** Robotics adoption stagnates for non-tooling reasons
(capital cost, labor, regulation). A perfect platform unlocks little.
*Hedge:* make the open core valuable to non-industrial users (research
labs, robotics education, hobbyist makers) so the platform survives
regardless of industrial uptake.

---

## Part 9 — Workbench v0.1 success criteria

Before any roadmap dates or "phases," what does v0.1 actually have to *do*?
This is the bar for "Workbench v0.1 is a real product." Seven criteria:

1. **Create an AIC project.** A user runs one command (or clicks one
   button) and gets a working project directory with adapter wiring,
   policy template, and inspectable generated artifacts.
2. **Generate inspectable artifacts.** Dockerfiles, compose files,
   entrypoints, launch files all land in `generated/`, marked with their
   trust mode, readable and editable.
3. **Run in Play mode.** Sim + controllers + policy come up without the
   evaluator. Policy can be edited and hot-reloaded without restarting
   the sim. The user can watch the robot live and iterate.
4. **Run in Eval mode.** The full AIC eval stack runs headless or GUI.
   One command to run; the GUI/headless toggle is a flag, not a different
   procedure.
5. **Explain logs.** When a run finishes, `psf logs --explain` produces
   the friendly summary instead of dumping raw output. Raw is preserved
   and one click away.
6. **Build and push a submission image.** OCI image is built, fingerprinted,
   tagged, pushed to ECR. Portal-ready URI is emitted.
7. **Produce a run fingerprint and score record.** Every run gets a
   manifest tying score to source state. `psf replay <run_id>` works.

If Workbench v0.1 ships and a user can do all seven on a clean machine in
under 30 minutes, the product is real. Anything beyond these is v0.2+.

---

## Part 10 — Build order

### Phase 0 — Now → 2026-05-15 19:59 UTC

**Goal:** valid AIC submission scoring in the leaderboard top 30.

**Do:** what's in `AIC-Submission/notes/PLAN.md`.

**Do not:** start building Workbench. Do not generalize adapters. Do not
build storage manager. Do not rewrite Core-Reflex around the platform
vision.

The AIC entry is the spear tip. Workbench is the north star. Spear tip
first, every time.

### Phase 1 — Week of 2026-05-18 (Lessons File)

Capture every friction point from the AIC week as structured input:

- pain point
- raw log / error message
- what it actually meant
- how we worked around it
- what Workbench feature would prevent / fix it
- priority
- canonical example (so we can build the test case)

This file becomes the seed corpus for the log interpreter and the
prioritized backlog for everything else. Real ground-truth pain logs from
a solo competitor walking the entire toolchain are roadmap research most
platform companies don't have.

### Phase 2 — Log Intelligence v0.1 (target window: late May / early June)

Build the contextual interpreter using the AIC log corpus as the first
training set. Rule-based, named, inspectable. No generic AI magic.

Initial rule packs:
- `known_shutdown_noise`
- `missing_zenoh_route`
- `policy_not_discovered`
- `docker_image_missing`
- `ecr_auth_expired`
- `gpu_runtime_missing`
- `compose_network_failure`

Ship as a standalone CLI (`psf-loglens` or similar) so it provides value
even before the rest of Workbench exists. Pipe any docker-compose log
through it; get the friendly summary.

### Phase 3 — Storage Manager v0.1 (target window: mid-June)

Build the subsystem that owns Docker / containerd / build-cache /
model-cache / log-archive layout. Detects unmanaged storage, offers
adoption, enforces single-place-for-everything semantics.

Scope-restricted: pure infrastructure hygiene.

### Phase 4 — AIC adapter hardening + UI v0.1 (target window: late June / early July)

Refactor the AIC adapter (currently in Core-Reflex) into the proper thin
shape: five responsibilities, no embedded mini-platforms. Wire it into
Workbench's verbs (build, run, log, fingerprint, push).

In parallel, extend the UI to show:
- Project status
- Running policy state (force, pose, phase, primitive)
- Log interpreter summary
- Score timeline

Goal: the 30-minute AIC bring-up demo is recordable end-to-end through
the UI.

### Phase 5 — Reproducibility fingerprinting (target window: mid-July through early August)

Thread fingerprints through every operation: project, adapter, build, run,
score. Implement `psf replay <run_id>`. Audit trail subsystem.

This is the industrial trust layer. Without it, Workbench is a polished
hobby tool. With it, it's infrastructure.

### Phase 6 — Second adapter (target window: August)

Pick **MuJoCo** or **ESP32 endpoint**.

- **MuJoCo** proves we can swap simulators. Lower scope, faster.
- **ESP32 endpoint** proves we can talk to real hardware. Higher value,
  more work.

I'd lean MuJoCo for the immediate "two real things work the same way"
demo, with ESP32 to follow.

**Do not** attempt a generic ROS 2 adapter at this stage. AIC was
constrained; generic ROS 2 is the haunted forest. Save it until we have
3-4 specialized adapters and the abstractions are battle-tested.

### Phase 7 — Onward (September → ...)

- Generic ROS 2 adapter
- Industrial endpoints (Modbus, OPC-UA, MQTT Sparkplug)
- Vendor robot adapters (UR, Franka, KUKA)
- Mobile platform adapters (Spot, TurtleBot)
- Fleet / commercial edition
- The roadmap branches based on which user persona generates the most
  traction.

**All post-AIC dates are target windows, not commitments.** Workbench is
being built around real life, not a Gantt chart.

---

## Part 11 — The killer demo

> Manual path:        3 days of toolchain archaeology
> Workbench path:     under 30 minutes

Split-screen video. Left side: edited time-lapse of *real* terminal output
from the AIC bring-up week — docker pulls, distrobox failures,
daemon.json edits, the rsync dance, the 22 GB containerd discovery, the
whole soup. No dramatization. Just the actual session, compressed.

Right side: live Workbench session. Same machine, same goal — clean
machine to submitted AIC entry. Five minutes for the smart steps; thirty
minutes including network waits.

A smaller, earlier demo lives alongside this one: **Log Intelligence
explaining a real AIC log file** (`psf logs --explain` on a saved
session). Raw chaos in, friendly status out. This demo can ship before
the full Workbench is done — Phase 2 deliverable, not Phase 4.

Punchline at the end of the bigger demo:

```
Same machine. Same goal. Same submitted entry.
Manual: 3 days.
Workbench: 27 minutes.
```

That single video is the product pitch.

---

## Part 12 — Why this works

Three reasons Workbench can do what others have failed at:

1. **The problem is correctly framed from the user's side.** Most platforms
   are built by people who like the tools. Workbench is being built because
   the tools are intolerable.

2. **The pattern has been validated in practice.** A previous PSF product
   demonstrated the same UX shape (paste a pointer, the platform handles
   the rest, single-click add/remove/reload). Workbench applies the same
   shape across the robotics software gauntlet. Not theoretical —
   calibrated.

3. **The discipline is written down.** Rules 1–8 above are explicit,
   enforceable in code review, and measurable. If we hold them, we don't
   become the next sprawling middleware. The hard part is saying no to
   scope creep — these rules are how we say no.

---

## Part 13 — Immediate next moves

**Today (2026-05-07):**
- Continue AIC submission work in `AIC-Submission/`.
- This document gets committed somewhere appropriate (likely a Workbench
  repo when one exists; for now it can live in the PSF parent dir as a
  design artifact).

**By 2026-05-15 19:59 UTC:**
- Valid AIC submission on the leaderboard.
- Ideally scoring above the top-30 cutoff (currently ~110).
- Lessons captured *as we go* in `AIC-Submission/notes/LOG.md` in real
  time, not retroactively.

**After 2026-05-15:**
- Phase 1 (Lessons File) starts the Monday after the deadline.
- This document becomes the source of truth for what we're building.
- Workbench-specific repo created. Core-Reflex either gets refactored or
  has its robotics-specific parts extracted into Workbench, depending on
  how the cleanup actually goes.

---

*Author: Aaron / Pseudo Science Fiction.
Design assistance: AI-assisted architecture exchange, May 2026.
Last updated: 2026-05-07. To be revised after the AIC qualification
submission and the Lessons File are complete.*
