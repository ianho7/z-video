# Local playback and durable resume

ID: 03-playback
Depends: 01

Scope / acceptance: Resolve indexed mediaId in main; reuse libmpv; save local position/track preferences/watched state via DB owner, restore across fresh processes; failed native load preserves prior position. No NAS/API/session writes. Own player-host/player/native integration, avoid metadata renderer edits.

Read ../spec.md and ../execution.md. Use TDD at approved seams and test-audit. Record failing-before/passing-after evidence where meaningful, commands/results/limits, merge latest integration and commit completion note under docs/local-library/completions/. No push/PR/issue closure by implementers.
