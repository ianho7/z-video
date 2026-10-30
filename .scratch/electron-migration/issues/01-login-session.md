# 01: Electron login and Session recovery

**What to build:** Launch the replacement window, enter NAS credentials/MFA, securely restore a Session after restart, and display real classifications. Establish the shared application, preload and playback contracts needed by parallel slices.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Electron/TypeScript build and launch with a single window, isolated renderer and narrow validated IPC; no Rust build dependency.
- [ ] NAS login/MFA and classification requests preserve current encoding and error behavior; token, nas_id and nas_sign stay distinct and helper-state completes NAS identity.
- [ ] Secure persistence supports fresh-process recovery; unauthorized responses invalidate the saved Session. Secrets never appear in diagnostics or renderer data unnecessarily.
- [ ] Existing manual LAN discovery, cancellation and NAS selection remain available; discovery uses the confirmed probe contract and does not substitute a public-key sign for device identity.
- [ ] Shared typed Collection/Episode, navigation and native playback command/event contracts allow tickets 02 and 03 to implement independently. Document ownership and exact commands.
- [ ] TDD at NAS public boundary covers independent request contracts and failure shapes; current build/type check passes. Record real-window/live-NAS evidence separately and truthfully.

Context: approved migration spec and ADR 0003; current NAS/auth/session/credentials owners, glossary and protocol ledger. Keep the approved dark shell and original implementation available. Normal playback progress writes only; no other NAS writes.
