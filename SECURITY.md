# Security policy

## Supported versions

Security fixes are applied to the latest commit on `main`. Older snapshots and forks are not
maintained by the TrackFlow project.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository. Do not open a public issue,
discussion, or pull request containing exploit details, credentials, device identifiers, or customer
location data.

Include the affected component, reproduction steps, impact, and any suggested remediation. You can
expect an initial acknowledgement within seven days. Coordinated disclosure is preferred; please
allow time for a fix and release before publishing details.

## Operational scope

The repository contains local-development defaults only. Operators are responsible for generating
unique production secrets, protecting database and infrastructure credentials, applying migrations,
using TLS at the deployment edge, and following the deployment checklist in [DEPLOY.md](DEPLOY.md).
