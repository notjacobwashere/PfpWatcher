# Changelog

## v0.2.0-beta.2

- Save tracked users' global avatars when Chromium loads them or Discord receives a user update; DevTools can stay closed.
- Add a live-collection toggle in Vencord settings, enabled by default.
- Add a configurable automatic-check interval from 1 to 1440 minutes, defaulting to 30.
- Preserve existing tracking lists, folders, automatic-check preferences, and archive deduplication.
- Disconnect observation and cancel queued collection when disabled.

Requires a custom desktop Vencord build. Live observation only detects avatars Discord receives while running. Tested against Vencord d07030c0968e31e41caa0c35fda0ef8ae63a079e; build and TypeScript checks plus 11 automated checks passed. Live collection was also observed successfully in Discord Canary.
