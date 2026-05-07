<p align="center">
  <img src="ui/assets/logo.png" alt="PSF Workbench" width="200" />
</p>

<h1 align="center">PSF Workbench</h1>

<p align="center"><i>Robotics tooling, deployable.</i></p>

---

> Anything you'd have to set up by hand to use modern robotics tooling
> productively, Workbench sets up for you. The underlying software runs
> unchanged. The user's relationship with it changes.

PSF Workbench is a standalone robotics product whose job is to make
robotics tooling deployable and usable, so the end user can focus on
robotics instead of DevOps. Its first and deepest coverage is the
ROS 2 ecosystem (Gazebo, MoveIt, Nav2, ros2_control, vendor SDKs); the
architecture is designed to extend to MuJoCo, microcontroller endpoints
(ESP32, RP2040), and industrial protocols (PLC, Modbus, OPC-UA).

## Status — v0.1.1

What ships now:

| Component | Status |
|---|---|
| Architecture & design (`DESIGN.md`) | ✓ stable |
| `workbench` CLI | ✓ `run --mode play` dispatches via adapter |
| `intrinsic-aic` adapter pack | ✓ Play mode runs; Eval / Submit have documented manual fallbacks |
| Electron desktop UI | ✓ splash → chooser → onboarding wizard → operator view |
| **Behavior Deck editor** | ✓ compose policies as named cards with parameters |
| **Code editor (CodeMirror 6)** | ✓ in-app Python editor for `policy.py` with syntax highlighting, autocomplete, search, conflict-aware save |
| **Code generator** | ✓ deck.yaml → working `policy.py` derived from `aic_model.policy.Policy` |
| **Subprocess lifecycle** | ✓ clean SIGINT + `docker stop`, awaits real cleanup, sweeps orphan containers on startup |
| Policy ↔ live sim auto-launch | — v0.2 target |
| Eval mode managed by Workbench | — planned |
| Log Intelligence | — planned |
| Submission flow + fingerprints | — planned |
| Storage Manager | — planned |

The dev loop today: open the project in the Workbench desktop app,
compose a policy by adding behavior cards (Approach, Descend, Wiggle,
Spiral search, Back off, Insert), tweak parameters, click "Save &
Generate code". Workbench writes `deck.yaml` and `policy.py` into your
project. Click "Run Play mode" — Gazebo opens; the simulator is alive
without the AIC evaluator (no scoring pressure, no fixed trial schedule).

## Why this exists

The core thesis is in [`DESIGN.md`](DESIGN.md). In short:

Modern robotics is blocked less by raw capability than by integration
complexity. The capability has been there for years. The blocker is
the cost of going from "interesting tech" to "running on Tuesday
afternoon at Bob's Machine Shop in Cleveland." Workbench reduces that
cost by wrapping robotics tooling — never replacing it — so domain
experts can focus on the actual machine.

## Try it (very early)

### CLI only

```bash
# 1. Clone this repo somewhere.
git clone https://github.com/hfsc2004/workbench.git ~/Workbench

# 2. From a project directory containing workbench.project.yaml:
~/Workbench/workbench run --mode play
```

The project file declares which adapter the project uses and what
configuration it should pass through. See
[`adapters/intrinsic-aic/adapter.yaml`](adapters/intrinsic-aic/adapter.yaml)
for what configuration the AIC adapter understands.

### Desktop UI

```bash
# 1. Clone the repo (as above).
# 2. Bootstrap once (installs Node 20+, Electron, UI deps):
cd ~/Workbench
./RUN_ONCE.sh

# 3. Launch the desktop app:
./workbench-ui
```

`RUN_ONCE.sh` is idempotent — re-run it any time deps drift. It targets
Debian/Ubuntu hosts for now; macOS and Windows packaging come later.

## Design rules

The load-bearing rules from [`DESIGN.md`](DESIGN.md). Every PR is reviewed
against them.

1. **Wrap, never replace.** Workbench does not reimplement what
   existing robotics tooling already does well.
2. **Workbench owns the verbs the user actually presses.** Adapters
   provide the nouns.
3. **Emit, don't hide.** Generated artifacts land on disk in the
   user's project, readable and editable. No magical hidden state.
4. **Every run gets a fingerprint.** Reproducibility is the industrial
   trust layer.
5. **Logs become human status.** Workbench's log handling is a
   contextual interpreter, not a filter.
6. **Workbench owns storage layout.** When the user says "use the big
   drive," every tool's data root goes there. Migration is never silent.
7. **No telemetry by default.** Local-first means local-first.
8. **Secrets never leave the secrets store.** Never written to
   fingerprints, generated artifacts, logs, telemetry, or audit records.
9. **Engines never own actuation.** Every engine output passes through
   a deterministic safety gate.

## Repository layout

```
Workbench/
├── workbench                    the CLI (bash, v0.0.1)
├── workbench-ui                 generated launcher for the Electron app
├── RUN_ONCE.sh                  idempotent bootstrap (Node + Electron + UI deps)
├── DESIGN.md                    architecture, build order, success criteria
├── README.md                    this file
├── LICENSE                      Apache 2.0
├── adapters/
│   └── intrinsic-aic/           the AIC adapter pack
│       ├── adapter.yaml
│       └── play.sh
├── ui/                          Electron desktop app
│   ├── package.json
│   ├── main.js                  Electron main process
│   ├── preload.js               contextBridge surface
│   ├── renderer/                splash, chooser, onboarding pages
│   └── assets/
│       └── logo.png
└── mock.html / mock2.html / mock3.html
                                 design references — engineer view,
                                 operator view, onboarding flow
```

## License

Apache 2.0. See [`LICENSE`](LICENSE).

## Author

Pseudo Science Fiction.
