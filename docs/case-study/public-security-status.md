# Public Security workflow status

Status checked on 2026-07-28 before this pull request was published.

The latest scheduled `Security` workflow on public `main` is
[run 30243699074](https://github.com/vins13pattar/trackflow-open-source/actions/runs/30243699074)
at commit `5c9ffe29c0d2f3cf023c84254a38b02208b33175`.

| Job | Public result | Cause or evidence |
|---|---|---|
| `dependency-audit` | Failed | The old `main` lockfile still contains high-severity advisories |
| `secret-scan` | Failed | Gitleaks classifies the public RFC 6238 TOTP test vector as `generic-api-key` |
| `sast` | Passed | Public Semgrep job completed successfully |
| `sbom` | Passed | Public CycloneDX SBOM job completed successfully |

The local `codex/trackflow-case-study` branch addresses both failures:

- production dependency audit reports zero known vulnerabilities after the
  dependency and lockfile updates;
- `.gitleaks.toml` allows only the exact public RFC 6238 test vector fingerprint,
  and the full-history scan passes locally;
- Semgrep also passes locally with the workflow rulesets.

This pull request publishes the lockfile remediation and narrowly scoped
Gitleaks fingerprint. Its `Security` run is the approval evidence; after merge,
the push-triggered run on the new `main` commit replaces the stale red result.
Rerunning the old scheduled commit would only retest the unfixed tree.
