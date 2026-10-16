# z-video Glossary

This glossary defines the product language. It intentionally contains no implementation decisions.

## NAS

The user's private storage service that owns media, accounts, permissions, and media-related operations.

## Account

The identity used to access a NAS. An account has permissions and may have more than one active session.

## Session

A temporary authenticated relationship between the application, an account, and a NAS. A session is not the account itself and may expire or be revoked.

## Media library

The organized set of media collections and playable episodes visible to an account.

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
