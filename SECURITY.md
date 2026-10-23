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

CI fails the build on any `high` or `critical` advisory, in both dependency trees: the pnpm workspace
(`pnpm audit --audit-level high`) and the separate npm tree under `apps/mobile` (`npm run audit:ci`).
Advisories are normally cleared by raising the version, usually through a version pin in `overrides`.
An exception is added only when no patched release exists at all, and each one is listed here with
its rationale and the condition that retires it.

| Advisory | Package | Tree | Why it is excepted | Retired when |
|---|---|---|---|---|
| [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | `braces` | workspace | No patched release exists — 3.0.3 is simultaneously the newest published version and the vulnerable one. It is reached only through `apps/web > tailwindcss > {chokidar, micromatch} > braces`, a build-time devDependency: Tailwind's file watcher and glob matcher never reach the browser bundle or the server runtime. The advisory is stack exhaustion from deeply nested brace patterns, and the only patterns fed to it are this repository's own Tailwind `content` globs, which are authored in-repo and not attacker-controlled. | Tailwind 4, whose engine drops the `chokidar`/`micromatch` chain, or a patched `braces` release. |
| [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | `braces` | `apps/mobile` | Same unpatchable advisory, reached by a different path: `expo > @expo/metro > metro-file-map > micromatch > braces`. That is the Metro bundler's file watcher, which runs on a developer machine and never ships to a device. | A patched `braces` release, or a Metro that drops `micromatch`. |
| [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) | `node-forge` | `apps/mobile` | No patched release exists — the advisory covers `<=1.4.0` and 1.4.0 is the newest published version. It is reached only through `expo > @expo/cli > @expo/code-signing-certificates`, which runs during `expo start` on a developer machine. TrackFlow does not use Expo code signing, so the affected RSA PKCS#1 v1.5 verification path is never invoked, and no `node-forge` code reaches the device. | A patched `node-forge` release, or `@expo/cli` dropping `@expo/code-signing-certificates`. |

Exceptions live in `pnpm.auditConfig.ignoreGhsas` in the root `package.json` for the workspace, and in
`apps/mobile/audit-exceptions.json` for the mobile tree. In both trees they are deliberately listed
one advisory at a time rather than using a blanket switch such as `--ignore-unfixable`, so a *new*
unpatchable advisory still fails CI and gets a decision instead of passing silently. Both report
excepted findings as `(N ignored)` and name them individually, so they stay visible in the output.

`apps/mobile` needs its own gate because npm has no equivalent of pnpm's `auditConfig`. The wrapper
is `apps/mobile/scripts/audit-ci.mjs`: it runs `npm audit --json` and excepts a finding only when
*every* advisory reachable through its dependents is allowlisted, so a package that is affected by
both an excepted and an unexcepted advisory still fails.
