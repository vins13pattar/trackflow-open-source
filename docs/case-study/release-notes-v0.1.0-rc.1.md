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
- Authenticated local API read/write and PostgreSQL RLS/query-plan benchmarks
  now publish raw samples, percentiles, cleanup evidence, and CI budgets.
- The local real-Redis realtime run delivered 27,620/27,620 healthy events with
  zero loss, duplicates, or cross-tenant delivery; the stalled mailbox was
  isolated at its 257th event and all Redis subscribers were cleaned up.
- Local production dependency audit reports zero known vulnerabilities.

## Approval gates

- Observe a green public Security workflow from the candidate commit.
- Review the threat-model assumptions and residual legacy-device risk.
- Decide whether missing domain-workflow, hosted multi-instance, physical-device,
  and external-provider evidence blocks this candidate.
- If approved, create the annotated tag:
  `git tag -a v0.1.0-rc.1 -m "TrackFlow v0.1.0-rc.1"`.
- Push the branch/tag and publish release notes only with explicit approval.
