/**
 * Shared types for the GPS protocol decoding framework.
 *
 * GPS trackers speak over raw TCP. A decoder is a pure function over a byte
 * buffer: it extracts as many complete frames as are available, reports how
 * many bytes it consumed (so the caller can retain the remainder for the next
 * read), and may return reply bytes the server must send back (ACKs).
 */

export type MessageKind =
  | 'login'
  | 'location'
  | 'heartbeat'
  | 'alarm'
  | 'status'
  | 'unknown';

export interface Position {
  latitude: number;
  longitude: number;
  /** Ground speed in km/h. */
  speedKph: number;
  /** Heading in degrees, 0–360. */
  course: number;
  /** Whether the GPS fix is valid/positioned. */
  gpsValid: boolean;
  /** Device-reported fix time (UTC). */
  fixTime: Date;
  satellites?: number;
}

/** Normalized device telemetry — known keys plus raw `io.<id>` for the rest. */
export type Attributes = Record<string, number | boolean | string>;

export interface DecodedMessage {
  protocol: string;
  kind: MessageKind;
  /** Present on login; the session binds it to all subsequent messages. */
  imei?: string;
  position?: Position;
  /** Device telemetry (ignition, voltages, temperature, signal, …). */
  attributes?: Attributes;
  /** Normalized alarm label, e.g. "sos", "low_battery", "power_cut". */
  alarmType?: string;
  /** Raw frame bytes (for audit/debug). */
  raw: Buffer;
  /** Bytes the server must write back to the device (ACK), if any. */
  reply?: Buffer;
  meta?: Record<string, unknown>;
}

export interface DecodeResult {
  messages: DecodedMessage[];
  /** Number of bytes consumed from the head of the input buffer. */
  consumed: number;
}

/** Per-connection state shared across reads for one device session. */
export interface DecodeContext {
  imei?: string;
  setImei(imei: string): void;
}

export interface Decoder {
  readonly protocol: string;
  /** Cheap check: does this buffer look like the start of one of our frames? */
  canDecode(buffer: Buffer): boolean;
  /** Decode all complete frames at the head of the buffer. */
  decode(buffer: Buffer, ctx: DecodeContext): DecodeResult;
}
