import { Hono } from 'hono';
import { openapi } from '../openapi.js';

export const docsRoutes = new Hono();

docsRoutes.get('/openapi.json', (c) => c.json(openapi));

docsRoutes.get('/docs', (c) =>
  c.html(
    `<!doctype html><html><head><title>TrackFlow API</title><meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" /></head>
    <body><script id="api-reference" data-url="/openapi.json"></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script></body></html>`,
  ),
);
