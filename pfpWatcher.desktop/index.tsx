/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 notjacobwashere and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Logger } from "@utils/Logger";
import { sleep } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import { Menu, RestAPI, showToast, UserStore, useState } from "@webpack/common";

import { Native } from "./bridge";
import { openGallery } from "./Gallery";
import { watchAvatarResources } from "./watch";

const logger = new Logger("PfpWatcher");
const settings = definePluginSettings({
    users: {
        type: OptionType.STRING,
        description: "Usernames or user IDs to track, separated by commas (no display names).",
        default: ""
    },
    folder: {
        type: OptionType.STRING,
        description: "Absolute path to your pfp folder. Leave blank for Documents/pfp.",
        default: ""
    },
    collectEvery30Minutes: {
        displayName: "Automatic checks",
        type: OptionType.BOOLEAN,
        description: "Check for new profile pictures at your chosen interval while Discord is open.",
        default: false,
        onChange: (value: boolean) => configureCollectionTimer(value)
    },
    checkIntervalMinutes: {
        displayName: "Check interval (minutes)",
        type: OptionType.NUMBER,
        description: "Minutes between automatic checks (1–1440). Changes restart the timer.",
        default: 30,
        min: 1,
        max: 1440,
        isValid: value => {
            // Vencord's number input validates text before converting it to a number.
            const number = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : NaN;
            return Number.isInteger(number) && number >= 1 && number <= 1440 || "Enter a whole number from 1 to 1440.";
        },
        onChange: () => configureCollectionTimer(settings.store.collectEvery30Minutes)
    },
    collectOnDiscordLoad: {
        displayName: "Save avatars when Discord loads them",
        type: OptionType.BOOLEAN,
        description: "Save new global avatars for tracked users when Discord loads an image or receives a user update. DevTools can stay closed.",
        default: true,
        onChange: () => configureAvatarWatcher()
    }
});

let enabled = false;
let startupChecked = false;
let running: Promise<string> | undefined;
let runningSession = 0;
let collectionTimer: ReturnType<typeof setInterval> | undefined;
let session = 0;
let stopWatching: (() => void) | undefined;
let observedQueue: Promise<void> = Promise.resolve();
const observed = new Set<string>();

async function collectObservedAvatar(id: string, hash: string, username?: string) {
    if (!enabled || !settings.store.collectOnDiscordLoad || !UserStore.getCurrentUser()) return;
    if (!/^\d{17,20}$/.test(id) || !/^(?:a_)?[a-f0-9]{32}$/.test(hash)) return;
    const currentSession = session;
    const folder = settings.store.folder;
    const entries = settings.store.users.split(/[,\n]/).map(s => s.trim().replace(/^@/, "")).filter(Boolean);
    const remembered = await DataStore.get<Record<string, string>>("PfpWatcher.users") ?? {};
    const user = UserStore.getUser(id);
    if (!entries.some(entry => entry === id || remembered[entry] === id
        || (user?.username && entry.toLowerCase() === user.username.toLowerCase()))) return;
    const key = `${currentSession}:${folder}:${id}:${hash}`;
    if (observed.has(key)) return;
    observed.add(key);
    observedQueue = observedQueue.catch(() => {}).then(async () => {
        if (!enabled || session !== currentSession || !settings.store.collectOnDiscordLoad || settings.store.folder !== folder) {
            observed.delete(key);
            return;
        }
        try {
            const result = await Native.saveAvatar(folder, id, hash, username ?? user?.username ?? "");
            if (result.saved) logger.info(`Saved observed avatar for ${id}`);
        } catch (error) {
            observed.delete(key);
            logger.error(`Could not save observed avatar for ${id}`, error);
        }
        // Bound session memory; native disk deduplication still prevents duplicate files.
        if (observed.size > 2048) observed.delete(observed.values().next().value!);
    });
    await observedQueue;
}

function observeAvatar(id: string, hash: string, username?: string) {
    void collectObservedAvatar(id, hash, username).catch(error => logger.error("Avatar observation failed", error));
}

function configureAvatarWatcher() {
    stopWatching?.();
    stopWatching = undefined;
    if (enabled && settings.store.collectOnDiscordLoad) {
        try { stopWatching = watchAvatarResources(observeAvatar); }
        catch (error) { logger.error("Could not watch Chromium avatar resources", error); }
    }
}

