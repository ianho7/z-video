# ADR 0004: account-free local library as the current default

Status: accepted 2026-10-31

## Decision

The current Windows default launches directly into an application-owned local media library. A user may choose a folder or one video file without a NAS account, login restoration, ZSpace SDK, NAS HTTP API, online metadata provider, or separate database installation. Media, NFO, and artwork are read-only inputs; index and local viewing state live under the application's userData.

Ticket 01 owns the first vertical slice: Electron 45 utilityProcess capability gate for bundled `node:sqlite`, the SQLite schema, opaque local file IDs, folder/file picker IPC, and one-movie import. Ticket 02 owns metadata and incremental scan; ticket 03 owns local playback and resume. The shared schema and IPC contracts are kept in `docs/local-library/contracts.md` and `src/shared/local-library-contracts.ts`.

## Boundaries

- The utility process is the sole SQLite owner. Renderer never opens the DB or receives absolute/source-relative paths.
- Public media identity is `media_<UUID>`. Main may resolve it for playback only after validating the ID and DB ownership.
- A changed root-relative path, size, or mtime creates a replacement identity; old playback state is not silently inherited.
- Startup fails with a storage error if the pinned Electron utility process cannot provide `node:sqlite`; no native SQLite addon is added implicitly.
- The old NAS-first scope in ADR 0002 and its implementation remain rollback/reference material. This decision does not delete old code, sessions, credentials, Rust/Cargo tooling, or NAS evidence.

## Consequences

The app is useful offline and has no credential surface on the default path. It must implement scanning, metadata normalization, local artwork handling, and local playback persistence itself. Real personal/share access, NFO compatibility, native playback, macOS behavior, and package acceptance remain separate evidence boundaries; synthetic fixtures do not prove them.
