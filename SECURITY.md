# Security Policy

## Reporting

Please report suspected vulnerabilities privately to the repository owner instead of opening a public issue.

Include:

- affected route, feature, or file
- reproduction steps
- expected and actual behavior
- any relevant logs with secrets and personal data removed

## Secret Handling

Do not commit real `.env*` files, database dumps, Vercel metadata, runtime logs, screenshots, or customer/order exports. If a credential is accidentally exposed, rotate it immediately in the source system and remove it from git history before publishing.

Production secrets should live in the deployment platform or another secret manager. `.env.example` is the only env file intended to be tracked.
