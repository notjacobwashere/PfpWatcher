// PfpWatcher Windows installer. GPL-3.0-or-later.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

namespace PfpWatcherSetup {
    public sealed class PayloadInfo {
        public string Version { get; set; }
        public string VencordRevision { get; set; }
        public Dictionary<string, string> Files { get; set; }
        public string[] Plugins { get; set; }
    }

    public sealed class InstallResult {
        public string BackupDirectory;
        public List<string> RestartFailures = new List<string>();
    }

    public static class InstallerCore {
        public static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 16 * 1024 * 1024 };
        public static readonly string[] ClientNames = { "Discord", "DiscordCanary", "DiscordPTB", "DiscordDevelopment" };

        public static string Hash(byte[] bytes) {
            using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
        }

        public static PayloadInfo ReadPayload(byte[] zip) {
            using (var stream = new MemoryStream(zip))
            using (var archive = new ZipArchive(stream, ZipArchiveMode.Read)) {
                var entry = archive.GetEntry("manifest.json");
                if (entry == null) throw new InvalidDataException("The installer payload has no manifest.");
                PayloadInfo info;
                using (var reader = new StreamReader(entry.Open())) info = Json.Deserialize<PayloadInfo>(reader.ReadToEnd());
                if (info == null || info.Version != "0.2.0-beta.6" || info.Files == null || info.Files.Count == 0)
                    throw new InvalidDataException("Invalid installer manifest.");
                var required = new[] { "patcher.js", "preload.js", "renderer.js", "renderer.css", "vencordDesktopMain.js" };
                if (required.Any(name => !info.Files.ContainsKey(name))) throw new InvalidDataException("The Vencord build is incomplete.");
                var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (var file in info.Files) {
                    if (Path.GetFileName(file.Key) != file.Key || file.Key.IndexOfAny(new[] { '/', '\\', ':' }) >= 0 || file.Key == "." || file.Key == ".." || !names.Add(file.Key))
                        throw new InvalidDataException("Unsafe payload filename.");
                    var matches = archive.Entries.Where(e => e.FullName == "dist/" + file.Key).ToArray();
                    if (matches.Length != 1 || Hash(ReadEntry(matches[0])) != file.Value)
                        throw new InvalidDataException("Payload verification failed: " + file.Key);
                }
                return info;
            }
        }

        private static byte[] ReadEntry(ZipArchiveEntry entry) {
            using (var input = entry.Open())
            using (var output = new MemoryStream()) { input.CopyTo(output); return output.ToArray(); }
        }

        public static string NormalizeDist(string path) {
            var full = Path.GetFullPath(path.Trim().Trim('"')).TrimEnd(Path.DirectorySeparatorChar);
            if (!File.Exists(Path.Combine(full, "renderer.js")) && Directory.Exists(Path.Combine(full, "dist"))) full = Path.Combine(full, "dist");
            if (!File.Exists(Path.Combine(full, "renderer.js")) || !File.Exists(Path.Combine(full, "patcher.js")))
                throw new DirectoryNotFoundException("Select an existing Vencord dist folder containing renderer.js and patcher.js. Install Vencord first if it is not installed.");
            return full;
        }

        public static Dictionary<string, object> ReadSettings(string settingsPath) {
            if (!File.Exists(settingsPath)) return new Dictionary<string, object>();
            var result = Json.DeserializeObject(File.ReadAllText(settingsPath)) as Dictionary<string, object>;
            if (result == null) throw new InvalidDataException("Vencord settings are not valid JSON. No files were changed.");
            return result;
        }

        private static Dictionary<string, object> ObjectProperty(Dictionary<string, object> parent, string name) {
            object value;
            if (parent.TryGetValue(name, out value)) {
                var result = value as Dictionary<string, object>;
                if (result == null) throw new InvalidDataException("Invalid Vencord setting: " + name);
                return result;
            }
            var created = new Dictionary<string, object>(); parent[name] = created; return created;
        }

        public static string UpdatedSettings(Dictionary<string, object> settings) {
            var plugins = ObjectProperty(settings, "plugins");
            foreach (var name in new[] { "PfpWatcher", "VencordToolbox" }) ObjectProperty(plugins, name)["enabled"] = true;
            return Json.Serialize(settings);
        }

