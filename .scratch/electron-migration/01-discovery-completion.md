# Ticket 01 discovery parity completion

Status: implemented and locally verified; live LAN/NAS acceptance remains open.

Integration tip `codex/electron-integration` at `76a9acb` was merged before final verification; the parallel library changes remain in the worktree.

## Scope

- Ported the existing bounded manual LAN discovery owner to `src/main/discovery.ts`.
- Preserved `GET /key/pub?signme=1`, port `5055`, private IPv4 filtering, host/concurrency/time limits, empty-result behavior, cancellation and stale-operation rejection.
- Kept the probe key and opaque `sign` in the main-process owner only. Discovery results exposed to the renderer contain only `ip`, display `name` and `available`; `sign` is never used as `nas_id`.
- Added additive discovery IPC channels, validated preload methods, typed shared DTOs and login-only scan/cancel/select controls. Selecting a result fills `http://<ip>:5055` and does not authenticate or submit credentials.
- No package or lockfile changes; library/player behavior was not rewritten.

## Evidence

Commands run from `D:\project\z-video\.worktrees\electron-01-discovery`:

```text
npm run typecheck                         PASS
npm test                                  PASS (26/26; external permission used for existing local HTTP fixtures/temp rename)
npm run test:window                       PASS (isolated Electron window; synthetic discovery result and address selection)
git diff --check                          PASS
```

After the integration merge, `npm run typecheck`, the focused six-test discovery owner run and `npm run test:window` were rerun and passed. The full 26-test run was already green before that merge; the merge only removed three unrelated library-side lines.

The discovery owner tests use injected synthetic network-interface/fetch fixtures. The window smoke handler returns a synthetic result and verifies that the login address becomes `http://192.168.5.2:5055`; no private LAN scan or real NAS request was issued during implementation or verification.

## Remaining limits

- A real Windows adapter/NAS run must still verify actual interface enumeration, firmware response variants, and login after selecting a discovered device.
- Live NAS acceptance, credential/session persistence and macOS behavior remain outside this ticket's local proof.
- The completion note records implementation evidence only; it does not claim full migration acceptance without the approved real-NAS evidence.
