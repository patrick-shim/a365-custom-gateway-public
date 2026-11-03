# Contributing

**Authors:** [Patrick Shim](mailto:patrickshim@microsoft.com) (Senior Sales Advisor, AI Security GBB, Microsoft Corp.) and [Hyuna Kim](mailto:hyunakim@microsoft.com) (Security Solution Engineer at Microsoft Korea)

A365 Custom Gateway is co-authored by Patrick Shim and Hyuna Kim and distributed
under the [MIT license](LICENSE). Contributions, technical reviews, and bug reports from
Microsoft and the wider community are welcome. Contributions are provided under
the same license; retain applicable copyright and third-party notices.

Read the [README](README.md) for setup, [SPEC.md](SPEC.md) for implemented
requirements, and the [documentation index](docs/README.md) for component guides.
The [roadmap](SPEC-VNEXT.md) distinguishes implemented work from deferred scope.

## Development setup

Use PowerShell 7, the .NET SDK selected by `global.json`, and Node.js 20 for the
frontend packages. Docker and Microsoft tenant access are needed for deployment,
not for the offline checks below. Python 3.11 or later is optional for the Python
samples. Run commands from the repository root unless a guide says otherwise.

```powershell
dotnet restore Gateway.slnx
npm --prefix web/console ci
npm --prefix web/setup ci
dotnet build Gateway.slnx --no-restore
```

Use the root `Gateway.slnx` to open all runtime, setup, sample, and test projects.
For frontend development, see the [Console guide](web/console/README.md).
Package sources are public. If your organization requires a mirror, configure it
locally or pass a restore-time override; do not commit private feed credentials.
Preserve security patch overrides when updating transitive dependencies.

## Propose a change

For a bug report, include the source revision, expected and actual behavior,
reproduction steps, and sanitized error codes. For a larger design change,
describe the affected requirement and compatibility impact before implementation.
Report vulnerabilities privately using [SECURITY.md](SECURITY.md).

Keep pull requests focused. Explain the resulting behavior, why the change is
needed, checks performed, and any unverified integration boundary. Include a
screenshot for a visible UI change and use synthetic data throughout.

## Source and architecture

- Preserve unrelated work and inspect the complete affected path before editing:
  UI, API contract, handler, domain, persistence, provider, and recovery behavior.
- Keep controllers thin. Use application handlers for orchestration, domain types
  for legal state, and adapters for provider or persistence implementation.
- Keep public DTOs in `Gateway.Contracts`. Update generated OpenAPI and the
  [API guide](docs/api/api-contract.md) when wire contracts change.
- Use the transactional outbox or another specified durable mechanism for side
  effects after a database commit. Queue consumers must tolerate redelivery.
- Preserve exact request-hash idempotency and optimistic concurrency. Reconcile
  unknown external mutation outcomes before considering another write.
- Follow `.editorconfig`. Prefer clear names, short methods with a single purpose,
  and explicit typed state. Comments should explain invariants, ordering, security
  boundaries, or provider constraints rather than restate the code.
- Use React, TypeScript, Fluent UI, and existing design tokens for the Console and
  setup UI. Preserve responsive layouts, keyboard focus, reduced motion, theme
  persistence, and duplicate-submission protection.
- Keep terminology consistent: Console, runtime, Gateway API, Agent 365, and
  Purview catalog host. Confirm routes and field names from source.

## Protection and lifecycle invariants

The complete requirements are in [SPEC.md](SPEC.md). In particular:

- Each external agent has an individual Entra identity and a registration-bound
  Gateway credential. Shared blueprints never replace individual policy targets.
- Evaluate the exact prompt before an external model call. Required protection
  fails closed; an unavailable provider is not an allow.
- Receipts are short-lived, single-use, and bound to the exact agent, prompt,
  interaction, user, time, protection revision, and policy evidence.
- Prompt Shields and Purview remain independently configurable and observable.
  Assignment, synchronization, enforcement, export, and destination visibility are
  distinct states; HTTP acceptance does not prove downstream visibility.
