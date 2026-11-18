/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 notjacobwashere and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { randomUUID } from "crypto";
import { app, net, shell } from "electron";
import { link, lstat, mkdir, readdir, readFile, rename, unlink, writeFile } from "fs/promises";
import { isAbsolute, join } from "path";

export interface ArchivedAvatar {
    filename: string;
    userId: string;
    username: string;
    animated: boolean;
    collectedAt: number;
    estimatedTime: boolean;
}

interface Metadata {
    username: string;
    collectedAt: number;
    estimatedTime: boolean;
}

const MAX_AVATAR_BYTES = 50 * 1024 * 1024;

function getFolder(folder: string) {
    if (!folder.trim()) return join(app.getPath("documents"), "pfp");
    if (!isAbsolute(folder)) throw new Error("The pfp folder must be an absolute path.");
    return folder;
}

function parseFilename(filename: string) {
    const match = /^(\d{17,20})_((?:a_)?[a-f0-9]{32})(?:_copy_[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})?\.(png|gif)$/.exec(filename);
    if (!match || (match[2].startsWith("a_") ? "gif" : "png") !== match[3])
        throw new Error("Invalid archived avatar filename");
    return { userId: match[1], animated: match[3] === "gif" };
}

async function avatarFile(folder: string, filename: string) {
    parseFilename(filename);
    const path = join(getFolder(folder), filename);
    const file = await lstat(path);
    if (!file.isFile() || !file.size || file.size > MAX_AVATAR_BYTES)
        throw new Error("Avatar is missing, empty, too large, or not a regular file");
    return { path, file };
}

async function readMetadata(directory: string, filename: string): Promise<Metadata | undefined> {
    try {
        const path = join(directory, ".pfp-watcher", `${filename}.json`);
        const file = await lstat(path);
        if (!file.isFile() || file.size > 16 * 1024) return;
        const data = JSON.parse(await readFile(path, "utf8"));
        if (!data || typeof data !== "object" || typeof data.username !== "string" || data.username.length > 100
            || typeof data.collectedAt !== "number" || !Number.isFinite(data.collectedAt)
            || data.collectedAt <= 0 || data.collectedAt > 8.64e15
            || typeof data.estimatedTime !== "boolean") return;
        return data;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return;
        throw error;
    }
}

async function rememberAvatar(directory: string, filename: string, username: string, collectedAt: number, estimatedTime: boolean) {
    const previous = await readMetadata(directory, filename);
    if (previous?.username === username) return;
    const metadata: Metadata = {
        username,
        collectedAt: previous?.collectedAt ?? collectedAt,
        estimatedTime: previous?.estimatedTime ?? estimatedTime
    };
    const metadataFolder = join(directory, ".pfp-watcher");
    await mkdir(metadataFolder, { recursive: true });
    const temporary = join(metadataFolder, `${randomUUID()}.tmp`);
    try {
        await writeFile(temporary, JSON.stringify(metadata), { flag: "wx" });
        await rename(temporary, join(metadataFolder, `${filename}.json`));
    } finally {
        await unlink(temporary).catch(() => {});
    }
}

export async function openFolder(_: unknown, folder: string) {
    const path = getFolder(folder);
    await mkdir(path, { recursive: true });
    const error = await shell.openPath(path);
    if (error) throw new Error(error);
}

export async function getFolderSize(_: unknown, folder: string) {
    const pending = [getFolder(folder)];
    let bytes = 0;
    while (pending.length) {
        const directory = pending.pop()!;
        try {
            const entries = await readdir(directory);
            for (const entry of entries) {
                const path = join(directory, entry);
                try {
                    const file = await lstat(path);
                    if (file.isDirectory()) pending.push(path);
                    else if (file.isFile()) bytes += file.size;
                } catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
                }
            }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
    }
    return bytes;
}

export async function listAvatars(_: unknown, folder: string): Promise<ArchivedAvatar[]> {
    const directory = getFolder(folder);
    let filenames: string[];
    try { filenames = await readdir(directory); }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
    }
    const avatars: ArchivedAvatar[] = [];
    for (const filename of filenames) {
        let identity: ReturnType<typeof parseFilename>;
        try { identity = parseFilename(filename); }
        catch { continue; }
        try {
            const { file } = await avatarFile(folder, filename);
            const metadata = await readMetadata(directory, filename);
            avatars.push({
                filename,
                ...identity,
                username: metadata?.username ?? "",
                collectedAt: metadata?.collectedAt ?? file.mtimeMs,
                estimatedTime: metadata?.estimatedTime ?? true
            });
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
            // Ignore non-regular or empty images, but report filesystem access errors.
            if ((error as NodeJS.ErrnoException).code) throw error;
        }
    }
    return avatars;
}

