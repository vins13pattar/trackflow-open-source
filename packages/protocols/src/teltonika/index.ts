/**
 * Teltonika Codec 8 / 8 Extended decoder — professional vehicle trackers.
 *
 * The session opens with an IMEI handshake: the device sends [len(2)][IMEI ascii]
 * and the server replies 0x01 to accept. Subsequent AVL packets are:
 *   preamble(4=0) | dataLen(4) | codecId(1) | count(1) | records | count(1) | crc(4)
 * and the server replies with a 4-byte record count.
 *
 * The CRC-16/IBM covers codecId..count2; verified against a self-encoded vector.
 */
import { crc16IBM } from '../base/crc.js';
import type { Attributes, DecodeContext, DecodeResult, DecodedMessage, Decoder, Position } from '../base/types.js';

const CODEC_8 = 0x08;
const CODEC_8E = 0x8e;

interface AvlParse {
  position: Position;
  attributes: Attributes;
  next: number;
}

const toSigned16 = (v: number) => (v > 0x7fff ? v - 0x10000 : v);

/** Well-known Teltonika AVL IO IDs → normalized telemetry keys. */
const IO_MAP: Record<number, { key: string; transform?: (v: number) => number | boolean }> = {
  239: { key: 'ignition', transform: (v) => v === 1 },
  240: { key: 'motion', transform: (v) => v === 1 },
  21: { key: 'gsmSignal' },
  66: { key: 'externalVoltage', transform: (v) => Math.round(v) / 1000 }, // mV → V
  67: { key: 'batteryVoltage', transform: (v) => Math.round(v) / 1000 },
  113: { key: 'batteryPercent' },
  16: { key: 'odometer', transform: (v) => Math.round(v / 1000) }, // m → km
  72: { key: 'temperature', transform: (v) => toSigned16(v) / 10 }, // 0.1 °C signed
  // ---------- OBD-II PIDs surfaced via the Teltonika OBD adapter ----------
  // Teltonika maps standard PIDs to AVL IO IDs 30-60; transforms restore the
  // OBD-II canonical units (so consumers don't have to know per-PID scaling).
  30: { key: 'obdDtcCount' },
  31: { key: 'obdEngineLoadPct' }, // 0-100
  32: { key: 'obdCoolantTempC', transform: (v) => v - 40 }, // OBD-II encodes °C+40
  33: { key: 'obdShortFuelTrimPct', transform: (v) => v - 100 }, // -100..+99
  34: { key: 'obdFuelPressureKpa', transform: (v) => v * 3 }, // 3 kPa/unit
  35: { key: 'obdIntakeMapKpa' },
  36: { key: 'obdEngineRpm' },
  37: { key: 'obdVehicleSpeedKph' },
  38: { key: 'obdTimingAdvanceDeg', transform: (v) => v / 2 - 64 },
  39: { key: 'obdIntakeAirTempC', transform: (v) => v - 40 },
  40: { key: 'obdMafGramsPerSec', transform: (v) => v / 100 },
  41: { key: 'obdThrottlePositionPct', transform: (v) => (v * 100) / 255 },
  42: { key: 'obdRuntimeSinceStartS' },
  43: { key: 'obdDistanceWithMilOnKm' },
  44: { key: 'obdFuelRailPressureRelativeKpa', transform: (v) => v * 0.079 },
  45: { key: 'obdFuelRailPressureDirectKpa', transform: (v) => v * 10 },
  46: { key: 'obdCommandedEgrPct', transform: (v) => (v * 100) / 255 },
  47: { key: 'obdEgrErrorPct', transform: (v) => (v - 128) * (100 / 128) },
  48: { key: 'obdFuelLevelPct', transform: (v) => (v * 100) / 255 },
  49: { key: 'obdDistanceSinceCodesClearedKm' },
  50: { key: 'obdBarometricPressureKpa' },
  51: { key: 'obdControlModuleVoltage', transform: (v) => v / 1000 }, // mV → V
  52: { key: 'obdAbsoluteLoadPct', transform: (v) => (v * 100) / 255 },
  53: { key: 'obdAmbientAirTempC', transform: (v) => v - 40 },
  54: { key: 'obdTimeRunWithMilOnMin' },
  55: { key: 'obdTimeSinceCodesClearedMin' },
  56: { key: 'obdFuelRailPressureAbsoluteKpa', transform: (v) => v * 10 },
  57: { key: 'obdHybridBatteryPackLifePct', transform: (v) => (v * 100) / 255 },
  58: { key: 'obdEngineOilTempC', transform: (v) => v - 40 },
  59: { key: 'obdFuelInjectionTimingDeg', transform: (v) => v / 128 - 210 },
  60: { key: 'obdEngineFuelRateLph', transform: (v) => v / 20 },
};

function buildAttributes(raw: Record<number, number>): Attributes {
  const attrs: Attributes = {};
  for (const [idStr, val] of Object.entries(raw)) {
    const id = Number(idStr);
    const m = IO_MAP[id];
    if (m) attrs[m.key] = m.transform ? m.transform(val) : val;
    else attrs[`io.${id}`] = val;
  }
  return attrs;
}

