# Runtime gateway bootstrap

**Authors:** Patrick Shim and [Hyuna Kim](mailto:hyunakim@microsoft.com) (Security Solution Engineer at Microsoft Korea)

Bootstrap installs the gateway on Docker Compose: PostgreSQL, RabbitMQ,
S3-compatible storage, the C# API and worker, and the React Console. The base
stack also starts an unwired Vault development container; current application
secrets come from ignored bootstrap files and generated runtime configuration.
Microsoft Entra, Graph, Agent 365, Purview and Prompt Shields remain product APIs.

## Guided installation

Run `gateway.cmd init` on Windows or `./gateway init` elsewhere. `setup` is an
alias for this guided terminal flow. `gateway.cmd gui` (or `./gateway gui`) opens
the React installer in a browser on this computer. Keep its terminal open.
Review the generated non-secret configuration, then run `gateway plan` and
`gateway apply`, or use `gateway up` for the combined guided flow.

Every setup explicitly asks about Content Safety and the Purview connection.
Content Safety collects the subscription, region, resource group, SKU and cost
acknowledgement. Purview collects authorization for a dedicated certificate
identity and DLP management permissions, then provisions and verifies that access
under the Windows catalog-host account. No capability preset skips these choices.
Bootstrap does not collect SIT names or create policies, classifiers or rules.

When development Registry preview is explicitly enabled and acknowledged, bootstrap
also declares and grants exactly `AgentRegistration.Read.All` and
`AgentRegistration.ReadWrite.All` as delegated Graph permissions on the Gateway
API, then verifies the tenant-wide consent readback. Console sign-in alone cannot
grant these permissions. `gateway up` repairs an absent or incomplete grant for
the same owned API; unrelated permissions or ambiguous grants stop setup.

The seed blueprint's development credential is keyed by its application ID.
For Console-created blueprints, the worker verifies ownership, creates one
individual development credential and stores it under the ignored
`.bootstrap/secrets/blueprint-credentials` directory. The API mounts that directory
read-only. A missing saved credential requires explicit repair, never automatic
rotation. A seed secret must never be reused for another blueprint. Entra rejects
ordinary app tokens as AAD-issued federation assertions (`AADSTS700226`); local
runtime authentication does not pretend the workload app is a managed identity.

React Setup offers the same configuration fields, validation, reviewed plan,
provisioning, progress and verification through the same PowerShell engine. Its
local C# host uses a one-time link, session isolation and request validation.
No browser page performs its own cloud provisioning. Initial tenant identity,
certificate, role, transport, and first catalog verification stay in bootstrap.
The Console uses that exact owned configuration for operational Connect,
Manual sync, diagnostics, policy selection, and individual-agent assignment.

Configuration must explicitly select `deployProfile: runtime`. The
[example](config.example.runtime.json) documents fields; the
[schema](config.schema.json) rejects legacy profiles. Existing configuration and
credentials are preserved. On Linux, Compose runs a short-lived root helper before
service startup to set ownership and mode 0700 on the dedicated blueprint-credential
directory for the image's non-root application user. It does not recursively change
ownership or alter existing credential files. Linked directory paths are rejected,
and the API mount remains read-only. Do not place tokens, passwords, private certificates,
Gateway keys, or prompt content in checked-in configuration.

## Commands

The [local manual-refresh design](../docs/spec/purview-connector-vnext.md) uses one
background Windows listener and administrator-triggered Connect/Manual sync
operations. Initial setup performs one verified catalog read and hands that exact
result to the listener for publication; it does not make a second read. The API
imports that signed bootstrap catalog once when connector tables are empty, then
uses accepted PostgreSQL snapshots as authority.

Bootstrap preserves the existing owned management application, certificate,
role-group membership, transport key, stable connector instance ID, assignments,
and runtime volumes. It replaces the old repeating task only after verifying exact
task ownership. The installed task starts the headless listener at that user's
logon, has no periodic trigger, and retries listener failure without authorizing a
new catalog read. Idle heartbeat and restart alone do not contact Purview; recovery
may resume an already accepted, unexpired operation. M6
server/cloud connector configuration remains on hold.

| Command | Behavior |
| --- | --- |
| `init`, `setup` | Guided terminal configuration |
| `gui` | React graphical configuration, plan, install and verification |
| `doctor` | Read-only runtime tools and product-session checks |
| `plan` | Review source-bound Compose and Microsoft product setup operations |
| `apply` | Apply the accepted plan for the exact current source/configuration |
| `up` | Configure if needed, plan, confirm, apply and verify |
| `status` | Read persisted runtime checkpoints; not a live readiness claim |
| `verify` | Check API, readiness, Console configuration and API proxy |
| `open` | Open the recorded Console endpoint |
| `diagnose` | Export sanitized diagnostics |

Known interrupted checkpoints are reconciled through exact ownership readback.
Concurrent terminal/GUI installers are blocked by one checkout lock. Missing
secrets, unexpected credentials or unknown checkpoints stop setup; credentials
are never silently rotated. No destroy command is provided.

## Validation

After the source checks pass, terminal acceptance uses:

```powershell
.\gateway.cmd init
.\gateway.cmd plan
.\gateway.cmd up
.\gateway.cmd verify
```

Graphical acceptance starts with `.\gateway.cmd gui`. Both interfaces use the
same engine. Live per-agent allow/block and sibling isolation must also pass;
installer health alone does not establish policy enforcement.

### Reviewed manager applications

Review the manager application IDs against Microsoft's current
[Agent 365 CLI authentication constants](https://github.com/microsoft/Agent365-devTools/blob/main/src/Microsoft.Agents.A365.DevTools.Cli/Constants/AuthenticationConstants.cs)
and read back the corresponding first-party service principal in the intended
tenant. Enter only the IDs reviewed for this deployment. Blueprint discovery alone
does not establish that an application should receive manager authority.

## Build identity

Application image builds attach the Git source revision to OCI labels and the
Console footer. A dirty working tree is labeled with a dirty suffix. For exact
public/local parity, build from the clean published commit and retain the existing
installation's Compose project, environment file and bootstrap directories.

Successful main-branch validation publishes short-lived `runtime-images-X64` and `runtime-images-ARM64` artifacts
containing native tested Gateway images and the optional weather MCP image. Their revision
labels identify the public commit; it contains no installation configuration.
This supports installing the same tested images where local package feeds are
unreachable. Runtime credentials and tenant configuration remain local.

The Windows Purview catalog host starts a single windowless background listener at
the certificate-owning user's Windows sign-in. A one-minute recovery trigger
restores it if stopped and IgnoreNew prevents duplicate listeners. Provider
PowerShell children are also windowless; recovery never schedules catalog reads. The Console shows its
heartbeat. See [background lifetime and recovery](../docs/runtime/README.md#quiet-background-connector).

Select the artifact matching the Docker host architecture. The workflow checks
x64 and ARM64 independently; do not rely on x64 emulation for the .NET runtime.
