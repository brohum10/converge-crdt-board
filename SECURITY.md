# Security Policy

Converge accepts WebSocket clients and persists untrusted operations. Authentication bypasses, cross-board data exposure, denial of service, injection, unsafe replay, and authorization issues should be reported privately.

Use GitHub's **Security → Report a vulnerability** flow when available. Otherwise, contact the maintainer through the GitHub profile. Include a minimal reproduction, affected configuration, impact, and mitigation ideas; do not include live credentials or private board contents.

The current `main` branch is supported. The demo intentionally omits a complete identity system, so internet-facing deployments must add authentication, authorization, TLS, and production secret management.
