# Local-library review fixes completion

Date: 2026-10-31
Branch: `codex/local-review-fixes`
Integration baseline: `0be8526`
Scope: actionable findings in `review-standards.md` and `review-spec.md`; no native/package/NAS rerun was added.

## Finding mapping

| Finding | Minimal owner-boundary fix | Proof / remaining limit |
|---|---|---|
| Standards 1 / Spec 3: lexical root boundary and reparse replacement | Worker canonicalizes selected roots and candidates with `realpath`, rejects unsafe final links, checks every traversal directory/file and skips links that leave the canonical root. Playback and artwork resolution return no path after a previously indexed entry is replaced by an unsafe link. | The final supported Windows owner smoke used an owned real directory junction replacement and printed `PASS: real Windows junction replacement stayed outside local playback/artwork resolution`; receipt: `.scratch/local-library/reparse-proof-latest.json` (`real-directory-junction-replacement`, both resolutions false). No mock path string was treated as a reparse proof. Hosts without junction permission still record an explicit skip. |
| Standards 2: source label privacy | `safeSourceLabel` never falls back to a root path; drive roots use a fixed `C drive`-style label and existing persisted labels are repaired/sanitized before state projection. | `local-library-contract.test.ts` covers drive root, UNC share basename, and ordinary folder labels. A real private/share root was not opened. |
| Standards 3: error privacy | Worker, database, and local-library IPC map filesystem/SQLite/worker errors to stable code messages. Only short deliberate validation messages may cross the renderer boundary. | `local-library-contract.test.ts` checks path-bearing storage/unknown candidates are reduced. No private DB/source path was included in fixtures or logs. |
| Standards 4: concurrent 512 MiB artwork cap | Disk writes and eviction share a serialized mutation queue; byte accounting changes only after successful writes/deletes, and failed deletes do not reduce the counter. | `local-artwork-cache.test.ts` runs eight concurrent misses against a 100-byte cap and checks actual directory bytes. The 512 MiB default itself is unchanged. |
| Spec 1: Add-folder first-file import | The Add-folder IPC handler now starts `scanFolder`; renderer routes the button through the visible progress/cancel scan flow. The legacy first-file owner method remains only for existing foundation callers. | `window-smoke.ts` drives the real renderer button against a scan-result IPC seam; `npm run test:window` PASS (`.scratch/electron-migration/runs/05-window-1793454155572-16708/window.log`). |
| Spec 2: file import nested source | Worker finds the most specific existing ancestor source and reuses it; otherwise it rejects a requested root overlapping an existing source before creating one. | `local-library-database-smoke.ts` imports a file below an indexed root without increasing source count and rejects a sibling import whose requested parent contains an indexed source. |
| Spec 4: mid-scan disconnect availability | Any traversal failure leaves indexed rows/history intact, marks the source unavailable, and returns `partial`; a later successful scan can restore availability. | `local-library-database-smoke.ts` removes an owned nested directory after the first progress event and checks `partial` plus unavailable source state. |

## Focused evidence

| Command | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `node --test dist/tests/local-library-contract.test.js` | PASS: 4 tests |
| `npm run test:local-artwork-cache` | PASS: 2 tests |
| `npm run test:local-library` | PASS under supported Windows Electron/utility-process permissions; owned DB, overlap, nested-import, disconnect (`partial` + unavailable source), and real junction replacement completed. Log: `.scratch/local-library/db-1793454756812-11812/electron.log`; it contains both the junction PASS and final owner PASS. |
| `npm run test:window` | PASS under supported Windows GUI permissions; the Add-folder button reached the completed scan status through the real renderer/preload IPC window |
| `npm run test:local-library-app` | PASS under supported Windows GUI permissions; fresh production profile remained account-free and path-free |
| `git diff --check` | PASS |

`npm test` was attempted once. Its failures are the pre-existing legacy NAS/network fixture and sandboxed safe-storage owners (`fetch failed`, expected NAS protocol responses unavailable, and Windows secure-store `EPERM`); no local-library assertion failed in that run. The failures do not block this bounded local-library change and were not broadened into unrelated fixes.

## Limits

- The real junction proof is Windows-permission dependent. If the host cannot create a junction, the owned smoke records a skip and this completion note must not be read as a real reparse acceptance.
- No personal directory, UNC share, NAS, native fresh-process playback, package rebuild, or 20k-scale rerun was performed; those existing proofs were not affected by these owner changes.
- The final Windows GUI command uses the repository's bounded child and regular-file log conventions; no long-lived Electron process is left running.
