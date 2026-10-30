# 04: NAS playback, progress and restart resume

**What to build:** Select an actual Episode from Collection details, obtain a current NAS stream, play it in the embedded player, save viewing progress and resume the same Episode after closing and reopening the application.

**Blocked by:** 02: Browse the Media library and select an Episode; 03: Embedded native playback and controls.

**Status:** blocked

- [ ] NAS-returned streams connect to the production native playback path, with required authentication handled without logging secrets/addresses.
- [ ] Episode selection and optional history restore position/track state; old loads/events/seek callbacks cannot alter another Playback session.
- [ ] Progress requests preserve current protocol and associate correct Account/Collection/Episode; failure is visible and does not fabricate a saved receipt.
- [ ] NAS history read-back and a fresh-process restart demonstrate resume; UI continue-watching state reflects available real evidence.
- [ ] Local request contracts cover error and stale-session boundaries. Actual NAS playback/persistence remains pending until observed; record evidence without credentials or private paths.

Context: migration spec, completed 02/03 commits, protocol ledger/current playback/progress owners. Authorized business write is viewing progress; no deletion, restoration or metadata mutation. User enters credentials locally.
