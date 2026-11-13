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
import { RestAPI, UserStore, useState } from "@webpack/common";

import { Native } from "./bridge";
import { openGallery } from "./Gallery";

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
        displayName: "Check every 30 minutes",
        type: OptionType.BOOLEAN,
        description: "Check for new profile pictures every 30 minutes while Discord is open, in addition to startup.",
        default: false,
        onChange: (value: boolean) => configureCollectionTimer(value)
    }
});

let enabled = false;
let startupChecked = false;
let running: Promise<string> | undefined;
let runningSession = 0;
let collectionTimer: ReturnType<typeof setInterval> | undefined;
let session = 0;

async function checkUsers() {
    const checkSession = session;
    const entries = [...new Set(settings.store.users.split(/[,\n]/).map(s => s.trim().replace(/^@/, "")).filter(Boolean))];
    const { folder } = settings.store;
    const remembered = await DataStore.get<Record<string, string>>("PfpWatcher.users") ?? {};
    let saved = 0;
    let existing = 0;
    let missing = 0;
    const failures: string[] = [];
    for (const entry of entries) {
        if (!enabled || checkSession !== session) break;
        try {
            let id = /^\d{17,20}$/.test(entry) ? entry : remembered[entry];
            if (!id) {
                const matches = Object.values(UserStore.getUsers()).filter(u => u.username.toLowerCase() === entry.toLowerCase());
                if (matches.length !== 1) throw new Error("Username not found or ambiguous; open their profile first, or use their user ID.");
                id = matches[0].id;
            }
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
    }, 30 * 60 * 1000);
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
    description: "Collect profile pictures at startup or every 30 minutes, and browse your saved collection.",
    authors: [{ name: "notjacobwashere", id: 0n }],
    settings,
    start() {
        enabled = true;
        session++;
        configureCollectionTimer(settings.store.collectEvery30Minutes);
        startupChecked = false;
        startupCheck();
    },
    stop() {
        enabled = false;
        session++;
        configureCollectionTimer(false);
    },
    flux: { CONNECTION_OPEN: startupCheck },
    settingsAboutComponent: ErrorBoundary.wrap(() => {
        const [status, setStatus] = useState("");
        const [busy, setBusy] = useState(false);
        return <div>
            <p>Checks at startup, with optional checks every 30 minutes while Discord is open. Usernames resolve from users your client knows; IDs work directly. Resolved usernames stay linked to the same account after renames.</p>
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