- Purview policy authors own policy content. The Gateway may add only a reviewed
  individual target and must preserve unrelated targets, exclusions, rules,
  classifiers, actions, and mode.
- Keep public catalog `revision` for review concurrency separate from internal
  `definitionRevision` for durable enforcement. Preserve the deployed legacy
  public digest and unknown nested-array order. See the
  [policy guide](docs/architecture/purview-policy-consumption.md).
- Disable affects Gateway admission only. Permanent deregistration removes only
  the verified Registry entry, retaining Entra identities, shared blueprints,
  policies, tombstones, and audit history.
- Terminal and graphical setup share the configuration schema and PowerShell
  engine. Preserve the Compose project name, volumes, `.bootstrap/`, and generated
  runtime configuration across normal rebuilds.
- Missing credentials, ambiguous ownership, or unknown external outcomes require
  explicit reconciliation. Never silently rotate credentials or adopt resources
  by name. Bootstrap has no implicit destroy path.

The loopback Python beta sample has explicitly scoped comparison controls and
browser credential persistence. Preserve their defaults, validation, disclosure,
clear action, and unevaluated labels. Do not extend these exceptions to the
Console or production deployments.

## Documentation

Keep documentation in present tense for implemented behavior. Mark future work
as deferred. Use one authoritative description and link to it instead of copying
long sections into multiple guides.

| Change | Documentation to review |
| --- | --- |
| Product behavior or architecture | `SPEC.md`, `README.md`, relevant architecture guide |
| HTTP contract or authentication | `docs/api/api-contract.md`, `docs/api/openapi.yaml` |
| Bootstrap configuration or lifecycle | `bootstrap/README.md`, schema and example |
| Operations or recovery | `docs/runtime/README.md`, `operations/README.md` |
| Console behavior | `docs/console/design.md` |
| Contributor practices | This guide |
| Deferred scope | `SPEC-VNEXT.md` |

## Validation

Run the checks affected by the change. The local baseline is:

```powershell
dotnet build Gateway.slnx
pwsh -NoProfile -File tools/scripts/maintenance/Test-RepositoryLayout.ps1
npm --prefix web/console run check:reachability
npm --prefix web/console run check:proxy
npm --prefix web/console run typecheck
npm --prefix web/console test
npm --prefix web/setup test
git diff --check
```

The .NET regression projects use `dotnet run`, not `dotnet test`. Follow
[tests/README.md](tests/README.md) for the full matrix and prerequisite gates.
Test security boundaries, state transitions, provider reconciliation, concurrency,
and regressions with material impact; avoid tests that only repeat static markup.

For API changes, start the API, regenerate OpenAPI, and run
`tools/scripts/diagnostics/Test-GatewayApiDocumentation.ps1`. For lifecycle
changes, validate Docker recovery and Windows scheduled-task recovery separately.
For protection changes, validate normal allow, provider-specific block, and
same-blueprint sibling behavior. Purview reconciliation checks must distinguish
unrelated target additions from removal, exclusion, narrowing, or definition
changes affecting an existing assignment.

Live checks require explicitly selected test resources. Database and queue tests
must isolate their writes and clean up only resources they created. Missing
dependencies are skipped, not passed. Never point a destructive test at production.

## Repository hygiene and review

- Commit source, tests, reusable tooling, and public documentation only. Keep
  generated files, local credentials, deployment snapshots, logs, screenshots,
  scratch files, and editor state out of the source tree.
- Never commit keys, tokens, client secrets, private certificates, production
  connection strings, raw prompts, responses, or personal data. Keep diagnostics
  sanitized and use correlation IDs for investigation.
- Put reusable scripts under `tools/scripts/setup`, `diagnostics`, or `maintenance`.
  Remove obsolete files only after checking source, build, bootstrap, tests, and
  documentation references.
- Review the final diff for accidental behavior changes, broken links, generated
  artifacts, and unrelated edits. Preserve shared Git history.
- A change is ready when the requirements, implementation, documentation, and
  relevant checks agree, with remaining live validation clearly identified.