function parseRecord(data: Buffer, start: number, codecId: number): AvlParse {
  let p = start;
  const timestamp = Number(data.readBigUInt64BE(p));
  p += 8;
  p += 1; // priority
  const longitude = data.readInt32BE(p) / 1e7;
  p += 4;
  const latitude = data.readInt32BE(p) / 1e7;
  p += 4;
  p += 2; // altitude
  const course = data.readUInt16BE(p);
  p += 2;
  const satellites = data.readUInt8(p);
  p += 1;
  const speedKph = data.readUInt16BE(p);
  p += 2;

  // IO element — sizes differ between Codec 8 and 8 Extended.
  const ext = codecId === CODEC_8E;
  const readId = () => {
    const v = ext ? data.readUInt16BE(p) : data.readUInt8(p);
    p += ext ? 2 : 1;
    return v;
  };
  const readCount = () => {
    const v = ext ? data.readUInt16BE(p) : data.readUInt8(p);
    p += ext ? 2 : 1;
    return v;
  };
  const readValue = (size: number) => {
    const v = size === 1 ? data.readUInt8(p) : size === 2 ? data.readUInt16BE(p) : size === 4 ? data.readUInt32BE(p) : Number(data.readBigUInt64BE(p));
    p += size;
    return v;
  };

  readId(); // event IO id
  readCount(); // total IO count
  const raw: Record<number, number> = {};
  for (const size of [1, 2, 4, 8]) {
    const n = readCount();
    for (let i = 0; i < n; i++) {
      const id = readId();
      raw[id] = readValue(size);
    }
  }
  if (ext) {
    const n = readCount();
    for (let i = 0; i < n; i++) {
      readId();
      const len = data.readUInt16BE(p);
      p += 2 + len;
    }
  }

  return {
    position: { latitude, longitude, speedKph, course, gpsValid: satellites > 0, fixTime: new Date(timestamp), satellites },
    attributes: buildAttributes(raw),
    next: p,
  };
}

export class TeltonikaDecoder implements Decoder {
  readonly protocol = 'teltonika';

  canDecode(buffer: Buffer): boolean {
    if (buffer.length >= 4 && buffer.readUInt32BE(0) === 0) return true; // AVL preamble
    if (buffer.length >= 2) {
      const len = buffer.readUInt16BE(0);
      return len >= 8 && len <= 17; // plausible IMEI handshake
    }
    return false;
  }

  decode(buffer: Buffer, ctx: DecodeContext): DecodeResult {
    const messages: DecodedMessage[] = [];
    let offset = 0;

    while (offset < buffer.length) {
      if (!ctx.imei) {
        // Expect the IMEI handshake first.
        if (buffer.length - offset < 2) break;
        const len = buffer.readUInt16BE(offset);
        if (len < 1 || len > 20 || buffer.length - offset < 2 + len) break;
        const imei = buffer.subarray(offset + 2, offset + 2 + len).toString('ascii');
        if (!/^\d+$/.test(imei)) break; // not a handshake we understand
        ctx.setImei(imei);
        const raw = Buffer.from(buffer.subarray(offset, offset + 2 + len));
        messages.push({ protocol: this.protocol, kind: 'login', imei, raw, reply: Buffer.from([0x01]) });
        offset += 2 + len;
        continue;
      }

      if (buffer.length - offset < 12) break;
      if (buffer.readUInt32BE(offset) !== 0) {
        offset += 1; // resync to the next preamble
        continue;
      }
      const dataLength = buffer.readUInt32BE(offset + 4);
      const frameLen = 8 + dataLength + 4;
      if (buffer.length - offset < frameLen) break;

      const data = buffer.subarray(offset + 8, offset + 8 + dataLength);
      const crcExpected = buffer.readUInt32BE(offset + 8 + dataLength) & 0xffff;
      if (crc16IBM(data) !== crcExpected) {
        offset += 1;
        continue;
      }

      const codecId = data.readUInt8(0);
      const count = data.readUInt8(1);
      const raw = Buffer.from(buffer.subarray(offset, offset + frameLen));
      let p = 2;
      const records: DecodedMessage[] = [];
      for (let i = 0; i < count; i++) {
        const { position, attributes, next } = parseRecord(data, p, codecId);
        records.push({ protocol: this.protocol, kind: 'location', imei: ctx.imei, position, attributes, raw });
        p = next;
      }

      const reply = Buffer.alloc(4);
      reply.writeUInt32BE(count, 0);
      if (records.length > 0) {
        records[records.length - 1]!.reply = reply;
        messages.push(...records);
      } else {
        messages.push({ protocol: this.protocol, kind: 'heartbeat', imei: ctx.imei, raw, reply });
      }
      offset += frameLen;
    }

    return { messages, consumed: offset };
  }
}
