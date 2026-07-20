import type { DecodeContext, Decoder } from './types.js';

/** Per-connection decode state (binds IMEI once a login/first frame is seen). */
export class SessionContext implements DecodeContext {
  imei?: string;
  setImei(imei: string): void {
    this.imei = imei;
  }
}

/**
 * Holds the registered decoders and picks the right one for a fresh
 * connection by sniffing the first bytes (auto-detection).
 */
export class ProtocolRegistry {
  private readonly decoders: Decoder[] = [];

  register(decoder: Decoder): this {
    this.decoders.push(decoder);
    return this;
  }

  detect(buffer: Buffer): Decoder | undefined {
    return this.decoders.find((d) => d.canDecode(buffer));
  }

  get(protocol: string): Decoder | undefined {
    return this.decoders.find((d) => d.protocol === protocol);
  }

  list(): readonly Decoder[] {
    return this.decoders;
  }
}
