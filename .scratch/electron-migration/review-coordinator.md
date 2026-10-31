# Coordinator findings after independent review

Reviewed code snapshot: `deae61a`. These supplement, rather than merge or rerank, the independent Standards and Spec reports.

## Required scoped repairs

- **P1: Password bytes are changed by IPC.** `src/main/ipc.ts` passes `record.password` through `parseRequiredString`, which returns `.trim()`. Baseline `src/app.rs:3637,3747` and the production Rust NAS owner preserve the entered password. Preserve exact password characters while validating the input type; add one public-boundary regression for leading/trailing whitespace. Do not log any password.
- **P1: Resume position can belong to another Episode.** `src/renderer/library.ts:355-365` sends the current selected Episode ID with `activeDetail.resume.positionSec` without matching the history Episode. `src/main/player-host.ts` fetches fresh matching history but does not return its position; `PlaybackCoordinator.openNas` instead trusts the renderer position. Selecting B after history for A must not apply A's position to B. Keep current UI selection/continue-watching identity explicit and make main use only matching current NAS history for resume.
- **P2: Package readiness proof is too weak.** `scripts/verify-windows-package.mjs` treats a process surviving three seconds as launch proof. An Electron exception dialog also survives; the reported EPIPE dialogs demonstrate that process liveness is not app readiness. Observe actual production window/renderer readiness with an isolated test profile (existing diagnostics or a bounded standard debug interface), retain native package probe, and do not add a production test-only flag or require private credentials.
- **P2: Developer rules retain contradictory active-stack instructions.** Current `AGENTS.md` still unconditionally prescribes a single process, Rust keyring features, Cargo protocol gates and `target/debug/z-video.exe` despite the new Electron default. Qualify these as legacy-only or replace the relevant current commands, while preserving the actual protocol/privacy/verification requirements.

## Authenticated image redirect proof

A Node-only two-localhost-server probe on 2026-10-31 sent a synthetic custom `token` and Cookie to origin A, which redirected to origin B. Node fetch forwarded `token` but removed Cookie (`tokenForwarded=true`, `cookieForwarded=false`). Therefore the Standards image-secret repair must cover redirects as well as initially absolute external URLs. Never forward NAS secrets to a different origin; use a public HTTP owner regression with synthetic values. No private NAS or actual credentials were accessed.

## Failed-load progress proof

A Node-only probe against the existing public `PlaybackCoordinator` on 2026-10-31 supplied an external engine that emitted a synthetic load error during `start`, without ever emitting ready or position. Opening a synthetic NAS Episode and then closing reported `positionSec=0` once. No HTTP request or actual NAS write was performed. A failed media load must not overwrite existing NAS history: allow progress persistence only after valid playback observation, and stop reporting on fatal load failure. Cover this at the existing coordinator seam without adding a new lifecycle framework.

## Repair discipline

One implementer handles these and all actionable independent findings. Preserve existing implementation/evidence; use TDD at the already approved owning seams. Keep external NAS/hardware/DWM/overlay/license acceptance gaps distinct from source defects. Do not add speculative frameworks or global exception swallowing. Automatic GUI tests must use isolated profiles, bounded owned-child lifetimes and regular log files so failures cannot reopen the EPIPE popup loop.
