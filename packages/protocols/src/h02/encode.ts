/** H02 location frame encoder for the simulator and round-trip tests. */

const KPH_TO_KNOTS = 1 / 1.852;

function toCoord(value: number, isLat: boolean): { text: string; hemisphere: string } {
  const abs = Math.abs(value);
  const degrees = Math.floor(abs);
  const minutes = (abs - degrees) * 60;
  const ddd = isLat ? degrees.toString().padStart(2, '0') : degrees.toString().padStart(3, '0');
  const mm = minutes.toFixed(4).padStart(7, '0');
  const text = `${ddd}${mm}`;
  const hemisphere = isLat ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W';
  return { text, hemisphere };
}

export interface H02LocationInput {
  imei: string;
  latitude: number;
  longitude: number;
  speedKph?: number;
  course?: number;
  gpsValid?: boolean;
  time?: Date;
}

export function encodeH02Location(input: H02LocationInput): Buffer {
  const t = input.time ?? new Date();
  const hh = String(t.getUTCHours()).padStart(2, '0');
  const mm = String(t.getUTCMinutes()).padStart(2, '0');
  const ss = String(t.getUTCSeconds()).padStart(2, '0');
  const dd = String(t.getUTCDate()).padStart(2, '0');
  const mo = String(t.getUTCMonth() + 1).padStart(2, '0');
  const yy = String(t.getUTCFullYear() % 100).padStart(2, '0');

  const lat = toCoord(input.latitude, true);
  const lon = toCoord(input.longitude, false);
  const speed = ((input.speedKph ?? 0) * KPH_TO_KNOTS).toFixed(1).padStart(5, '0');
  const course = String(Math.round(input.course ?? 0)).padStart(3, '0');
  const valid = input.gpsValid ?? true ? 'A' : 'V';

  const fields = [
    'HQ',
    input.imei,
    'V1',
    `${hh}${mm}${ss}`,
    valid,
    lat.text,
    lat.hemisphere,
    lon.text,
    lon.hemisphere,
    speed,
    course,
    `${dd}${mo}${yy}`,
    'FFFFFBFF',
  ];
  return Buffer.from(`*${fields.join(',')}#`, 'ascii');
}