export async function readAvatar(_: unknown, folder: string, filename: string) {
    const { path } = await avatarFile(folder, filename);
    const bytes = await readFile(path);
    if (bytes.length > MAX_AVATAR_BYTES) throw new Error("Avatar exceeds 50 MiB");
    const type = filename.endsWith(".gif") ? "gif" : "png";
    return `data:image/${type};base64,${bytes.toString("base64")}`;
}

export async function showAvatarInFolder(_: unknown, folder: string, filename: string) {
    const { path } = await avatarFile(folder, filename);
    shell.showItemInFolder(path);
}

async function findAvatar(folder: string, id: string, hash: string) {
    if (!/^\d{17,20}$/.test(id) || !/^(a_)?[a-f0-9]{32}$/.test(hash))
        throw new Error("Invalid avatar identity");
    const extension = hash.startsWith("a_") ? "gif" : "png";
    const canonical = `${id}_${hash}.${extension}`;
    try { return { ...await avatarFile(folder, canonical), filename: canonical }; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    let filenames: string[];
    try { filenames = await readdir(getFolder(folder)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    for (const filename of filenames) {
        if (!filename.startsWith(`${id}_${hash}_copy_`)) continue;
        try { parseFilename(filename); } catch { continue; }
        try { return { ...await avatarFile(folder, filename), filename }; }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code && (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
    }
}

export async function hasAvatar(_: unknown, folder: string, id: string, hash: string) {
    return Boolean(await findAvatar(folder, id, hash));
}

export async function saveAvatar(_: unknown, folder: string, id: string, hash: string, username = "", saveCopy = false) {
    if (!/^\d{17,20}$/.test(id) || !/^(a_)?[a-f0-9]{32}$/.test(hash))
        throw new Error("Invalid avatar identity");
    if (typeof username !== "string" || username.length > 100) throw new Error("Invalid username");
    if (typeof saveCopy !== "boolean") throw new Error("Invalid copy option");
    const extension = hash.startsWith("a_") ? "gif" : "png";
    const directory = getFolder(folder);
    const filename = `${id}_${hash}${saveCopy ? `_copy_${randomUUID()}` : ""}.${extension}`;
    const path = join(directory, filename);
    await mkdir(directory, { recursive: true });
    if (!saveCopy) {
        const existing = await findAvatar(folder, id, hash);
        if (existing) {
            await rememberAvatar(directory, existing.filename, username, existing.file.mtimeMs, true);
            return { saved: false, path: existing.path };
        }
    }
    const response = await net.fetch(`https://cdn.discordapp.com/avatars/${id}/${hash}.${extension}?size=4096`, {
        redirect: "error",
        signal: AbortSignal.timeout(30_000)
    });
    if (!response.ok) throw new Error(`Avatar download failed: HTTP ${response.status}`);
    if (!response.body) throw new Error("Empty download");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > MAX_AVATAR_BYTES) throw new Error("Avatar exceeds 50 MiB");
            chunks.push(value);
        }
    } finally {
        await reader.cancel();
    }
    const bytes = Buffer.concat(chunks);
    const valid = extension === "png"
        ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString());
    if (!valid) throw new Error("CDN did not return the expected image format");
    const temporary = join(directory, `.pfp-${randomUUID()}.tmp`);
    try {
        await writeFile(temporary, bytes, { flag: "wx" });
        try { await link(temporary, path); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
            const { file } = await avatarFile(folder, filename);
            await rememberAvatar(directory, filename, username, file.mtimeMs, true);
            return { saved: false, path };
        }
        await rememberAvatar(directory, filename, username, Date.now(), false);
    } finally {
        await unlink(temporary).catch(() => {});
    }
    return { saved: true, path };
}

export async function pruneAvatars(_: unknown, folder: string, maximum: number) {
    if (!Number.isInteger(maximum) || maximum < 1 || maximum > 100000)
        throw new Error("Invalid archive limit");
    const directory = getFolder(folder);
    const avatars = (await listAvatars(null, folder)).sort((a, b) => b.collectedAt - a.collectedAt || a.filename.localeCompare(b.filename));
    let removed = 0;
    for (const avatar of avatars.slice(maximum)) {
        // Only remove validated archive images, never unrelated files or directories.
        const { path } = await avatarFile(folder, avatar.filename);
        await unlink(path);
        await unlink(join(directory, ".pfp-watcher", `${avatar.filename}.json`)).catch(error => {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        });
        removed++;
    }
    return removed;
}