        public static string[] MissingEnabledPlugins(Dictionary<string, object> settings, PayloadInfo payload) {
            object value;
            if (!settings.TryGetValue("plugins", out value)) return new string[0];
            var plugins = value as Dictionary<string, object>;
            if (plugins == null) throw new InvalidDataException("Invalid plugin settings.");
            var known = new HashSet<string>(payload.Plugins ?? new string[0], StringComparer.Ordinal);
            return plugins.Where(p => {
                var obj = p.Value as Dictionary<string, object>; object enabled;
                return obj != null && obj.TryGetValue("enabled", out enabled) && enabled is bool && (bool)enabled && !known.Contains(p.Key);
            }).Select(p => p.Key).OrderBy(p => p).ToArray();
        }

        public static string PatchedDistForExecutable(string executable) {
            try {
                var asar = Path.Combine(Path.GetDirectoryName(executable), "resources", "app.asar");
                if (!File.Exists(asar) || new FileInfo(asar).Length > 65536) return null;
                var text = Encoding.UTF8.GetString(File.ReadAllBytes(asar));
                var match = Regex.Match(text, "require\\(\"(?<path>[^\"\\r\\n]*patcher\\.js)\"\\)");
                if (!match.Success) return null;
                var patcher = Json.Deserialize<string>("\"" + match.Groups["path"].Value + "\"");
                if (!Path.IsPathRooted(patcher)) return null;
                return Path.GetFullPath(Path.GetDirectoryName(patcher)).TrimEnd(Path.DirectorySeparatorChar);
            } catch { return null; }
        }

