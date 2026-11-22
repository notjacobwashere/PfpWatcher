# Windows installer

Download **PfpWatcher-Setup-v0.2.0-beta.6.exe** from the beta 6 GitHub release and run it. It is a portable installer for an existing desktop Vencord installation on Windows 10/11 with .NET Framework 4.8. No administrator access or manual Node.js/pnpm setup is needed.

1. The installer detects the Vencord build used by running Discord clients, falling back to the standard `%APPDATA%\Vencord\dist` folder. Browse can select another existing Vencord build folder.
2. Click **Install and restart Discord**.
3. It closes Discord clients using the selected build, creates a backup, installs the bundled build, and enables PfpWatcher plus VencordToolbox while preserving existing settings.
4. It restarts only clients that were previously running and using that build. Closed clients stay closed; unrelated or unpatched clients are not targeted.

The installer supplies a full Vencord build with official plugins and PfpWatcher. Other custom plugins are not bundled. If enabled plugins are absent from this build, the installer identifies them and lets you cancel. Settings and archived pictures are preserved; no PFP collection folder is modified by the installer.

Stable Discord, Canary, PTB, and Development are recognized when their existing Vencord injection points at the selected build. This installer does not patch a vanilla Discord installation; install Vencord first if it is absent. Browser extensions, Vesktop-specific layouts, and other operating systems require their respective manual setup.

## Backups and recovery

Backups are stored under `%APPDATA%\Vencord\PfpWatcher-backups\<timestamp-id>`, or under the directory set by `VENCORD_USER_DATA_DIR`. Each backup contains the previous build, the original settings when present, a target manifest, and an installation log.

Payload file hashes are verified before installation. Build files and settings are replaced atomically. If installation fails, the installer restores files it changed and reports any restoration failures. Previously running Discord clients are then restarted. An unsuccessful restart is reported so the user can reopen Discord manually.

For a later manual rollback, fully close Discord, copy the backup's `dist` contents to the build path recorded in `backup-info.json`, restore its `settings.json` to the recorded settings path if desired, and reopen Discord. Do not restore an old settings file if you want to retain newer preference changes. Backups are not automatically removed.

The bundle is based on Vencord `d07030c0968e31e41caa0c35fda0ef8ae63a079e`. Future Discord changes may require a newer Vencord build. Normal Vencord update preferences are unchanged; an upstream update may replace this custom build, in which case rerun a compatible PfpWatcher installer or rebuild from source.

## Build the installer

The installer is written in C# and targets the Windows .NET Framework compiler. It embeds the Vencord distribution and verifies its SHA-256 manifest. Source code and the GPL license are available in this repository; the release also includes the corresponding Vencord build source without dependencies or compiled outputs.

With a Vencord checkout at the revision above and `pfpWatcher.desktop` installed in `src/userplugins`:

```powershell
cd C:\path\to\Vencord
pnpm install --frozen-lockfile
$env:VENCORD_HASH = 'd07030c'
$env:VENCORD_REMOTE = 'Vendicated/Vencord'
pnpm build --dev --standalone
& C:\path\to\PfpWatcher\installer\build.ps1 -VencordCheckout (Get-Location).Path -OutputDirectory C:\path\to\build-output
```

When using the release's combined build-source archive, its `installer` directory contains the same build script and C# sources. The build script generates the plugin inventory, packages the distribution, compiles the EXE, and runs its read-only `--verify-payload` check. `installer-build` holds intermediate build files; only the final EXE is the installer deliverable.

The EXE is unsigned. No settings, profiles, images, tokens, or credentials from the developer's machine are embedded. Installation is offline and sends no telemetry.

## Validation

Thirty installer checks cover payload verification, safe paths, preserving settings and other files, backups, rollback after a simulated late failure, client detection, and real process closing/restart using a disposable patched client. The GUI was opened, but its end-to-end installation with the user's real Discord clients was not completed because Computer Use app approval timed out. The plugin separately passes its 20 functional tests and TypeScript checking.
