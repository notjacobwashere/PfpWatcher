# PfpWatcher for Vencord desktop

Collect selected users' global profile pictures at Discord startup, check at a configurable interval or when Discord loads an avatar, and browse your local collection.

**Prerelease: v0.2.0-beta.4.** Requires a custom desktop Vencord build. This is a source plugin, not a BetterDiscord `.plugin.js` file or an official Vencord plugin.

## Install or upgrade

1. Get a [Vencord source checkout](https://docs.vencord.dev/installing/).
2. Copy the entire `pfpWatcher.desktop` folder into `Vencord/src/userplugins/` (create `userplugins` if necessary). For upgrades, replace the old plugin folder with the new one. Copy all six files, including `Gallery.tsx`, `bridge.ts`, `gallery.css`, and `watch.ts`.
3. In the Vencord checkout run `pnpm install --frozen-lockfile`, `pnpm build --dev`, then `pnpm inject`. Restart Discord.
4. Enable **PfpWatcher** under Settings → Vencord → Plugins and open its settings.
5. Enter comma-separated Discord usernames or user IDs in **users**. Enter an absolute destination path in **folder**, or leave it blank for your operating system's Documents/pfp folder. Save your settings.
6. Click **Check now** to save the first avatars and see any errors. **Open pfp folder** opens the destination.

Upgrading keeps the existing settings and pfp folder. This requires desktop Vencord or a compatible desktop build with native plugin helpers; the browser extension cannot write folders.

## Gallery menu

Open Settings → Vencord → Plugins → PfpWatcher → **Browse collected pfps**.

- **User** lists only accounts with saved pictures, with usernames, IDs, and picture counts. Accounts are sorted by saved-picture count, highest first (alphabetically for ties). Choose an account to see its collection, or choose All users.
- **Sort by** offers newest collected, oldest collected, animated first, static first, and filename A–Z. Type sorts use newest collection time within each group.
- Each picture shows its PNG/GIF type and collection date and time in your local timezone. Animated GIFs play in the gallery. **Show in folder** selects that exact saved file in your operating system's file manager.
- Collections have 24 pictures per page. Use Previous/Next to browse all pictures, and Refresh after collecting new pictures or changing files outside the plugin.
- The gallery reads local images; it does not download pictures again. It displays saved files even if you remove their users from the tracking list.

New collections save usernames and original collection timestamps in JSON sidecars under `<pfp folder>/.pfp-watcher/`. Keep this hidden folder when moving or backing up your collection. Duplicate checks preserve the original collection time, even after a username changes.

Files collected with the first plugin version still appear. Their original exact collection time was not recorded, so the gallery uses the file's modification time and marks it **estimated from file**. Old users may appear by ID until Discord knows their username or a successful check records it. Unrelated files, renamed files, symlinks, and empty images are not included.

## Automatic checks

Enable **Automatic checks** in the plugin settings and set **Check interval (minutes)** to a whole number from 1 to 1440 (default 30). The first scheduled check runs after that interval, then repeats while Discord is running and logged in. Changing the interval restarts the timer. Startup checks still happen. Manual and scheduled checks share one queue, so overlapping triggers do not download pictures twice.

Turning the option off clears the timer immediately. Disabling the plugin stops future checks. An image download already in progress may finish. No checks run while Discord is closed; sleep or suspension can delay timers.

## Collection behavior

- Checks once after login on each launch/reload and when enabled. Reconnecting during that session does not repeat the startup check. Use Check now to retry failures.
- Usernames must be exact account usernames, not display names. Username lookup uses users already known to Discord. If lookup fails, open the user's profile and try again, or enable Discord Developer Mode and use Copy User ID. There is no unrestricted username-search endpoint.
- Resolved usernames stay linked to the same account ID after renames. To deliberately follow a different account under a reused username, enter its ID.
- Fetches fresh account data through Discord's authenticated client API, checks users sequentially with a one-second pause, and continues after individual failures. Automatic results/errors appear in Vencord's console; Check now also shows them in settings.
- Static avatars use PNG, animated avatars use GIF, requesting Discord's maximum 4096px resolution without lossy conversion. Source images may be smaller. Server-specific and default Discord avatars are excluded.
- Saves files as `<userID>_<avatarHash>.png` or `.gif`. An existing nonempty image at that name is skipped, including avatars a user switches back to. Keep these filenames for deduplication. Arbitrarily renamed or externally downloaded pictures are not compared by image contents.
- Writes downloads to a temporary file and publishes only complete images. A failed download does not leave a completed image file. If collection metadata cannot be written, the error is reported and the saved image can still be browsed using its estimated file timestamp.
- Tracking entries and remembered account identities stay in local Vencord storage. Collection sidecars store usernames and timestamps locally; nothing is uploaded to a third-party service. Removing a tracked entry leaves saved pictures intact.
- The first check saves the current avatar. Historical avatars and changes between checks cannot be recovered. The gallery reads only the currently configured folder.

## Official Vencord listing

The Vencord website lists plugins accepted into its official project. A GitHub prerelease of this custom plugin does not add it to that website.

Upstream submission requires human review under [Vencord's contribution policy](https://github.com/Vendicated/Vencord/blob/main/CONTRIBUTING.md#ai-policy), disclosure of AI assistance, a real Discord author ID in place of the current `0n` placeholder, and acceptance by Vencord's maintainers. This plugin was implemented with OpenAI Codex. No upstream submission or official acceptance is claimed.

License: [GPL-3.0-or-later](LICENSE).

## Live avatar collection

Automatic checks now use Check interval (minutes), a whole number from 1 to 1440, default 30. The existing automatic-check toggle is retained. Changing the interval restarts the timer.

Save avatars when Discord loads them is enabled by default. Chromium resource events and Discord USER_UPDATE events trigger collection only for tracked users. DevTools may remain closed. Only global avatars are supported; changes never received by the running client cannot be observed. Existing archives are deduplicated. Scheduled checks remain useful when Discord does not load an avatar. Disabling the option or plugin disconnects the resource observer and cancels queued work; an active download may finish.



## Compatible Vencord build

The launch fix uses Vencord revision d07030c0968e31e41caa0c35fda0ef8ae63a079e. In your Vencord checkout, run `git checkout d07030c0968e31e41caa0c35fda0ef8ae63a079e` before installing dependencies and building. An older Vencord checkout caused the black startup window; rebuilding at this revision restored launch. Discord Canary launch was verified. Future Discord changes may require newer Vencord source.


## Beta 3 changes

The gallery uses smaller 130px tiles and 24 pictures per page. The user picker ranks accounts by picture count, most first. Numeric settings accept Vencord’s text input correctly, including an interval of 10 minutes. Repeated IDs and username aliases resolving to one account are checked once per scan. Existing image filenames still prevent duplicate saved files.

Open the top-right Vencord Toolbox button, then PfpWatcher, for Rescan tracked users and Open gallery. VencordToolbox is a required dependency. Rescan reports progress and results using Discord toasts.


### Optional convenience settings

- **Show watch menu** (on by default): right-click a user to watch or stop watching them. Adding a user saves their ID and checks the tracked list immediately.
- **Show Save PFP menu** (on by default): right-click a user → **Save PFP** to fetch and archive their current global avatar once, including username and collection time. This does not add the user to the watched list or change existing watching. Saved pictures appear in the gallery and follow the same deduplication and optional cleanup rules. Default Discord avatars are excluded. This toggle is independent of the watch menu.
- **Notify avatar changes** (off by default): an in-app toast when a tracked user's avatar differs from the last observed avatar. The first collection establishes a baseline without notifying. Discord must be open and receive the change, or a check must detect it. No operating-system notification is sent.
- **Automatic cleanup** (off by default): after a new image is saved, permanently delete the oldest archive images above **Maximum saved avatars** (default 1000, range 1–100000). The limit covers all users in the selected archive folder. Matching metadata is removed too; unrelated files are preserved. Changing the limit takes effect on the next new save.

These settings add no extra installation steps. Automatic cleanup and change notifications are off by default.

## Beta 4 validation

Desktop development build and TypeScript checking pass against Vencord revision d07030c0968e31e41caa0c35fda0ef8ae63a079e. Eleven functional tests cover manual Save PFP, watch/unwatch controls, duplicate IDs and aliases, timer validation and changes, live collection, notifications, disabled-session cancellation, and native archive cleanup using disposable test files. Discord Canary startup and a complete scan of 30 tracked accounts were verified after installation. Live right-click menu interactions were not manually exercised in this session.

Adding a watched user during an existing scan now waits for that scan before checking the updated list. Remembered aliases use the correct Watch/Stop watching label. Queued saves recheck the active session, destination folder, and tracking status; disabling the plugin prevents queued work and prevents cleanup or change notifications after an in-progress download finishes.

Release downloads contain plugin source, README, changelog, and license. Tests and development files are excluded.
