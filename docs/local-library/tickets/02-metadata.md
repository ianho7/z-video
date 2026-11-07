# Metadata and incremental import

ID: 02-metadata
Depends: 01

Scope / acceptance: Read NFO/artwork, movie/show/episode mapping, bounded cancellable incremental scan. Missing/bad metadata keeps playable entries; interrupted/offline sources preserve index/history; no video hashing/probing; selected root boundaries. Coordinate schema with01 and playback03. Lock exact maintained XML parser only after dependency review.

Read ../spec.md and ../execution.md. Use TDD at approved seams and test-audit. Record failing-before/passing-after evidence where meaningful, commands/results/limits, merge latest integration and commit completion note under docs/local-library/completions/. No push/PR/issue closure by implementers.
