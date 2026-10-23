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

## Dependency advisory exceptions

CI fails the build on any `high` or `critical` advisory (`pnpm audit --audit-level high`). Advisories
are normally cleared by raising the version, usually through a pin in `pnpm.overrides`. An exception
is added only when no patched release exists at all, and each one is listed here with its rationale
and the condition that retires it.

| Advisory | Package | Why it is excepted | Retired when |
|---|---|---|---|
| [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | `braces` | No patched release exists — 3.0.3 is simultaneously the newest published version and the vulnerable one. It is reached only through `apps/web > tailwindcss > {chokidar, micromatch} > braces`, a build-time devDependency: Tailwind's file watcher and glob matcher never reach the browser bundle or the server runtime. The advisory is stack exhaustion from deeply nested brace patterns, and the only patterns fed to it are this repository's own Tailwind `content` globs, which are authored in-repo and not attacker-controlled. | Tailwind 4, whose engine drops the `chokidar`/`micromatch` chain, or a patched `braces` release. |

Exceptions live in `pnpm.auditConfig.ignoreGhsas` in the root `package.json`. They are deliberately
listed one advisory at a time rather than using a blanket switch such as `--ignore-unfixable`, so a
*new* unpatchable advisory still fails CI and gets a decision instead of passing silently.
`pnpm audit` reports excepted findings as `(N ignored)`, so they stay visible in the output.
