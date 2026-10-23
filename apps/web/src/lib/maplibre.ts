// maplibre-gl v6 ships its web worker as a separate module and resolves it
// against `import.meta.url`. After bundling that is the Next chunk URL, so the
// default lookup asks for /_next/static/chunks/maplibre-gl-worker.mjs and 404s
// ("Worker failed to load"). Pointing WORKER_URL at a `new URL(...)` asset
// reference makes the bundler emit the worker and hand back its real URL.
//
// Import this module instead of 'maplibre-gl' directly so the worker URL is
// set once, before any Map is constructed.
import * as maplibregl from 'maplibre-gl';

maplibregl.config.WORKER_URL = new URL(
  'maplibre-gl/dist/maplibre-gl-worker.mjs',
  import.meta.url,
).href;

export { maplibregl };
