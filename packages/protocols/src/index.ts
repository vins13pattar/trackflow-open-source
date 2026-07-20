export * from './base/types.js';
export { crc16ITU, crc16IBM } from './base/crc.js';
export { ProtocolRegistry, SessionContext } from './base/registry.js';
export { Gt06Decoder } from './gt06/index.js';
export { H02Decoder } from './h02/index.js';
export { TeltonikaDecoder } from './teltonika/index.js';
export { NmeaDecoder } from './nmea/index.js';
export { QueclinkDecoder } from './queclink/index.js';
export { MeitrackDecoder } from './meitrack/index.js';
export { encodeGt06Login, encodeGt06Location, encodeGt06Status } from './gt06/encode.js';
export type { Gt06LocationInput, Gt06StatusInput } from './gt06/encode.js';
export { encodeH02Location } from './h02/encode.js';
export type { H02LocationInput } from './h02/encode.js';
export {
  encodeTeltonikaImei,
  encodeTeltonikaAvl,
  encodeTeltonikaCommand,
  parseTeltonikaCommandResponse,
} from './teltonika/encode.js';
export type { TeltonikaRecordInput, TeltonikaCommandResponse } from './teltonika/encode.js';
export { encodeNmeaRmc } from './nmea/encode.js';
export type { NmeaInput } from './nmea/encode.js';
export {
  encodeQueclinkLocation,
  encodeQueclinkHeartbeat,
  encodeQueclinkPower,
} from './queclink/encode.js';
export type {
  QueclinkLocationInput,
  QueclinkHeartbeatInput,
  QueclinkPowerInput,
} from './queclink/encode.js';
export { encodeMeitrackLocation } from './meitrack/encode.js';
export type { MeitrackLocationInput } from './meitrack/encode.js';

import { ProtocolRegistry } from './base/registry.js';
import { Gt06Decoder } from './gt06/index.js';
import { H02Decoder } from './h02/index.js';
import { MeitrackDecoder } from './meitrack/index.js';
import { NmeaDecoder } from './nmea/index.js';
import { QueclinkDecoder } from './queclink/index.js';
import { TeltonikaDecoder } from './teltonika/index.js';

/** Registry preloaded with all supported decoders. */
export function defaultRegistry(): ProtocolRegistry {
  return new ProtocolRegistry()
    .register(new Gt06Decoder())
    .register(new H02Decoder())
    .register(new TeltonikaDecoder())
    .register(new NmeaDecoder())
    .register(new QueclinkDecoder())
    .register(new MeitrackDecoder());
}
