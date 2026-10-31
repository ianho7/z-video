# Electron migration — Standards review

Fixed point: `1c0ab0b865abe80a47796f1de278374d85754b78...deae61a3d8da3fa72b81e5672ecb1a91234066c9`.
Scope: changed Electron code and its owner-boundary documents. No tests, GUI, NAS, credentials, or installs were used.

## Actionable documented-standard violations

- **P1 — Private media URI can cross the renderer.** `src/main/nas-client.ts:297,305-307` uses `file_path` (and even `url`) as the fallback `episodeId`; `src/main/library-controller.ts:122-129` copies it into the renderer DTO, which `src/renderer/library.ts:332-334,361-365` places in DOM/IPC. This contradicts `docs/electron-migration-contracts.md:32-33,67-73` and `AGENTS.md:5,59` (renderer-safe `episodeId`; no private paths or raw media URI). Require a non-path opaque ID; reject/keep path-only episodes main-side.

- **P1 — Image fetch can send session credentials to an arbitrary host.** `src/main/nas-client.ts:268-269` accepts absolute `cover_url`/`background_url`; `:663-676` fetches that URL with `token` and a Cookie containing NAS identity/sign. This violates the NAS/main secret boundary in `docs/electron-migration-contracts.md:13-19,67-73`. Enforce the session origin (or an explicit trusted CDN allowlist) before attaching auth headers.

- **P2 — Diagnostics are not truthful/complete for business failures.** `src/main/nas-client.ts:838-849` records every HTTP-200 JSON response as successful parse before callers reject failed business codes (`:659-660,709-710,730-731`), so failures can be logged as success; `src/main/diagnostics.ts:43-71` has no UI-operation event path. This misses `AGENTS.md:48`'s required HTTP/parse/business/error coverage and UI operations. Log business outcome in the owner helper and add the required UI events.

- **P2 — Unbounded server counts can freeze the renderer.** `src/main/nas-client.ts:716` trusts `count`; `src/main/library-controller.ts:430-445` derives uncapped `totalPages`; `src/renderer/library.ts:164-190` creates one button per page synchronously. A malformed/huge count can block the UI, contrary to `AGENTS.md:23`. Cap/validate counts and use windowed pagination.

## Baseline smell (judgment call)

`src/main/nas-client.ts` combines auth, MFA, library, image, stream, and progress protocol work, with repeated response/business checks. This resembles **Divergent Change / Duplicated Code**, but the repository explicitly makes this file the centralized NAS owner (`docs/electron-migration-contracts.md:11-16`); no refactor is recommended from the smell alone.

## External acceptance limits, not code findings

The handoff still correctly marks real NAS login/stream/progress read-back, hardware decoding, DWM pixels, mixed-DPI, macOS, and public redistribution licensing as unverified. Local fixtures/package/window evidence does not close those boundaries.
