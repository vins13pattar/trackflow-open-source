/** Encodes a $GPRMC sentence for the simulator and round-trip tests. */
function toCoord(value: number, isLat: boolean): { text: string; hemisphere: string } {
  const abs = Math.abs(value);
  const degrees = Math.floor(abs);
  const minutes = (abs - degrees) * 60;
  const ddd = isLat ? degrees.toString().padStart(2, '0') : degrees.toString().padStart(3, '0');
  const mm = minutes.toFixed(4).padStart(7, '0');
  return { text: `${ddd}${mm}`, hemisphere: isLat ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W' };
}

function checksum(body: string): string {
  let x = 0;
  for (let i = 0; i < body.length; i++) x ^= body.charCodeAt(i);
  return (x & 0xff).toString(16).toUpperCase().padStart(2, '0');
}

export interface NmeaInput {
  latitude: number;
  longitude: number;
  speedKph?: number;
  course?: number;
  time?: Date;
}

export function encodeNmeaRmc(input: NmeaInput): Buffer {
  const t = input.time ?? new Date();
  const hh = String(t.getUTCHours()).padStart(2, '0');
  const mm = String(t.getUTCMinutes()).padStart(2, '0');
  const ss = String(t.getUTCSeconds()).padStart(2, '0');
  const dd = String(t.getUTCDate()).padStart(2, '0');
  const mo = String(t.getUTCMonth() + 1).padStart(2, '0');
  const yy = String(t.getUTCFullYear() % 100).padStart(2, '0');
  const lat = toCoord(input.latitude, true);
  const lon = toCoord(input.longitude, false);
  const knots = ((input.speedKph ?? 0) / 1.852).toFixed(1);
  const course = (input.course ?? 0).toFixed(1);
  const body = `GPRMC,${hh}${mm}${ss}.00,A,${lat.text},${lat.hemisphere},${lon.text},${lon.hemisphere},${knots},${course},${dd}${mo}${yy},,`;
  return Buffer.from(`$${body}*${checksum(body)}\r\n`, 'ascii');
}
