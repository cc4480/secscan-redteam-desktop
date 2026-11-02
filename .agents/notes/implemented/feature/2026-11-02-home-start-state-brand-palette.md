# Agent Note: Home start state and the brand palette lock

Status: implemented

English | [中文](2026-11-02-home-start-state-brand-palette.zh.md)

## Problem

The chat shell opened on a compact centered hero that carried none of the product's identity, and the shell's dark scene used generic mesh hues (indigo, cyan, violet) that did not match the SecScan RedTeam mark. The product owner locked a composed home sample and directed that its colors and lighting — the logo's own — brand the whole chat window, home and chat alike.

## Decision

The hero phase of the main conversation occurrence is the home start state: the composer seat becomes the hero panel (mark at 96px, wordmark with the tail in diamond red, tagline, the resident composer, the favorites strip), and guide sections (Quick start, Most-used commands, Continue, and a side panel with At a glance / The fleet / Guide) compose around it in the scroll body's home grid. The composer seat's parent never changes, so starting a session does not remount the editor. Embedded occurrences keep the compact centered hero.

The brand palette is tokenized in the shell sheet (`--brand-red` `#CF2B4D`, `--brand-blue` `#38BDF8`, `--brand-ink` `#0B1120`, verbatim from `apps/desktop/resources/icon.svg`), the frame's dark backdrop is the sample's lit scene (white pool top-left, red pool upper-right, blue pool lower-left, warm pool lower-right over the deep zinc base), the dark glass fills and blur move to the sample's locked values (`0.04`/`0.055`/`0.07`, `blur(14px) saturate(140%)`), and inside the conversation root the send action and business-primary accents ride the crosshair blue. The same three hexes already style the HTML report, so home, chat, and report carry one brand system.

Every command on the home surface is real: composer commands run through the session's public input actions exactly as if typed (argument-free commands submit; argument-taking commands insert and focus), runner-protocol commands insert as ordinary message text, and Continue lists real recent sessions. Favorites are a small pinned-commands source in `ui-conversation`, persisted per profile in localStorage, defaulting to New session, `/scan`, `/status`, `/report`, `/model`, and delivered to the factory through the inject hooks compartment.

The glass token sheet also gains the two fallback blocks the sample could not express: opaque fills under `@supports not (backdrop-filter: …)` and a forced-colors mapping; `prefers-reduced-transparency` was already covered by the existing token collapse.

## Alternatives considered

**A separate home page or gate screen.** Rejected by the product direction: home is the chat shell's start state, and the composer on it starts a session immediately.

**Declaring the pinned store on the conversation factory registration.** The factory declaration has no store seat today; the inject hooks compartment is the established channel for a registrant-private reactive fact (the composer-block source is the precedent), so the pins ride it instead of widening the factory contract.

**Rebinding the info-blue tokens globally in the theme sheet.** The rebind is scoped to the conversation root: the lock names the chat window, and other surfaces keep the theme's own values.

## Consequences

The desktop app opens on the branded home in both the packaged and local builds, and the regular chat surfaces sit on the same lit brand scene. The generic hero headline and preview badge remain only in the compact embedded hero. Snapshot goldens that pin the old hero and the old backdrop need a refresh with this change; the refresh is intentional output change, recorded in the landing report.
