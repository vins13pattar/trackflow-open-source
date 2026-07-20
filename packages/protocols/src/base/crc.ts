/**
 * CRC-ITU (a.k.a. CRC-16/X-25) — the checksum used by GT06 and many
 * Concox-family trackers.
 *
 * Parameters: poly 0x1021 (reflected 0x8408), init 0xFFFF, refin/refout true,
 * xorout 0xFFFF.
 */

const TABLE: Uint16Array = (() => {
  const t = new Uint16Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0x8408 : crc >>> 1;
    }
    t[i] = crc & 0xffff;
  }
  return t;
})();

export function crc16ITU(buf: Buffer): number {
  let fcs = 0xffff;
  for (const b of buf) {
    fcs = (fcs >>> 8) ^ TABLE[(fcs ^ b) & 0xff]!;
  }
  return ~fcs & 0xffff;
}

/**
 * CRC-16/IBM (a.k.a. CRC-16/ARC) — used by Teltonika Codec 8.
 * poly 0x8005 (reflected 0xA001), init 0x0000, refin/refout true, no xorout.
 */
export function crc16IBM(buf: Buffer): number {
  let crc = 0;
  for (const b of buf) {
    crc ^= b;
    for (let i = 0; i < 8; i++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
    }
  }
  return crc & 0xffff;
}
