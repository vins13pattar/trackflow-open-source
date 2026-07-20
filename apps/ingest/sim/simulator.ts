/**
 * Device simulator — opens a TCP socket to the ingest server and replays a
 * moving device, so the whole pipeline (decode -> API -> DB -> live map) is
 * testable without hardware.
 *
 *   pnpm --filter @trackflow/ingest sim gt06      865432019876543
 *   pnpm --filter @trackflow/ingest sim h02       868120303456789
 *   pnpm --filter @trackflow/ingest sim teltonika 356307042441013
 */
import net from 'node:net';
import {
  encodeGt06Location,
  encodeGt06Login,
  encodeGt06Status,
  encodeH02Location,
  encodeTeltonikaAvl,
  encodeTeltonikaImei,
} from '@trackflow/protocols';

type Protocol = 'gt06' | 'h02' | 'teltonika';
const protocol = (process.argv[2] ?? 'gt06') as Protocol;
const defaultImei: Record<Protocol, string> = {
  gt06: '865432019876543',
  h02: '868120303456789',
  teltonika: '356307042441013',
};
const defaultPort: Record<Protocol, number> = { gt06: 5023, h02: 5013, teltonika: 5027 };
const imei = process.argv[3] ?? defaultImei[protocol];
const host = process.env.SIM_HOST ?? 'localhost';
const port = Number(process.env.SIM_PORT ?? defaultPort[protocol]);
const intervalMs = Number(process.env.SIM_INTERVAL ?? 3000);

// Start near Bengaluru and wander along a changing heading.
let lat = 12.9716;
let lon = 77.5946;
let course = 45;
let serial = 2;

const socket = net.connect(port, host, () => {
  console.log(`[sim] connected ${protocol} imei=${imei} -> ${host}:${port}`);
  if (protocol === 'gt06') socket.write(encodeGt06Login(imei, 1));
  if (protocol === 'teltonika') socket.write(encodeTeltonikaImei(imei));
  tick();
  setInterval(tick, intervalMs);
});

function tick(): void {
  const speedKph = 25 + Math.random() * 35;
  course = (course + (Math.random() * 50 - 25) + 360) % 360;
  const distKm = (speedKph * (intervalMs / 1000)) / 3600;
  const rad = (course * Math.PI) / 180;
  lat += (distKm / 111) * Math.cos(rad);
  lon += (distKm / (111 * Math.cos((lat * Math.PI) / 180))) * Math.sin(rad);

  const ignition = speedKph > 3;
  let frame: Buffer;
  if (protocol === 'h02') {
    frame = encodeH02Location({ imei, latitude: lat, longitude: lon, speedKph, course });
  } else if (protocol === 'teltonika') {
    frame = encodeTeltonikaAvl([
      {
        latitude: lat,
        longitude: lon,
        speedKph,
        course,
        ignition,
        gsmSignal: 4,
        externalVoltage: 13.6 + Math.random() * 0.6,
        batteryVoltage: 4.0,
        temperature: 24 + Math.random() * 10,
        batteryPercent: 90,
      },
    ]);
  } else {
    frame = encodeGt06Location({ latitude: lat, longitude: lon, speedKph, course }, serial++);
    // GT06 sends ignition/battery in a periodic status packet.
    socket.write(encodeGt06Status({ ignition, charging: true, voltageLevel: 6, gsmSignal: 4 }, serial++));
  }
  socket.write(frame);
  console.log(`[sim] -> ${lat.toFixed(5)},${lon.toFixed(5)} ${Math.round(speedKph)}kph hdg${Math.round(course)}`);
}

socket.on('data', () => {
  /* ignore ACKs */
});
socket.on('error', (err) => {
  console.error('[sim] socket error:', err.message);
  process.exit(1);
});
socket.on('close', () => {
  console.log('[sim] connection closed');
  process.exit(0);
});
