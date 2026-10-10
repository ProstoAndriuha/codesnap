$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$sourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$distRoot = Join-Path $sourceRoot 'dist'
$manifest = Get-Content -LiteralPath (Join-Path $distRoot 'manifest.json') -Raw | ConvertFrom-Json
$sourceManifest = Get-Content -LiteralPath (Join-Path $sourceRoot 'manifest.json') -Raw | ConvertFrom-Json
if ($manifest.version -ne $sourceManifest.version) { throw 'Run npm run build before packaging.' }
$outputPath = Join-Path ([IO.Directory]::GetParent($sourceRoot).FullName) 'CodeSnap-Chrome.zip'
$temporaryPath = "$outputPath.tmp"
if (Test-Path -LiteralPath $temporaryPath) { Remove-Item -LiteralPath $temporaryPath }
[IO.Compression.ZipFile]::CreateFromDirectory($distRoot, $temporaryPath)
$zip = [IO.Compression.ZipFile]::OpenRead($temporaryPath)
try {
    if (-not $zip.GetEntry('manifest.json')) { throw 'Manifest must be at archive root.' }
    foreach ($entry in $zip.Entries) {
        if ($entry.FullName -match '(^|/)(node_modules|test|scripts)(/|$)') { throw 'Development files in release ZIP.' }
        $stream = $entry.Open()
        try { $stream.CopyTo([IO.Stream]::Null) } finally { $stream.Dispose() }
    }
} finally { $zip.Dispose() }
Move-Item -LiteralPath $temporaryPath -Destination $outputPath -Force
$outputRoot = [IO.Directory]::GetParent($sourceRoot).FullName
$installedRoot = Join-Path $outputRoot 'CodeSnap-Chrome'
$installedManifestPath = Join-Path $installedRoot 'manifest.json'
if (Test-Path -LiteralPath $installedManifestPath) {
    $installedManifest = Get-Content -LiteralPath $installedManifestPath -Raw | ConvertFrom-Json
    if ($installedManifest.version -ne $manifest.version) {
        $backupRoot = Join-Path $outputRoot ('archive\installed-before-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
        New-Item -ItemType Directory -Force -Path ([IO.Directory]::GetParent($backupRoot).FullName) | Out-Null
        Copy-Item -LiteralPath $installedRoot -Destination $backupRoot -Recurse
    }
}
New-Item -ItemType Directory -Force -Path $installedRoot | Out-Null
foreach ($entry in Get-ChildItem -LiteralPath $distRoot) {
    Copy-Item -LiteralPath $entry.FullName -Destination $installedRoot -Recurse -Force
}
foreach ($file in Get-ChildItem -LiteralPath $distRoot -Recurse -File) {
    $relative = $file.FullName.Substring($distRoot.Length + 1)
    $installedFile = Join-Path $installedRoot $relative
    if ([Convert]::ToBase64String([IO.File]::ReadAllBytes($file.FullName)) -ne [Convert]::ToBase64String([IO.File]::ReadAllBytes($installedFile))) {
        throw "Installed file differs from release: $relative"
    }
}
Write-Output "Installed folder updated: $installedRoot. Reload CodeSnap in Chrome."
Write-Output "Chrome package: $outputPath (version $($manifest.version))"
$sha = [Security.Cryptography.SHA256]::Create()
$fileStream = [IO.File]::OpenRead($outputPath)
try { Write-Output ('SHA256: ' + [BitConverter]::ToString($sha.ComputeHash($fileStream)).Replace('-', '')) }
finally { $fileStream.Dispose(); $sha.Dispose() }
