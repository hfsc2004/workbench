# PSF Workbench

> Anything you'd have to set up by hand to use modern robotics tooling
> productively, Workbench sets up for you. The underlying software runs
> unchanged. The user's relationship with it changes.

PSF Workbench is a standalone robotics product whose job is to make
robotics tooling deployable and usable, so the end user can focus on
robotics instead of DevOps. Its first and deepest coverage is the
ROS 2 ecosystem (Gazebo, MoveIt, Nav2, ros2_control, vendor SDKs); the
architecture is designed to extend to MuJoCo, microcontroller endpoints
(ESP32, RP2040), and industrial protocols (PLC, Modbus, OPC-UA).

## Status

**v0.0.1 — early development.** The architecture is settled; very little
of it is implemented yet. The repo currently contains:

- [`DESIGN.md`](DESIGN.md) — full architectural design and roadmap.
- `psf-workbench` — the platform CLI. One verb implemented so far
  (`run --mode play`).
- `adapters/intrinsic-aic/` — the first adapter pack, for the
  Intrinsic AI for Industry Challenge.
- `mock.html`, `mock2.html`, `mock3.html` — UI mocks for the
  engineer view, operator view, and onboarding flow.

The CLI dispatches a verb against an adapter's mode-specific entry
point. Today that means: from a Workbench project directory (one with
a `psf.project.yaml`), running `psf-workbench run --mode play` brings
up an AIC simulator with no evaluator running, so a user can iterate
on a policy interactively.

Eval mode and Submit mode are not yet managed by Workbench; the
adapter manifest documents the manual fallback for now.

## Why this exists

The core thesis is in [`DESIGN.md`](DESIGN.md), but in short:

Modern robotics is blocked less by raw capability than by integration
complexity. The capability has been there for years. The blocker is
the cost of going from "interesting tech" to "running on Tuesday
afternoon at Bob's Machine Shop in Cleveland." Workbench reduces that
cost by wrapping robotics tooling — never replacing it — so domain
experts can focus on the actual machine.

## Try it (very early)

```bash
# 1. Clone this repo somewhere.
git clone https://github.com/hfsc2004/workbench.git ~/PSF_Workbench

# 2. From a project directory containing psf.project.yaml:
~/PSF_Workbench/psf-workbench run --mode play
```

The project file declares which adapter the project uses and what
configuration it should pass through. See `adapters/intrinsic-aic/adapter.yaml`
for what configuration the AIC adapter understands.

## Design rules (the load-bearing ones)

From [`DESIGN.md`](DESIGN.md):

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
   drive," every tool's data root goes there.
7. **No telemetry by default.** Local-first means local-first.
8. **Secrets never leave the secrets store.** Never written to
   fingerprints, generated artifacts, logs, telemetry, or audit records.
9. **Engines never own actuation.** Every engine output passes through
   a deterministic safety gate.

## License

Apache 2.0. See [`LICENSE`](LICENSE).

## Author

Aaron / Pseudo Science Fiction.

Design assistance: AI-assisted architecture exchange, May 2026.
