param(
    [Parameter(Mandatory = $true)][string]$VencordCheckout,
    [Parameter(Mandatory = $true)][string]$OutputDirectory,
    [string]$VencordRevision = 'd07030c0968e31e41caa0c35fda0ef8ae63a079e'
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$checkout = (Resolve-Path -LiteralPath $VencordCheckout).Path
$output = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $output -Force | Out-Null
$scratch = Join-Path $output 'installer-build'
New-Item -ItemType Directory -Path $scratch -Force | Out-Null
$dist = Join-Path $checkout 'dist'
$renderer = Get-Content -LiteralPath (Join-Path $dist 'renderer.js') -TotalCount 4
if ($renderer -notcontains '// Standalone: true') { throw 'Build Vencord using pnpm build --dev --standalone first.' }

Push-Location $checkout
try {
    & pnpm exec tsx scripts/generatePluginList.ts (Join-Path $scratch 'official-plugins.json') (Join-Path $scratch 'official-readmes.json')
    if ($LASTEXITCODE -ne 0) { throw 'Plugin inventory generation failed.' }
} finally { Pop-Location }
$plugins = @((Get-Content -LiteralPath (Join-Path $scratch 'official-plugins.json') -Raw | ConvertFrom-Json).name)
$plugins += 'PfpWatcher'
Get-ChildItem -LiteralPath (Join-Path $checkout 'src/plugins/_api') -Recurse -File | Where-Object { $_.Extension -in '.ts', '.tsx' } | ForEach-Object {
    $match = [regex]::Match((Get-Content -LiteralPath $_.FullName -Raw), '(?s)definePlugin\(\{\s*name:\s*["'']([^"'']+)')
    if ($match.Success) { $plugins += $match.Groups[1].Value }
}
$files = [ordered]@{}
Get-ChildItem -LiteralPath $dist -File | Sort-Object Name | ForEach-Object {
    $files[$_.Name] = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
}
$manifest = @{Version = '0.2.0-beta.7'; VencordRevision = $VencordRevision; Files = $files; Plugins = @($plugins | Sort-Object -Unique)} | ConvertTo-Json -Depth 8
$payload = Join-Path $scratch 'payload.zip'
if (Test-Path -LiteralPath $payload) { Remove-Item -LiteralPath $payload }
$archive = [IO.Compression.ZipFile]::Open($payload, [IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($file in Get-ChildItem -LiteralPath $dist -File) {
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, "dist/$($file.Name)") | Out-Null
    }
    $entry = $archive.CreateEntry('manifest.json')
    $writer = [IO.StreamWriter]::new($entry.Open(), [Text.UTF8Encoding]::new($false))
    try { $writer.Write($manifest) } finally { $writer.Dispose() }
} finally { $archive.Dispose() }
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (!(Test-Path -LiteralPath $compiler)) { $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
$exe = Join-Path $output 'PfpWatcher-Setup-v0.2.0-beta.7.exe'
$license = Join-Path $PSScriptRoot '../LICENSE'
if (!(Test-Path -LiteralPath $license)) { $license = Join-Path $checkout 'LICENSE' }
$arguments = @('/nologo', '/target:winexe', '/platform:anycpu', '/optimize+', "/out:$exe", "/win32manifest:$(Join-Path $PSScriptRoot 'app.manifest')", "/resource:$payload,PfpWatcher.payload.zip", "/resource:$license,PfpWatcher.LICENSE", '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', '/r:System.Web.Extensions.dll', '/r:System.IO.Compression.dll', '/r:System.IO.Compression.FileSystem.dll', (Join-Path $PSScriptRoot 'InstallerCore.cs'), (Join-Path $PSScriptRoot 'Program.cs'))
& $compiler @arguments
if ($LASTEXITCODE -ne 0) { throw 'Installer compilation failed.' }
$verified = Start-Process -FilePath $exe -ArgumentList '--verify-payload' -WindowStyle Hidden -Wait -PassThru
if ($verified.ExitCode -ne 0) { throw 'Installer payload verification failed.' }
Get-Item -LiteralPath $exe | Select-Object FullName, Length
Get-FileHash -LiteralPath $exe -Algorithm SHA256
