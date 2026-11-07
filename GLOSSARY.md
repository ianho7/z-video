# z-video Glossary

This glossary defines the product language. The local-library terms below are current product language; NAS terms remain for the rollback/protocol reference and future optional integration.

## Local library

The index owned by this application for media roots the user selected. It is usable without an account or NAS session and stores its index and viewing state under application userData.

## Source

A user-selected local directory or OS-readable share root. The source record owns availability and an opaque source ID; the renderer receives only a safe label and item count, never the root path.

## Media file

One playable local file discovered under a Source. A media file has a persistent opaque `mediaId`; its absolute and source-relative paths remain main/utility-process data.

## Opaque media ID

A persistent `media_<UUID>` handle used by renderer/main contracts. It is not a path, URL, NAS identifier, or provider ID. Only the main/local database owner may resolve it to a file path.

## Local library database

The SQLite database in application userData containing sources, collections, media files, artwork keys, playback state, and scan runs. One utility process owns its connection; renderer never opens it.

## Local playback state

Application-owned position, duration, watched flag, selected track IDs, and update time keyed by local `mediaId`. It is not NAS history and is never written to media/NFO files.

## NAS

The user's private storage service that owns media, accounts, permissions, and media-related operations.

## Account

The identity used to access a NAS. An account has permissions and may have more than one active session.

## Session

A temporary authenticated relationship between the application, an account, and a NAS. A session is not the account itself and may expire or be revoked.

## Media library (generic)

The organized set of media collections and playable episodes visible to an account or indexed by the local library, depending on the active product data source.

## Collection

A title-level media object that groups one or more episodes and carries shared metadata such as title, artwork, and classification.

## Episode

A single playable unit belonging to a collection. A feature film normally has one episode; a series normally has several.

## Playback session

One attempt to play an episode, from opening it until it is stopped or closed. It includes playback position and selected audio or subtitle tracks.

## Playback backend

A component that turns a server-provided media address into playback and reports state such as readiness, position, buffering, and failure.

## Scraper plugin

An optional extension that identifies media and returns metadata, artwork, or subtitle references from an external source. It is not the authority for account access or playback.

## Plugin capability

An explicitly granted ability available to a plugin, such as network access, filesystem access, or access to a session. A plugin has no capability merely because it is installed.

## Normalized metadata

A common metadata shape used by the application regardless of which scraper or source produced it. Source-specific fields remain optional extensions.
