// PfpWatcher Windows installer. GPL-3.0-or-later.
using System;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Threading.Tasks;
using System.Windows.Forms;

[assembly: AssemblyTitle("PfpWatcher Setup")]
[assembly: AssemblyProduct("PfpWatcher")]
[assembly: AssemblyCompany("notjacobwashere")]
[assembly: AssemblyDescription("PfpWatcher 0.2.0 Beta 6 Windows installer")]
[assembly: AssemblyVersion("0.2.0.6")]
[assembly: AssemblyFileVersion("0.2.0.6")]

namespace PfpWatcherSetup {
    public sealed class SetupForm : Form {
        readonly TextBox target = new TextBox();
        readonly TextBox status = new TextBox();
        readonly Button install = new Button();
        readonly Button browse = new Button();
        readonly Button openBackup = new Button();
        readonly byte[] payload;
        readonly PayloadInfo info;
        readonly string userData;
        bool working;
        string backup;

        public SetupForm(byte[] payloadBytes) {
            payload = payloadBytes; info = InstallerCore.ReadPayload(payload);
            userData = Environment.GetEnvironmentVariable("VENCORD_USER_DATA_DIR");
            if (String.IsNullOrWhiteSpace(userData)) userData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Vencord");
            Text = "PfpWatcher Setup — Beta 6";
            ClientSize = new Size(650, 415); MinimumSize = new Size(665, 450);
            StartPosition = FormStartPosition.CenterScreen; Font = new Font("Segoe UI", 10);
            var title = new Label { Text = "Install PfpWatcher", Font = new Font("Segoe UI", 19, FontStyle.Bold), AutoSize = true, Location = new Point(24, 20) };
            var description = new Label { Text = "Adds PfpWatcher to an existing Vencord installation. Settings and saved pictures are kept. A backup is made before any files change.", Location = new Point(26, 67), Size = new Size(597, 49) };
            var pathLabel = new Label { Text = "Vencord build folder", AutoSize = true, Location = new Point(25, 128) };
            target.SetBounds(26, 153, 490, 27); target.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            var detected = InstallerCore.DiscoverDistDirectories();
            target.Text = detected.FirstOrDefault() ?? Path.Combine(userData, "dist");
            browse.Text = "Browse…"; browse.SetBounds(527, 151, 96, 31); browse.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            browse.Click += delegate { using (var dialog = new FolderBrowserDialog { Description = "Choose the existing Vencord build folder (dist).", SelectedPath = Directory.Exists(target.Text) ? target.Text : userData }) if (dialog.ShowDialog(this) == DialogResult.OK) target.Text = dialog.SelectedPath; };
            var notice = new Label { Text = "Includes official Vencord plugins and PfpWatcher. This replaces the current build; other custom plugins are not included. Discord clients using this build will close briefly and restart if they were open.", Location = new Point(26, 199), Size = new Size(597, 66) };
            status.Multiline = true; status.ReadOnly = true; status.BorderStyle = BorderStyle.None; status.BackColor = SystemColors.Control; status.TabStop = false;
            status.SetBounds(26, 273, 597, 71); status.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            status.Text = detected.Count == 0 ? "Vencord was not detected. Install Vencord first, or browse to its build folder." : "Ready. Click Install to back up and update Vencord.";
            install.Text = "Install and restart Discord"; install.SetBounds(362, 363, 261, 35); install.Anchor = AnchorStyles.Bottom | AnchorStyles.Right; install.Click += InstallClick;
            openBackup.Text = "Open backup"; openBackup.SetBounds(26, 363, 145, 35); openBackup.Enabled = false; openBackup.Anchor = AnchorStyles.Bottom | AnchorStyles.Left;
            openBackup.Click += delegate { if (backup != null) System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(backup) { UseShellExecute = true }); };
            var license = new LinkLabel { Text = "License / source", AutoSize = true, Location = new Point(200, 372), Anchor = AnchorStyles.Bottom | AnchorStyles.Left };
            license.LinkClicked += delegate {
                using (var dialog = new Form { Text = "PfpWatcher license and source", Size = new Size(720, 540), StartPosition = FormStartPosition.CenterParent }) {
                    string licenseText;
                    using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("PfpWatcher.LICENSE"))
                    using (var reader = new StreamReader(stream)) licenseText = reader.ReadToEnd();
                    dialog.Controls.Add(new TextBox { Dock = DockStyle.Fill, Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, Font = new Font("Consolas", 9), Text = "PfpWatcher source: https://github.com/notjacobwashere/PfpWatcher\r\nVencord source revision: " + info.VencordRevision + "\r\nThe release includes the corresponding build source archive.\r\n\r\n" + licenseText });
                    dialog.ShowDialog(this);
                }
            };
            Controls.AddRange(new Control[] { title, description, pathLabel, target, browse, notice, status, install, openBackup, license });
            FormClosing += delegate(object sender, FormClosingEventArgs args) { if (working) args.Cancel = true; };
            AcceptButton = install;
        }

        void SetStatus(string text) { if (InvokeRequired) BeginInvoke(new Action<string>(SetStatus), text); else status.Text = text; }

        async void InstallClick(object sender, EventArgs args) {
            if (working) return;
            string dist;
            var settingsPath = Path.Combine(userData, "settings", "settings.json");
            try {
                dist = InstallerCore.NormalizeDist(target.Text);
                var settings = InstallerCore.ReadSettings(settingsPath);
                InstallerCore.UpdatedSettings(InstallerCore.ReadSettings(settingsPath));
                var missing = InstallerCore.MissingEnabledPlugins(settings, info);
                if (missing.Length > 0 && MessageBox.Show(this,
                    "This build does not include these enabled plugins: " + String.Join(", ", missing) + ".\n\nTheir settings will be kept, but the plugins will be unavailable in this build. A backup of the current build will be saved. Install anyway?",
                    "Other plugins are enabled", MessageBoxButtons.OKCancel, MessageBoxIcon.Warning) != DialogResult.OK) return;
            } catch (Exception error) { MessageBox.Show(this, error.Message, "Cannot install", MessageBoxButtons.OK, MessageBoxIcon.Error); return; }
            working = true; install.Enabled = browse.Enabled = target.Enabled = false;
            string[] restart = new string[0];
            try {
                var result = await Task.Run(() => {
                    SetStatus("Closing Discord clients using this Vencord build…");
                    var running = InstallerCore.RunningClients(dist);
                    restart = running.Select(p => p.MainModule.FileName).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
                    InstallerCore.CloseClients(running);
                    var installed = InstallerCore.Install(payload, dist, settingsPath, Path.Combine(userData, "PfpWatcher-backups"), SetStatus);
                    SetStatus("Restarting previously open Discord clients…");
                    installed.RestartFailures = InstallerCore.RestartClients(restart); restart = new string[0];
                    return installed;
                });
                backup = result.BackupDirectory; openBackup.Enabled = true;
                status.Text = "Installed PfpWatcher " + info.Version + ". " + (result.RestartFailures.Count == 0 ? "Previously open Discord clients were restarted." : "Open Discord manually: " + String.Join("; ", result.RestartFailures)) + "\r\nBackup: " + backup;
                install.Text = "Installed";
            } catch (Exception error) {
                var restartErrors = InstallerCore.RestartClients(restart);
                status.Text = "Installation did not complete. See the error details and backup.";
                MessageBox.Show(this, error.Message + (restartErrors.Count > 0 ? "\nOpen Discord manually: " + String.Join("; ", restartErrors) : ""), "Installation failed", MessageBoxButtons.OK, MessageBoxIcon.Error);
                install.Enabled = true;
            } finally { working = false; browse.Enabled = target.Enabled = true; }
        }
    }

    internal static class Program {
        [STAThread]
        static int Main(string[] args) {
            try {
                byte[] payload;
                using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("PfpWatcher.payload.zip"))
                using (var memory = new MemoryStream()) {
                    if (stream == null) throw new InvalidDataException("Installer payload is missing.");
                    stream.CopyTo(memory); payload = memory.ToArray();
                }
                InstallerCore.ReadPayload(payload);
                if (args.Length == 1 && args[0] == "--verify-payload") return 0;
                Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new SetupForm(payload)); return 0;
            } catch (Exception error) {
                if (args.Length == 1 && args[0] == "--verify-payload") return 1;
                MessageBox.Show(error.Message, "PfpWatcher Setup", MessageBoxButtons.OK, MessageBoxIcon.Error); return 1;
            }
        }
    }
}
