# Changelog

## v0.2.0-beta.3

- Reduce gallery tiles to 130px and show 24 pictures per page.
- Sort the user picker by saved picture count, highest first, with alphabetical ties.
- Fix valid interval values being rejected when Vencord validates text input.
- Check each account once per scan even when duplicate IDs or username aliases are listed.
- Add a PfpWatcher submenu to Vencord Toolbox with Rescan tracked users and Open gallery.

Build, TypeScript, and 13 automated checks passed. Plugin startup was verified in Discord Canary.
## v0.2.0-beta.2

- Save tracked users' global avatars when Chromium loads them or Discord receives a user update; DevTools can stay closed.
- Add a live-collection toggle in Vencord settings, enabled by default.
- Add a configurable automatic-check interval from 1 to 1440 minutes, defaulting to 30.
- Preserve existing tracking lists, folders, automatic-check preferences, and archive deduplication.
- Disconnect observation and cancel queued collection when disabled.

Requires a custom desktop Vencord build. Live observation only detects avatars Discord receives while running. Tested against Vencord d07030c0968e31e41caa0c35fda0ef8ae63a079e; build and TypeScript checks plus 11 automated checks passed. Live collection was also observed successfully in Discord Canary.

