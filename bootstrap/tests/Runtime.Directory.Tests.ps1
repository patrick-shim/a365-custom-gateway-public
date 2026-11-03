#Requires -Version 7.0
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $IsLinux) {
    Write-Host 'Linux credential-directory link checks skipped on this platform.'
    return
}

Import-Module "$PSScriptRoot/../modules/Runtime.psm1" -Force -DisableNameChecking
& (Get-Module Runtime) {
    $fixture = Join-Path ([IO.Path]::GetTempPath()) "gateway-directory-test-$([guid]::NewGuid().ToString('N'))"
    $script:directoryTestRoot = Join-Path $fixture 'repository'
    $external = Join-Path $fixture 'external'
    [IO.Directory]::CreateDirectory($external) | Out-Null
    [IO.Directory]::CreateDirectory((Join-Path $script:directoryTestRoot 'deploy/runtime')) | Out-Null
    function script:Get-RepositoryRoot { return $script:directoryTestRoot }
    function script:Invoke-BootstrapCommand {
        $script:directoryTestDockerCalled = $true
        throw 'Docker must not run for a linked credential path.'
    }
    $config = @{ runtime = @{ apiHostPort = 5080; consoleHostPort = 5081 } }
    try {
        foreach ($relativePath in @('.bootstrap', '.bootstrap/secrets', '.bootstrap/secrets/blueprint-credentials')) {
            $link = Join-Path $script:directoryTestRoot $relativePath
            [IO.Directory]::CreateDirectory((Split-Path $link -Parent)) | Out-Null
            [IO.Directory]::CreateSymbolicLink($link, $external) | Out-Null
            $script:directoryTestDockerCalled = $false
            $rejected = $false
            try {
                Deploy-GatewayRuntime -Config $config -EnvFile 'unused'
            }
            catch {
                $rejected = $_.Exception.Message -eq 'The runtime credential directory must not contain linked paths.'
            }
            if (-not $rejected -or $script:directoryTestDockerCalled) {
                throw "Linked path was not rejected before Docker: $relativePath"
            }
            [IO.Directory]::Delete($link)
        }
        Write-Host 'All credential-directory ancestors reject symbolic links before Docker executes.'
    }
    finally {
        # The fixture is created here under the system temporary directory.
        [IO.Directory]::Delete($fixture, $true)
    }
}
