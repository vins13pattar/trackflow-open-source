# TrackFlow v0.1.0-rc.1 release-candidate notes

Status: prepared locally for approval; not tagged, pushed, deployed, or
published.

This first semantic release candidate packages TrackFlow as an evidence-led
multi-tenant GPS platform case study. It adds bounded TCP-ingest forwarding,
mixed-protocol synthetic load generation, directly measured 1,000-socket
before/after artifacts, a synthetic PostgreSQL restore drill, reproducible cost
model, security hardening, benchmark-tier CI, ADRs, and explicit validation
gaps.

## Verified highlights

- 1,000 simultaneous synthetic TCP connections reached in both local runs.
- 991.20 generated packets/s in the after run.
- Teltonika decoder exceptions reduced from 1 to 0 for the identical seeded
  workload.
- Zero sink queue drops in that run.
- Synthetic logical restore completed in 541.22 ms and recovered the marker,
  all 27 migrations, partitioned positions, and forced RLS on 23 tables.
- Local production dependency audit reports zero known vulnerabilities.

## Approval gates

- Observe a green public Security workflow from the candidate commit.
- Review the threat-model assumptions and residual legacy-device risk.
- Decide whether the missing full-platform API/PostgreSQL/SSE and
  multi-instance evidence blocks this candidate.
- If approved, create the annotated tag:
  `git tag -a v0.1.0-rc.1 -m "TrackFlow v0.1.0-rc.1"`.
- Push the branch/tag and publish release notes only with explicit approval.
