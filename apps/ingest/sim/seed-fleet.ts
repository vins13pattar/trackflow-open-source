/**
 * Seeds a demo fleet — no hardware needed. Logs in, makes sure the plan allows
 * enough devices (mock-upgrades to Professional if needed), creates N devices,
 * then drives them all with simulated GT06 movement spread around Bengaluru, so
 * the live map is instantly populated for a demo.
 *
 * Prereqs: the API (:8787) and ingest server (TCP :5023) must be running.
 *
 *   TF_EMAIL=you@acme.app TF_PASSWORD=secret pnpm --filter @trackflow/ingest seed
 *   COUNT=8 TF_EMAIL=... TF_PASSWORD=... pnpm --filter @trackflow/ingest seed
 */
import net from 'node:net';
import { encodeGt06Location, encodeGt06Login } from '@trackflow/protocols';

const API = process.env.API_BASE ?? 'http://localhost:8787';
const HOST = process.env.SIM_HOST ?? 'localhost';
const PORT = Number(process.env.INGEST_GT06_PORT ?? 5023);
const COUNT = Math.min(Number(process.env.COUNT ?? 6), 20);
const INTERVAL = Number(process.env.SIM_INTERVAL ?? 3000);
const EMAIL = process.env.TF_EMAIL;
const PASSWORD = process.env.TF_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error('Set TF_EMAIL and TF_PASSWORD to your TrackFlow login. e.g.\n  TF_EMAIL=you@acme.app TF_PASSWORD=*** pnpm --filter @trackflow/ingest seed');
  process.exit(1);
}

const CENTER = { lat: 12.9716, lng: 77.5946 };
const NAMES = ['Delivery Van', 'School Bus', 'Cargo Truck', 'Sales Car', 'Courier Bike', 'Service Van', 'Tipper', 'Ambulance'];

async function call<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
  return body as T;
}

interface FleetUnit {
  imei: string;
  name: string;
  lat: number;
  lng: number;
  course: number;
  serial: number;
}

async function main(): Promise<void> {
  const auth = await call<{ tokens: { accessToken: string } }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const token = auth.tokens.accessToken;
  console.log(`[seed] logged in as ${EMAIL}`);

  // Ensure the plan allows COUNT devices.
  const sub = await call<{ plan: string; limits: { devices: number } }>('/billing/subscription', {}, token);
  if (sub.limits.devices >= 0 && sub.limits.devices < COUNT) {
    console.log(`[seed] plan '${sub.plan}' caps devices at ${sub.limits.devices}; mock-upgrading to professional…`);
    await call('/billing/confirm', { method: 'POST', body: JSON.stringify({ plan: 'professional', billingCycle: 'monthly' }) }, token);
  }

  const fleet: FleetUnit[] = [];
  for (let i = 0; i < COUNT; i++) {
    const imei = `865000000${100000 + i}`; // deterministic demo range (15 digits)
    const name = `KA-${String((i % 9) + 1).padStart(2, '0')}-DM-${1000 + i}`;
    try {
      await call('/devices', {
        method: 'POST',
        body: JSON.stringify({ name, imei, type: 'vehicle', protocol: 'gt06', registrationNumber: name }),
      }, token);
      console.log(`[seed] created ${name} (${imei})`);
    } catch (err) {
      if (!/exists/i.test((err as Error).message)) throw err; // already seeded — reuse it
    }
    const angle = (i / COUNT) * 2 * Math.PI;
    fleet.push({
      imei,
      name,
      lat: CENTER.lat + 0.02 * Math.cos(angle),
      lng: CENTER.lng + 0.02 * Math.sin(angle),
      course: (angle * 180) / Math.PI,
      serial: 2,
    });
  }

  console.log(`[seed] driving ${fleet.length} devices around Bengaluru — Ctrl+C to stop.`);
  const sockets: net.Socket[] = [];
  for (const unit of fleet) {
    const socket = net.connect(PORT, HOST, () => {
      socket.write(encodeGt06Login(unit.imei, 1));
      const tick = () => {
        const speed = 20 + Math.random() * 40;
        unit.course = (unit.course + (Math.random() * 50 - 25) + 360) % 360;
        const distKm = (speed * (INTERVAL / 1000)) / 3600;
        const rad = (unit.course * Math.PI) / 180;
        unit.lat += (distKm / 111) * Math.cos(rad);
        unit.lng += (distKm / (111 * Math.cos((unit.lat * Math.PI) / 180))) * Math.sin(rad);
        socket.write(encodeGt06Location({ latitude: unit.lat, longitude: unit.lng, speedKph: speed, course: unit.course }, unit.serial++));
      };
      tick();
      setInterval(tick, INTERVAL);
    });
    socket.on('data', () => {});
    socket.on('error', (e) => console.warn(`[seed] ${unit.name} socket error: ${e.message}`));
    sockets.push(socket);
  }

  process.on('SIGINT', () => {
    console.log('\n[seed] stopping…');
    for (const s of sockets) s.destroy();
    process.exit(0);
  });
}

void main().catch((err) => {
  console.error('[seed] failed:', (err as Error).message);
  process.exit(1);
});
