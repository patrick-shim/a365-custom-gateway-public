# Roadmap and release gates

**Implemented behavior:** [SPEC.md](SPEC.md)
**Connector design:** [Manual Purview refresh](docs/spec/purview-connector-vnext.md)
**Status:** local Windows M1–M5 implemented; live release gates remain unverified;
M6 server/cloud management is deferred.

This document tracks release scope and remaining validation. Current contracts,
state machines, and security invariants belong in the specification and component
guides, rather than being duplicated here. Future work is not an implemented
capability or a commitment to a release date.

The source and documentation are distributed under the [MIT license](LICENSE).
See [CONTRIBUTING.md](CONTRIBUTING.md) for review and validation practices.

## Implemented milestones

| Milestone | Delivered scope | Authoritative detail |
| --- | --- | --- |
| M1 — Contracts and state | Durable connection and operation state, accepted catalog, separate review and enforcement revisions, receipt binding, idempotency, and concurrency | [Data model](docs/architecture/data-model.md), [API contract](docs/api/api-contract.md) |
| M2 — Windows connector | Certificate-backed listener, authenticated commands/results, heartbeat, bounded provider work, replay rejection, and assignment readback | [Catalog host](docs/architecture/purview-catalog-host.md) |
| M3 — Management API | Connect, Reconnect, Manual sync, operation polling, audit, reconciliation, and sanitized failures | [API contract](docs/api/api-contract.md) |
| M4 — Console | Connection diagnostics, explicit management actions, persistent cached selection, authoritative polling, accessible progress, and reviewed individual assignments | [Console design](docs/console/design.md) |
| M5 — Bootstrap and recovery | Shared terminal/React setup, owned-resource migration, logon-only supervision, retained credentials, and durable recovery | [Bootstrap](bootstrap/README.md), [Runtime](docs/runtime/README.md) |

The local implementation has offline regression coverage. Passing those checks
does not establish live tenant enforcement, Windows restart recovery, Docker
restart recovery, or downstream Microsoft-service visibility.

## Current release boundaries

- Bootstrap publishes an initial verified catalog. Subsequent provider reads
  require an explicit accepted management or assignment operation.
- Page loads, GET polling, heartbeat, elapsed time, and ordinary restarts do not
  start new provider work. Recovery may resume accepted work within its deadline.
- The accepted catalog has no age-based expiry and remains available for review
  during management outages. Assignment writes verify the selected policy live.
- Public `revision` retains its deployed legacy digest for review concurrency.
  Internal `definitionRevision`, stored in `AssignedRevision`, identifies
  enforcement semantics independently of target scope and provider timestamps.
- Adding an unrelated reviewed target preserves existing assignments whose exact
  all-accounts scope and enforcement definition remain unchanged. Removal,
  exclusion, narrowing, incompatibility, or material definition changes affect
  only the corresponding assignments and protection revisions.
- Runtime Graph scope and content evaluation remain fail-closed and independent
  of the management listener's availability.
- The Windows listener needs the certificate-owning user's sign-in. It has no
  periodic catalog refresh trigger. Server/cloud connector hosting is not shipped.
- The Python samples and standalone policy-owner utility remain separate from
  Gateway runtime deployment and do not expand its policy-authoring authority.

## M6 — Server/cloud connector (deferred)

Before implementation, demonstrate that the required Purview management operations
and non-interactive authentication are supported on the selected runtime. A
container deployment must not assume that Windows-only certificate-store access
or Security & Compliance PowerShell works on Linux.

A future profile requires:

- a dedicated connector image, service, or managed job;
- a platform secret provider with private material accessible only to the
  connector runtime;
- durable authenticated remote command/result transport with the same tenant,
  operation, generation, request, expiry, and replay boundaries as the local host;
- health, logs, metrics, alerts, and explicit credential-repair procedures;
- reviewed infrastructure, upgrade, rollback, and credential-rotation procedures;
- instance replacement without lost work or duplicate external mutations;
- the same catalog trust, exact-target assignment, and reconciliation contract
  tests as the Windows implementation.

A remote deployment must work without an interactive user session. If provider
compatibility cannot be demonstrated, retain the supported Windows profile and
identify the remote profile as unsupported. Do not introduce a periodic refresh
policy or broaden assignment scope as part of hosting changes.

## M7 — Release validation

The Docker runtime workflow covers public-feed image builds, synthetic local
configuration, readiness, queue consumption, API documentation, and isolated data
service regressions. It does not run Microsoft provisioning, Windows setup, or
live protection checks. Those gates use the operator-selected tenant and dedicated
test resources and remain unverified until separately exercised.

The following evidence is required before claiming the corresponding capability:

| Area | Required validation |
| --- | --- |
| Installation and upgrade | Clean terminal/GUI setup; preserve registrations, keys, assignments, audit history, owned resources, and volumes |
| Recovery | API and connector termination; Docker engine restart; Windows restart followed by the configured user's sign-in |
| Authorization | Each supported reader/operator/administrator role; unauthorized calls; tenant and individual-agent isolation |
| Concurrency | Stale row version, exact idempotent replay, changed-request rejection, concurrent submissions, and dispatcher/submission serialization conflicts |
| Catalog trust | Wrong tenant/signer, malformed or incomplete scope, duplicate IDs, expired or replayed results; retain the previous accepted snapshot on failure |
| Assignment | Exact target, preserved unrelated scope, sibling additions, target removal/narrowing/exclusion, definition changes, legacy-digest compatibility, and unknown mutation readback |
| Protection | Normal allow, synthetic DLP block, independent Prompt Shields settings, and same-blueprint sibling scope; required provider outages fail closed |
| Receipts | Exact agent/prompt/user/time binding, expiry, replay rejection, and invalidation after relevant protection changes |
| UI | Responsive layout, keyboard/focus, reduced motion, duplicate-submit prevention, stable page size, and polling that ends on authoritative terminal state or status-read failure |
| Visibility | Local acceptance, provider export, Agent 365 visibility, Purview ingestion, and Defender ingestion verified separately |
| Source release | License, attribution, public package feeds, dependency security review, sensitive-data review, reproducible checks, working documentation links, and matching API documentation |

Use [tests/README.md](tests/README.md) for executable checks and environment gates.
Use only dedicated test resources for live validation. A missing prerequisite is
a skip, and an unrun integration check remains unverified. Never infer enforcement
or downstream delivery from mock tests, health checks, or an HTTP 202 response.

## Release review

Each change should have a focused diff, matching documentation, and relevant
validation. Promote implemented requirements into `SPEC.md`; keep unsupported
profiles and remaining acceptance gates explicit here. Security, identity,
policy-scope, or migration failures prevent release claims for that boundary.
