param([string]$Destination)
$ErrorActionPreference = 'Stop'
$sourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $Destination) { $Destination = Join-Path ([IO.Directory]::GetParent($sourceRoot).FullName) 'CodeSnap-Mail' }
$Destination = [IO.Path]::GetFullPath($Destination)
$pythonPath = (& python -c 'import sys; print(sys.executable)').Trim()
if (-not (Test-Path -LiteralPath $pythonPath)) { throw 'Python 3 is required for the local mail helper.' }
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
$helperSource = Join-Path $sourceRoot 'native\mail_host.py'
$helperPath = Join-Path $Destination 'mail_host.py'
Copy-Item -LiteralPath $helperSource -Destination $helperPath -Force
$launcherPath = Join-Path $Destination 'CodeSnapMail.exe'
$pythonLiteral = $pythonPath.Replace('"','""')
$helperLiteral = $helperPath.Replace('"','""')
if (-not (Test-Path -LiteralPath $launcherPath)) {
  $launcherSource = @"
using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;
public class CodeSnapMail {
  public static int Main(string[] args) {
    if (args.Length == 0 || args[0] != "chrome-extension://ongiekgidmkffdhgmjmlnjjgoggojoak/") return 1;
    var info = new ProcessStartInfo(@"$pythonLiteral", "-u \"" + @"$helperLiteral" + "\" " + args[0]);
    info.UseShellExecute = false; info.CreateNoWindow = true;
    info.RedirectStandardInput = true; info.RedirectStandardOutput = true; info.RedirectStandardError = true;
    using (var child = Process.Start(info)) {
      var input = Task.Run(() => { try { Console.OpenStandardInput().CopyTo(child.StandardInput.BaseStream); child.StandardInput.Close(); } catch {} });
      var output = child.StandardOutput.BaseStream.CopyToAsync(Console.OpenStandardOutput());
      var errors = child.StandardError.BaseStream.CopyToAsync(Stream.Null);
      child.WaitForExit(); output.Wait(); errors.Wait(); return child.ExitCode;
    }
  }
}
"@
  Add-Type -TypeDefinition $launcherSource -OutputAssembly $launcherPath -OutputType ConsoleApplication
}
$manifestPath = Join-Path $Destination 'com.codesnap.mail.json'
$manifest = @{ name='com.codesnap.mail'; description='CodeSnap local read-only mail'; path=$launcherPath; type='stdio'; allowed_origins=@('chrome-extension://ongiekgidmkffdhgmjmlnjjgoggojoak/') }
[IO.File]::WriteAllText($manifestPath,($manifest | ConvertTo-Json -Depth 4),(New-Object Text.UTF8Encoding($false)))
$registryPath = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.codesnap.mail'
New-Item -Path $registryPath -Force | Out-Null
Set-Item -Path $registryPath -Value $manifestPath
Write-Output 'CodeSnap mail helper installed for this Windows user. Extension ID unchanged.'