async function checkUsers() {
    const checkSession = session;
    const entries = [...new Set(settings.store.users.split(/[,\n]/).map(s => s.trim().replace(/^@/, "")).filter(Boolean))];
    const { folder } = settings.store;
    const remembered = await DataStore.get<Record<string, string>>("PfpWatcher.users") ?? {};
    let saved = 0;
    let existing = 0;
    let missing = 0;
    const failures: string[] = [];
    const checkedIds = new Set<string>();
    for (const entry of entries) {
        if (!enabled || checkSession !== session) break;
        try {
            let id = /^\d{17,20}$/.test(entry) ? entry : remembered[entry];
            if (!id) {
                const matches = Object.values(UserStore.getUsers()).filter(u => u.username.toLowerCase() === entry.toLowerCase());
                if (matches.length !== 1) throw new Error("Username not found or ambiguous; open their profile first, or use their user ID.");
                id = matches[0].id;
            }
            // Aliases and an explicit ID may resolve to the same account.
            if (checkedIds.has(id)) continue;
            checkedIds.add(id);
            // Fetch fresh data: the user store may still contain yesterday's avatar.
            const { body } = await RestAPI.get({ url: `/users/${id}` });
            if (body.id !== id) throw new Error("Unexpected user response");
            remembered[entry] = id;
            await DataStore.set("PfpWatcher.users", remembered);
            if (!enabled || checkSession !== session) break;
            if (!body.avatar) {
                missing++;
            } else {
                const result = await Native.saveAvatar(folder, id, body.avatar, body.username);
                if (result.saved) saved++;
                else existing++;
            }
        } catch (error) {
            failures.push(`${entry}: ${String(error)}`);
            logger.error(`Could not check ${entry}`, error);
        }
        await sleep(1000);
    }
    return `${saved} saved, ${existing} already saved, ${missing} without a custom avatar.${failures.length ? ` Errors: ${failures.join("; ")}` : ""}`;
}

function checkNow() {
    if (!enabled) return Promise.resolve("Enable PfpWatcher to collect avatars.");
    if (running && runningSession !== session) {
        const requestedSession = session;
        return running.catch(() => {}).then(() => requestedSession === session ? checkNow() : "Check canceled.");
    }
    if (running) return running;
    runningSession = session;
    return running = checkUsers().finally(() => { running = undefined; });
}

function configureCollectionTimer(collectEvery30Minutes: boolean) {
    if (collectionTimer !== undefined) clearInterval(collectionTimer);
    collectionTimer = undefined;
    if (!enabled || !collectEvery30Minutes) return;
    collectionTimer = setInterval(() => {
        if (!enabled || !settings.store.collectEvery30Minutes || !UserStore.getCurrentUser()) return;
        void checkNow().then(result => logger.info(result)).catch(error => logger.error("Scheduled check failed", error));
    }, Math.min(1440, Math.max(1, Math.trunc(settings.store.checkIntervalMinutes || 30))) * 60 * 1000);
}

function startupCheck() {
    if (!enabled || startupChecked || !UserStore.getCurrentUser()) return;
    startupChecked = true;
    void checkNow().then(result => logger.info(result)).catch(error => {
        startupChecked = false;
        logger.error("Startup check failed", error);
    });
}

export default definePlugin({
    name: "PfpWatcher",
    description: "Collect tracked users' avatars at startup, on a schedule, or when Discord loads them.",
    authors: [{ name: "notjacobwashere", id: 0n }],
    dependencies: ["VencordToolbox"],
    settings,
    toolboxActions() {
        return <Menu.MenuItem id="pfp-watcher-menu" label="PfpWatcher">
            <Menu.MenuItem id="pfp-watcher-rescan" label="Rescan tracked users" action={() => {
                showToast({ text: "Checking tracked users’ avatars…" });
                void checkNow().then(text => showToast({ text }))
                    .catch(error => showToast({ text: `PfpWatcher: ${String(error)}`, variant: "critical" }));
            }} />
            <Menu.MenuItem id="pfp-watcher-gallery" label="Open gallery" action={() => openGallery(settings.store.folder)} />
        </Menu.MenuItem>;
    },
    start() {
        enabled = true;
        session++;
        configureAvatarWatcher();
        configureCollectionTimer(settings.store.collectEvery30Minutes);
        startupChecked = false;
        startupCheck();
    },
    stop() {
        enabled = false;
        session++;
        configureCollectionTimer(false);
        configureAvatarWatcher();
        observed.clear();
    },
    flux: {
        CONNECTION_OPEN: startupCheck,
        USER_UPDATE({ user }) {
            if (user?.id && user.avatar) observeAvatar(user.id, user.avatar, user.username);
        }
    },
    settingsAboutComponent: ErrorBoundary.wrap(() => {
        const [status, setStatus] = useState("");
        const [busy, setBusy] = useState(false);
        return <div>
            <p>Checks at startup and optionally at your chosen interval. Live collection saves tracked users' avatars when Discord loads them; DevTools can stay closed. Changes Discord never receives cannot be detected. Usernames resolve from users your client knows; IDs work directly.</p>
            <div className="vc-pfp-actions">
                <Button onClick={() => openGallery(settings.store.folder)}>Browse collected pfps</Button>
                <Button disabled={busy} onClick={async () => {
                    setBusy(true);
                    try { setStatus(await checkNow()); }
                    catch (error) { setStatus(String(error)); }
                    finally { setBusy(false); }
                }}>Check now</Button>
                <Button onClick={() => { void Native.openFolder(settings.store.folder).catch(error => setStatus(String(error))); }}>Open pfp folder</Button>
            </div>
            <p role="status" style={{ overflowWrap: "anywhere" }}>{status}</p>
        </div>;
    }, { noop: false })
});
