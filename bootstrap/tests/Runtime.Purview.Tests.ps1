#Requires -Version 7.0
$ErrorActionPreference = 'Stop'
Import-Module "$PSScriptRoot/../modules/Entra.psm1" -Force -DisableNameChecking
Import-Module "$PSScriptRoot/../modules/RuntimePurview.psm1" -Force -DisableNameChecking
$module = Get-Module RuntimePurview
& $module {
    $script:tenant = [guid]::NewGuid()
    function script:Invoke-AzTsv { return $script:tenant.ToString() }
    function script:Get-ServicePrincipalByAppId { throw 'Tenant check failed to stop provider discovery.' }
    try {
        Ensure-RuntimePurviewManagementIdentity -TenantId ([guid]::NewGuid()) -DeploymentOwnershipId ([guid]::NewGuid()) -DeploymentName test -OwnerObjectId ([guid]::NewGuid())
        throw 'Wrong tenant accepted.'
    } catch {
        if ($_.Exception.Message -notmatch 'signed-in tenant does not match|Windows catalog host') { throw }
    }
    # Simulate provider projections: role references and role objects use different
    # canonical paths in SCC. Only this exact built-in DLP role may be accepted.
    $script:identity = @{
        tenantId = $script:tenant.ToString()
        applicationId = [guid]::NewGuid().ToString(); servicePrincipalId = [guid]::NewGuid().ToString()
        deploymentOwnershipId = [guid]::NewGuid().ToString(); roleGroupName = 'test-role-group'; displayName = 'test'
    }
    $script:extraRole = $false
    $script:extraMember = $false
    $script:mutationCount = 0
    $script:disconnects = 0
    function script:Import-Module { }
    $script:connected = $false
    function script:Connect-IPPSSession { $script:connected = $true }
    function script:Get-ConnectionInformation { if ($script:connected) { [pscustomobject]@{ TenantID=$script:tenant; IsEopSession=$true; State='Connected'; TokenStatus='Active' } } }
    function script:Disconnect-ExchangeOnline { $script:disconnects++; $script:connected=$false }
    function script:Get-ServicePrincipal { return [pscustomobject]@{ AppId=$script:identity.applicationId; ObjectId=$script:identity.servicePrincipalId; Identity="org/Configuration/$($script:identity.servicePrincipalId)" } }
    function script:Get-ManagementRole { return [pscustomobject]@{ RoleType='DLPComplianceManagement'; IsRootRole=$true; Identity='org/Configuration/RBAC/Roles/DLP Compliance Management' } }
    function script:Get-RoleGroup {
        [pscustomobject]@{
            Name=$script:identity.roleGroupName; DisplayName=$script:identity.roleGroupName; Guid=[guid]::NewGuid()
            Description="Gateway existing-policy scope management; deployment $($script:identity.deploymentOwnershipId)"
            Roles=@('org/DLP Compliance Management'; if ($script:extraRole) { 'org/Organization Management' })
        }
    }
    function script:Get-RoleGroupMember {
        [pscustomobject]@{ Identity="org/Configuration/$($script:identity.servicePrincipalId)"; Guid=$script:identity.servicePrincipalId }
        if ($script:extraMember) { [pscustomobject]@{ Identity='org/Configuration/unrelated' } }
    }
    function script:New-ServicePrincipal { $script:mutationCount++; throw 'Unexpected mutation' }
    function script:New-RoleGroup { $script:mutationCount++; throw 'Unexpected mutation' }
    function script:Set-RoleGroup { $script:mutationCount++; throw 'Unexpected mutation' }
    function script:Add-RoleGroupMember { $script:mutationCount++; throw 'Unexpected mutation' }
    Set-RuntimePurviewManagementRoleGroup -Identity $script:identity -AdministratorUpn 'operator@example.com'
    $script:extraRole = $true
    try {
        Set-RuntimePurviewManagementRoleGroup -Identity $script:identity -AdministratorUpn 'operator@example.com'
        throw 'Unexpected role accepted'
    } catch { if ($_.Exception.Message -ne 'The dedicated Purview role group has unexpected ownership or roles.') { throw } }
    $script:extraRole = $false
    $script:extraMember = $true
    try {
        Set-RuntimePurviewManagementRoleGroup -Identity $script:identity -AdministratorUpn 'operator@example.com'
        throw 'Unexpected member accepted'
    } catch { if ($_.Exception.Message -ne 'The dedicated Purview role group has unexpected members.') { throw } }
    if ($script:mutationCount -ne 0 -or $script:disconnects -ne 3) { throw 'Reconciliation changed a provider object or leaked a connection.' }
}

