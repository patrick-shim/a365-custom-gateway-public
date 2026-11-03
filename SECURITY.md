# Security

## Reporting a vulnerability

Do not publish exploit details, credentials, tenant identifiers, or user content
in a public issue or pull request. If the repository's **Security** tab offers
**Report a vulnerability**, use that private channel. If it is unavailable,
contact Patrick Shim through an established private channel. A public issue may
request a private contact method without disclosing the vulnerability.

Include the affected commit, component, expected security boundary, impact, and
minimal reproduction using synthetic data. Do not send live secrets, private
certificates, support bundles containing credentials, or production prompts.

This project does not publish a guaranteed security response time or a long-term
support policy. Check current dependency advisories and validate the intended
deployment before use.

## Deployment boundary

The included Compose deployment is for local development and evaluation. It uses
loopback bindings and development infrastructure. Production use requires TLS,
network isolation, durable secret management, backups, monitoring, and appropriate
service supervision. Agent 365 Registry preview requires an explicit development
acknowledgement. See [SPEC.md](SPEC.md) and the
[runtime guide](docs/runtime/README.md).

Keep `.bootstrap/`, `bootstrap/config.json`, generated `.env.runtime` files, keys,
tokens, private certificates, and raw interaction content out of source control.
If a secret is exposed, revoke or rotate it through the owning service and review
its use. Removing a file from the latest revision does not remove earlier copies.

The standalone Python weather sample deliberately saves its selected agent ID and
Gateway key in browser `localStorage` for loopback beta use. Use its clear
action after a beta sample. This exception does not apply to the Console or
remote deployments; see the [sample guide](samples/python-foundry-weather-agent/README.md).

Required protection fails closed. Do not disable authentication, authorization,
tenant validation, signature verification, replay protection, or concurrency
checks to work around a deployment problem.
