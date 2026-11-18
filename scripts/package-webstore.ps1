$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$sourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$distRoot = Join-Path $sourceRoot 'dist'
$sourceManifest = Get-Content -LiteralPath (Join-Path $sourceRoot 'manifest.json') -Raw | ConvertFrom-Json
$distManifest = Get-Content -LiteralPath (Join-Path $distRoot 'manifest.json') -Raw | ConvertFrom-Json
if ($distManifest.version -ne $sourceManifest.version) { throw 'Run npm run build before packaging for Web Store.' }

$stageRoot = Join-Path $sourceRoot 'dist-webstore-tmp'
if (Test-Path -LiteralPath $stageRoot) { Remove-Item -LiteralPath $stageRoot -Recurse -Force }
Copy-Item -LiteralPath $distRoot -Destination $stageRoot -Recurse

# Strip "key" from manifest.json because Chrome Web Store rejects first-time uploads containing a "key" field.
$manifestObj = Get-Content -LiteralPath (Join-Path $stageRoot 'manifest.json') -Raw | ConvertFrom-Json
$manifestObj.PSObject.Properties.Remove('key')
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$cleanJson = ($manifestObj | ConvertTo-Json -Depth 16) -replace "`r`n", "`n"
[IO.File]::WriteAllText((Join-Path $stageRoot 'manifest.json'), $cleanJson + "`n", $utf8NoBom)

$outputPath = Join-Path ([IO.Directory]::GetParent($sourceRoot).FullName) 'CodeSnap-ChromeWebStore.zip'
$temporaryPath = "$outputPath.tmp"
if (Test-Path -LiteralPath $temporaryPath) { Remove-Item -LiteralPath $temporaryPath -Force }
[IO.Compression.ZipFile]::CreateFromDirectory($stageRoot, $temporaryPath)
Remove-Item -LiteralPath $stageRoot -Recurse -Force

$zip = [IO.Compression.ZipFile]::OpenRead($temporaryPath)
try {
    $manifestEntry = $zip.GetEntry('manifest.json')
    if (-not $manifestEntry) { throw 'Manifest must be at archive root.' }
    $reader = New-Object System.IO.StreamReader($manifestEntry.Open())
    try {
        $packagedManifest = $reader.ReadToEnd() | ConvertFrom-Json
        if ($packagedManifest.PSObject.Properties.Name -contains 'key') {
            throw 'Web Store package manifest must not contain "key".'
        }
    } finally { $reader.Dispose() }
    foreach ($entry in $zip.Entries) {
        if ($entry.FullName -match '(^|/)(node_modules|test|scripts)(/|$)|Owner-Keys|Pro-Keys|private-key') {
            throw "Disallowed file in Web Store ZIP: $($entry.FullName)"
        }
    }
} finally { $zip.Dispose() }

Move-Item -LiteralPath $temporaryPath -Destination $outputPath -Force
Write-Output "Chrome Web Store package: $outputPath (version $($sourceManifest.version), key-stripped)"
$sha = [Security.Cryptography.SHA256]::Create()
$fileStream = [IO.File]::OpenRead($outputPath)
try { Write-Output ('SHA256: ' + [BitConverter]::ToString($sha.ComputeHash($fileStream)).Replace('-', '')) }
finally { $fileStream.Dispose(); $sha.Dispose() }