& $module {
    $script:testRoot = Join-Path ([IO.Path]::GetTempPath()) ('a365gw-purview-task-' + [guid]::NewGuid().ToString('N'))
    $script:registeredTask = $null
    $script:startedTask = $null
    $script:publishCalls = 0
    $script:dotnetPublishCalls = 0
    $script:triggerCalls = 0
    $script:ownedTask = $null
    $script:disabledTask = $null
    function script:Get-RepositoryRoot { $script:testRoot }
    function script:Get-ScheduledTask { return $script:ownedTask }
    function script:Disable-ScheduledTask { param([string]$TaskName) $script:disabledTask = $TaskName }
    function script:Invoke-BootstrapCommand {
        param([string]$FilePath, [object[]]$ArgumentList)
        if ($FilePath -ne 'dotnet') { throw "Unexpected bootstrap command: $FilePath" }
        if ($ArgumentList[0] -eq 'publish') {
            if ($script:ownedTask -and $script:disabledTask -ne $script:registeredTask.TaskName) { throw 'Recovery was not suspended before binary replacement.' }
            $script:dotnetPublishCalls++; return ''
        }
        if ([IO.Path]::GetFileName([string]$ArgumentList[0]) -eq 'Gateway.Purview.CatalogHost.dll') {
            if ($ArgumentList.Count -ne 8 -or $ArgumentList[1] -ne '--publish-bootstrap') {
                throw 'Bootstrap catalog publication did not use the synchronous managed assembly mode.'
            }
            $script:publishCalls++
            return ''
        }
        throw "Unexpected dotnet command: $($ArgumentList -join ' ')"
    }
    function script:New-ScheduledTaskAction {
        param([string]$Execute, [string]$Argument, [string]$WorkingDirectory)
        [pscustomobject]@{ Execute=$Execute; Arguments=$Argument; WorkingDirectory=$WorkingDirectory }
    }
    function script:New-ScheduledTaskTrigger {
        param([switch]$AtLogOn, [string]$User, [switch]$Once, [DateTime]$At, [TimeSpan]$RepetitionInterval)
        $script:triggerCalls++
        if ($AtLogOn -and -not $Once -and -not [string]::IsNullOrWhiteSpace($User)) {
            return [pscustomobject]@{ AtLogOn=$true; User=$User }
        }
        if ($Once -and -not $AtLogOn -and $RepetitionInterval -eq [TimeSpan]::FromMinutes(1) -and $At -gt (Get-Date)) {
            return [pscustomobject]@{ AtLogOn=$false; Once=$true; RepetitionInterval=$RepetitionInterval }
        }
        throw 'Expected a logon trigger or a one-minute windowless recovery trigger.'
    }
    function script:New-ScheduledTaskPrincipal {
        param([string]$UserId, [string]$LogonType, [string]$RunLevel)
        [pscustomobject]@{ UserId=$UserId; LogonType=$LogonType; RunLevel=$RunLevel }
    }
    function script:New-ScheduledTaskSettingsSet {
        param(
            [switch]$StartWhenAvailable,
            [switch]$AllowStartIfOnBatteries,
            [switch]$DontStopIfGoingOnBatteries,
            [TimeSpan]$ExecutionTimeLimit,
            [string]$MultipleInstances,
            [int]$RestartCount,
            [TimeSpan]$RestartInterval)
        [pscustomobject]@{
            StartWhenAvailable=$StartWhenAvailable; ExecutionTimeLimit=$ExecutionTimeLimit
            MultipleInstances=$MultipleInstances; RestartCount=$RestartCount; RestartInterval=$RestartInterval
        }
    }
    function script:Register-ScheduledTask {
        param(
            [string]$TaskName, $Action, $Trigger, $Principal, $Settings,
            [string]$Description, [switch]$Force)
        $script:registeredTask = [pscustomobject]@{
            TaskName=$TaskName; Action=$Action; Trigger=@($Trigger); Principal=$Principal
            Settings=$Settings; Description=$Description; Force=$Force
        }
    }
    function script:Start-ScheduledTask { param([string]$TaskName) $script:startedTask = $TaskName }

    try {
        $identity = [ordered]@{
            tenantId=[guid]::NewGuid().ToString('D'); applicationId=[guid]::NewGuid().ToString('D')
            organization='example.onmicrosoft.com'; certificateThumbprint=('A' * 40); accessVerified=$true
        }
        $catalog = [ordered]@{ tenantId=$identity.tenantId; retrievedAtUtc=[DateTimeOffset]::UtcNow.ToString('O'); items=@() }
        $result = Start-RuntimePurviewCatalogHost -Identity $identity -InitialCatalog $catalog
        if ($script:dotnetPublishCalls -ne 1 -or $script:publishCalls -ne 1) { throw 'Listener setup did not build once and synchronously publish exactly one already-verified bootstrap catalog.' }
        if ($script:triggerCalls -ne 2 -or $null -eq $script:registeredTask -or
            $script:registeredTask.Trigger.Count -ne 2 -or -not $script:registeredTask.Trigger[0].AtLogOn -or
            $null -ne $script:registeredTask.Trigger[0].PSObject.Properties['Repetition'] -or
            -not $script:registeredTask.Trigger[1].Once -or
            $script:registeredTask.Trigger[1].RepetitionInterval -ne [TimeSpan]::FromMinutes(1)) {
            throw 'Purview listener task must have one logon trigger and one recovery trigger.'
        }
        if ([IO.Path]::GetFileName([string]$script:registeredTask.Action.Execute) -cne 'Gateway.Purview.CatalogHost.exe' -or
            $script:registeredTask.Action.Arguments -match '--once|--publish-bootstrap|Repetition|Gateway\.Purview\.CatalogHost\.dll' -or
            $script:registeredTask.Action.Arguments -notmatch [regex]::Escape('.bootstrap\purview-connector')) {
            throw 'Purview listener action must use only the windowless apphost and include its connector queue.'
        }
        if ($script:registeredTask.Settings.ExecutionTimeLimit -ne [TimeSpan]::Zero -or
            $script:registeredTask.Settings.MultipleInstances -ne 'IgnoreNew' -or
            $script:registeredTask.Settings.RestartCount -ne 3) {
            throw 'Purview listener lifetime or recovery settings are incorrect.'
        }
        if ($script:startedTask -ne $script:registeredTask.TaskName -or $result.mode -ne 'logon-listener' -or
            [guid]$result.connectorInstanceId -eq [guid]::Empty -or $identity.connectorInstanceId -ne $result.connectorInstanceId) {
            throw 'Purview listener identity or startup readback is incomplete.'
        }
        $keyPath = Join-Path $script:testRoot '.bootstrap/secrets/purview-assignment.key'
        if ([Convert]::FromBase64String([IO.File]::ReadAllText($keyPath).Trim()).Length -ne 32) {
            throw 'Purview connector transport key was not preserved as a 32-byte secret.'
        }
        $keyBefore = [IO.File]::ReadAllText($keyPath)
        $script:ownedTask = [pscustomobject]@{
            Actions=@($script:registeredTask.Action); Principal=$script:registeredTask.Principal
            Description=$script:registeredTask.Description; State='Ready'
        }
        $updated = Start-RuntimePurviewCatalogHost -Identity $identity -InitialCatalog $catalog
        if ($script:disabledTask -ne $result.taskName -or $script:startedTask -ne $result.taskName -or
            $updated.connectorInstanceId -ne $result.connectorInstanceId -or
            [IO.File]::ReadAllText($keyPath) -cne $keyBefore) {
            throw 'Owned listener update changed identity/key or failed to suspend and restore supervision.'
        }

    } finally {
        if (Test-Path -LiteralPath $script:testRoot) { Remove-Item -LiteralPath $script:testRoot -Recurse -Force }
    }
}

$catalogHostProject = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../../src/Gateway.Purview.CatalogHost/Gateway.Purview.CatalogHost.csproj') -Raw
if ($catalogHostProject -notmatch '<OutputType>WinExe</OutputType>' -or $catalogHostProject -match '<OutputType>Exe</OutputType>') {
    throw 'Purview listener apphost must use the Windows GUI subsystem so Task Scheduler cannot open a console window.'
}

'Runtime Purview tenant, exact role/member boundary, windowless supervised listener, initial publication and reconciliation checks passed (no network).'