        public static List<string> DiscoverDistDirectories() {
            var paths = new List<string>();
            foreach (var name in ClientNames)
                foreach (var process in Process.GetProcessesByName(name)) {
                    try {
                        if (process.SessionId != Process.GetCurrentProcess().SessionId) continue;
                        var path = PatchedDistForExecutable(process.MainModule.FileName);
                        if (path != null && File.Exists(Path.Combine(path, "renderer.js"))) paths.Add(path);
                    } catch { }
                    finally { process.Dispose(); }
                }
            var standard = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Vencord", "dist");
            if (File.Exists(Path.Combine(standard, "patcher.js"))) paths.Add(standard);
            foreach (var name in ClientNames) {
                var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), name);
                if (!Directory.Exists(root)) continue;
                foreach (var app in Directory.GetDirectories(root, "app-*")) {
                    var path = PatchedDistForExecutable(Path.Combine(app, name + ".exe"));
                    if (path != null && File.Exists(Path.Combine(path, "renderer.js"))) paths.Add(path);
                }
            }
            return paths.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        }

        public static List<Process> RunningClients(string dist) {
            var found = new List<Process>();
            foreach (var name in ClientNames)
                foreach (var process in Process.GetProcessesByName(name)) {
                    try {
                        if (process.SessionId == Process.GetCurrentProcess().SessionId &&
                            String.Equals(PatchedDistForExecutable(process.MainModule.FileName), dist, StringComparison.OrdinalIgnoreCase)) found.Add(process);
                        else process.Dispose();
                    } catch { process.Dispose(); }
                }
            return found;
        }

        public static string[] CloseClients(List<Process> processes) {
            var restart = processes.Select(p => p.MainModule.FileName).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
            foreach (var process in processes) {
                try { if (!process.HasExited && process.MainWindowHandle != IntPtr.Zero) process.CloseMainWindow(); }
                catch (InvalidOperationException) { }
            }
            foreach (var process in processes) {
                try {
                    if (!process.HasExited && !process.WaitForExit(2000)) { process.Kill(); process.WaitForExit(5000); }
                    if (!process.HasExited) throw new IOException("Could not close " + process.ProcessName + ". Close it manually and retry.");
                } catch (InvalidOperationException) { }
                finally { process.Dispose(); }
            }
            return restart;
        }

        public static List<string> RestartClients(IEnumerable<string> executables) {
            var failures = new List<string>();
            foreach (var executable in executables.Distinct(StringComparer.OrdinalIgnoreCase)) {
                try {
                    Process.Start(new ProcessStartInfo(executable) { UseShellExecute = true, WorkingDirectory = Path.GetDirectoryName(executable) });
                } catch (Exception error) { failures.Add(executable + ": " + error.Message); }
            }
            return failures;
        }

        private static void EnsureRegular(string path) {
            if ((File.Exists(path) || Directory.Exists(path)) && (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
                throw new IOException("Linked build files are not supported. Select the actual Vencord folder: " + path);
        }

        private static void CopyDirectory(string source, string destination) {
            EnsureRegular(source); Directory.CreateDirectory(destination);
            foreach (var file in Directory.GetFiles(source)) { EnsureRegular(file); File.Copy(file, Path.Combine(destination, Path.GetFileName(file)), true); }
            foreach (var dir in Directory.GetDirectories(source)) CopyDirectory(dir, Path.Combine(destination, Path.GetFileName(dir)));
        }

        private static void AtomicWrite(string path, byte[] bytes) {
            EnsureRegular(path);
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            var temporary = path + ".pfp-" + Guid.NewGuid().ToString("N") + ".tmp";
            try {
                File.WriteAllBytes(temporary, bytes);
                if (File.Exists(path)) File.Replace(temporary, path, null);
                else File.Move(temporary, path);
            } finally { if (File.Exists(temporary)) File.Delete(temporary); }
        }

        public static InstallResult Install(byte[] payloadZip, string dist, string settingsPath, string backupRoot, Action<string> status, Action<string> afterWrite = null) {
            var info = ReadPayload(payloadZip);
            dist = NormalizeDist(dist); EnsureRegular(dist); EnsureRegular(settingsPath);
            var fullBackupRoot = Path.GetFullPath(backupRoot).TrimEnd(Path.DirectorySeparatorChar);
            if (String.Equals(fullBackupRoot, dist, StringComparison.OrdinalIgnoreCase) || fullBackupRoot.StartsWith(dist + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                throw new IOException("The backup directory must be outside the Vencord build folder.");
            var settings = UpdatedSettings(ReadSettings(settingsPath));
            var originalSettings = File.Exists(settingsPath) ? File.ReadAllBytes(settingsPath) : null;
            var backup = Path.Combine(backupRoot, DateTime.Now.ToString("yyyyMMdd-HHmmss") + "-" + Guid.NewGuid().ToString("N").Substring(0, 8));
            var existed = info.Files.Keys.ToDictionary(name => name, name => File.Exists(Path.Combine(dist, name)));
            foreach (var name in info.Files.Keys) EnsureRegular(Path.Combine(dist, name));
            status("Backing up the current Vencord build…");
            CopyDirectory(dist, Path.Combine(backup, "dist"));
            if (originalSettings != null) File.WriteAllBytes(Path.Combine(backup, "settings.json"), originalSettings);
            File.WriteAllText(Path.Combine(backup, "backup-info.json"), Json.Serialize(new { Version = info.Version, Dist = dist, Settings = settingsPath, ExistingFiles = existed, SettingsExisted = originalSettings != null }));
            var written = new List<string>();
            bool settingsWritten = false;
            try {
                status("Installing PfpWatcher and Vencord…");
                using (var input = new MemoryStream(payloadZip))
                using (var archive = new ZipArchive(input, ZipArchiveMode.Read))
                    foreach (var file in info.Files) {
                        AtomicWrite(Path.Combine(dist, file.Key), ReadEntry(archive.GetEntry("dist/" + file.Key)));
                        written.Add(file.Key);
                        if (afterWrite != null) afterWrite(file.Key);
                    }
                status("Enabling PfpWatcher and preserving your settings…");
                AtomicWrite(settingsPath, new UTF8Encoding(false).GetBytes(settings)); settingsWritten = true;
                if (afterWrite != null) afterWrite("settings.json");
                File.WriteAllText(Path.Combine(backup, "install.log"), "Installed PfpWatcher " + info.Version + Environment.NewLine + "Vencord revision: " + info.VencordRevision + Environment.NewLine);
                return new InstallResult { BackupDirectory = backup };
            } catch (Exception installError) {
                var rollbackErrors = new List<string>();
                foreach (var name in written) {
                    try {
                        var target = Path.Combine(dist, name);
                        if (existed[name]) AtomicWrite(target, File.ReadAllBytes(Path.Combine(backup, "dist", name)));
                        else if (File.Exists(target)) File.Delete(target);
                    } catch (Exception error) { rollbackErrors.Add(name + ": " + error.Message); }
                }
                if (settingsWritten) {
                    try { if (originalSettings != null) AtomicWrite(settingsPath, originalSettings); else File.Delete(settingsPath); }
                    catch (Exception error) { rollbackErrors.Add("settings: " + error.Message); }
                }
                var message = "Installation failed: " + installError.Message + Environment.NewLine +
                    (rollbackErrors.Count == 0 ? "The previous files were restored." : "Some files could not be restored: " + String.Join("; ", rollbackErrors)) + Environment.NewLine + "Backup: " + backup;
                File.WriteAllText(Path.Combine(backup, "install.log"), message);
                throw new IOException(message, installError);
            }
        }
    }
}
