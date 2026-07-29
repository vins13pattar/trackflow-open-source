import { spawn } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const children = [];
let cleaning = false;

function child(command, args, env = {}) {
  const processHandle = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
  children.push(processHandle);
  return processHandle;
}

async function waitFor(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Startup race.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function wait(processHandle) {
  return new Promise((resolve, reject) => {
    processHandle.once('error', reject);
    processHandle.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

async function cleanup() {
  if (cleaning) return;
  cleaning = true;
  for (const processHandle of children.toReversed()) {
    if (processHandle.exitCode === null) processHandle.kill('SIGTERM');
  }
  await Promise.race([
    Promise.all(children.map((processHandle) => (processHandle.exitCode === null ? wait(processHandle) : undefined))),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  for (const processHandle of children) {
    if (processHandle.exitCode === null) processHandle.kill('SIGKILL');
  }
}

process.once('SIGINT', () => void cleanup().then(() => process.exit(130)));
process.once('SIGTERM', () => void cleanup().then(() => process.exit(143)));

try {
  child('node', ['benchmarks/mock-sink.mjs']);
  await waitFor('http://127.0.0.1:18787', 1_000).catch(() => {});
  // Spawn the runtime directly so SIGTERM reaches the ingest process instead
  // of terminating a pnpm wrapper before graceful drain can report success.
  child(`${root}node_modules/.bin/tsx`, ['apps/ingest/src/server.ts'], {
    INGEST_TRAFFIC_LOG: 'false',
    INGEST_SINK_URL: 'http://127.0.0.1:18787/internal/positions',
  });
  await waitFor('http://127.0.0.1:9100/ready');

  const simulator = child('pnpm', ['ingest:load', '--', ...process.argv.slice(2)]);
  const outcome = await wait(simulator);
  if (outcome.code !== 0) throw new Error(`Simulator exited with ${outcome.code ?? outcome.signal}`);
} finally {
  await cleanup();
}
