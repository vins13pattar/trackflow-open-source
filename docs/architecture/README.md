# TrackFlow architecture diagrams

Six interactive, self-contained HTML diagrams of the TrackFlow platform, generated with
[archify](https://github.com/tt-a1i/archify). Each file is standalone — open it in a browser, no
server or network access needed. The [Mermaid overview in `../ARCHITECTURE.md`](../ARCHITECTURE.md)
stays the quick-read version; these are the detailed companions.

| Diagram | Type | What it answers |
|---|---|---|
| [`system.html`](system.html) | architecture | Which services exist, what they own, and how they talk |
| [`position-hot-path.html`](position-hot-path.html) | sequence | What happens between a GPS frame and a marker moving on the map |
| [`tenant-isolation.html`](tenant-isolation.html) | workflow | How a credential becomes a tenant-scoped Postgres transaction |
| [`telemetry-lineage.html`](telemetry-lineage.html) | dataflow | Where a fix is stored, what is derived from it, and when it ages out |
| [`device-session.html`](device-session.html) | lifecycle | The states a tracker connection moves through, including refusals |
| [`deployment.html`](deployment.html) | architecture | Where each service runs in production and what it depends on |

## Viewing

Open any file directly (`open docs/architecture/system.html`), or from a checkout served over HTTP.
Every diagram ships with the same reader controls:

- **Light / Dark** and a visual-preset switcher
- **Guided views** — three curated chapters per diagram that dim everything but one storyline
- **Pan, zoom, search and focus**, plus relationship tracing
- **Export** to PNG, JPEG, WebP or SVG
- **Present** mode for walkthroughs

Nodes carrying a `src` badge link to the file in this repository that backs the claim, pinned to the
revision the diagram was generated from.

## Regenerating

Sources live in [`src/`](src/) as small typed JSON specifications — those are the files to edit, not
the HTML. With the archify skill available:

```bash
# from the archify skill package directory
node bin/archify.mjs validate <type> <repo>/docs/architecture/src/<name>.<type>.json \
  --quality showcase --repo-root <repo> --json

node bin/archify.mjs deliver <type> <repo>/docs/architecture/src/<name>.<type>.json \
  <repo>/docs/architecture/<name>.html --quality showcase --repo-root <repo> --json
```

`<type>` is one of `architecture`, `sequence`, `workflow`, `dataflow`, `lifecycle` — it matches the
middle segment of the source filename.

Two diagrams (`system`, `deployment`) declare `meta.repository` and cite source paths, so they need
`--repo-root` and will fail if a cited path no longer exists at the pinned revision. That is
deliberate: it makes a stale diagram loud rather than quietly wrong. When code moves, update the
`sources` entries and bump `meta.repository.revision`.

All six are authored at archify's `showcase` quality profile: 9/9 artifact checks, zero composition
errors, zero warnings, and browser-verified containment and text legibility at 1440×900, 1600×1000,
1920×1080 and 2048×1320.
