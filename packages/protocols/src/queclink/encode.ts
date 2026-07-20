/** Queclink frame encoders for the simulator and round-trip tests. */

function utc(t: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    pad(t.getUTCFullYear(), 4) +
    pad(t.getUTCMonth() + 1) +
    pad(t.getUTCDate()) +
    pad(t.getUTCHours()) +
    pad(t.getUTCMinutes()) +
    pad(t.getUTCSeconds())
  );
}

function num(n: number | undefined, digits = 0): string {
  if (n === undefined) return '';
  if (digits > 0) return n.toFixed(digits);
  return String(n);
}

export interface QueclinkLocationInput {
  imei: string;
  latitude: number;
  longitude: number;
  speedKph?: number;
  course?: number;
  altitude?: number;
  /** GPS accuracy in metres; 0 marks "no valid fix". Defaults to 5 (valid). */
  accuracyM?: number;
  /** km. */
  odometer?: number;
  hourMeter?: number;
  /** millivolts. */
  analogInput1Mv?: number;
  analogInput2Mv?: number;
  /** Frame type, default GTFRI (periodic). */
  type?: 'GTFRI' | 'GTGEO' | 'GTSPD' | 'GTSOS' | 'GTRTL' | 'GTBPL' | 'GTSTR' | 'GTSTP' | 'GTHBM';
  /** Protocol version string in the frame (default '210901'). */
  protoVer?: string;
  /** Device model name in the frame (default 'GV300W'). */
  deviceName?: string;
  /** Frame counter (4 hex digits, default '0001'). */
  count?: string;
  time?: Date;
}

export function encodeQueclinkLocation(input: QueclinkLocationInput): Buffer {
  const t = input.time ?? new Date();
  const stamp = utc(t);
  const type = input.type ?? 'GTFRI';
  const protoVer = input.protoVer ?? '210901';
  const deviceName = input.deviceName ?? 'GV300W';
  const accuracy = input.accuracyM ?? 5;
  const fields = [
    type,
    protoVer,
    input.imei,
    deviceName,
    '', // reportId
    '10', // reportType
    '1', // position#
    String(accuracy),
    num(input.speedKph ?? 0, 1),
    num(input.course ?? 0),
    num(input.altitude ?? 0, 1),
    input.longitude.toFixed(6),
    input.latitude.toFixed(6),
    stamp,
    '0234', // mcc
    '0001', // mnc
    '1234', // lac
    '5678', // cellId
    '', // reserved
    num(input.odometer),
    num(input.hourMeter),
    num(input.analogInput1Mv),
    num(input.analogInput2Mv),
    stamp, // sendTime
    input.count ?? '0001',
  ];
  return Buffer.from(`+RESP:${fields.join(',')}$`, 'ascii');
}

export interface QueclinkHeartbeatInput {
  imei: string;
  protoVer?: string;
  deviceName?: string;
  count?: string;
  time?: Date;
}

export function encodeQueclinkHeartbeat(input: QueclinkHeartbeatInput): Buffer {
  const t = input.time ?? new Date();
  const protoVer = input.protoVer ?? '210901';
  const deviceName = input.deviceName ?? 'GV300W';
  const fields = ['GTHBD', protoVer, input.imei, deviceName, utc(t), input.count ?? '0001'];
  return Buffer.from(`+ACK:${fields.join(',')}$`, 'ascii');
}

export interface QueclinkPowerInput {
  imei: string;
  on: boolean;
  protoVer?: string;
  deviceName?: string;
  count?: string;
  time?: Date;
}

export function encodeQueclinkPower(input: QueclinkPowerInput): Buffer {
  const t = input.time ?? new Date();
  const protoVer = input.protoVer ?? '210901';
  const deviceName = input.deviceName ?? 'GV300W';
  const type = input.on ? 'GTPNA' : 'GTPFA';
  // Power events ship with: type,protoVer,imei,deviceName,sendTime,count$
  const fields = [type, protoVer, input.imei, deviceName, utc(t), input.count ?? '0001'];
  return Buffer.from(`+RESP:${fields.join(',')}$`, 'ascii');
}
