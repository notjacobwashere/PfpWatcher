# Changelog

## v0.2.0-beta.4

- Add Save PFP to user right-click menus to archive the current global avatar once without changing automatic watching.
- Add independent toggles for Save PFP and Watch/Stop watching menu actions.
- Add watch/unwatch controls, including remembered aliases and immediate collection after a busy scan.
- Add optional in-app avatar-change notifications; the first tracked collection establishes a silent baseline.
- Add optional archive cleanup with a global picture limit from 1 to 100000, default 1000. Cleanup is off by default and permanently removes the oldest archive images and matching metadata when enabled.
- Recheck session, folder, and tracking status before queued saves. Disabling prevents queued saves and prevents cleanup/notifications after an active download finishes.
- Preserve beta 3 compact gallery, picture-count sorting, interval validation, duplicate-account handling, and toolbox actions.

Validation: desktop development build, TypeScript checking, and 11 functional tests passed. Discord Canary startup and a scan of 30 tracked accounts completed successfully. Live right-click interactions remain unverified in this session.
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
