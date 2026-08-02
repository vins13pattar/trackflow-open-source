import { encodeGt06Command, encodeTeltonikaCommand } from '@trackflow/protocols';
import { supportsImmediateDeviceCommand } from '@trackflow/shared';
import { env } from './env.js';

export interface PendingCommand {
  id: string;
  command: 'request_location';
  parameters: Record<string, unknown>;
  expiresAt: string | null;
}

export interface DeviceCommandClient {
  pending(deviceId: string, supportedCommands: readonly ['request_location']): Promise<PendingCommand[]>;
  ack(commandId: string, status: 'acked' | 'failed', response?: string): Promise<void>;
}

export class HttpDeviceCommandClient implements DeviceCommandClient {
  constructor(
    private readonly apiOrigin: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async pending(deviceId: string, supportedCommands: readonly ['request_location']): Promise<PendingCommand[]> {
    const response = await this.fetchImpl(
      new URL(`/internal/devices/${encodeURIComponent(deviceId)}/commands/pending`, this.apiOrigin),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-ingest-token': this.token },
        body: JSON.stringify({ supportedCommands }),
      },
    );
    if (!response.ok) throw new Error(`Command poll failed (${response.status})`);
    const body = (await response.json()) as { commands?: PendingCommand[] };
    return Array.isArray(body.commands)
      ? body.commands.filter(
          (command) =>
            command.command === 'request_location' &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(command.id),
        )
      : [];
  }

  async ack(commandId: string, status: 'acked' | 'failed', responseText?: string): Promise<void> {
    const response = await this.fetchImpl(
      new URL(`/internal/devices/commands/${encodeURIComponent(commandId)}/ack`, this.apiOrigin),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-ingest-token': this.token },
        body: JSON.stringify({ status, response: responseText }),
      },
    );
    if (!response.ok) throw new Error(`Command acknowledgement failed (${response.status})`);
  }
}

export interface CommandSocket {
  readonly destroyed: boolean;
  write(data: Uint8Array, callback?: (error?: Error | null) => void): boolean;
}

interface ActiveSession {
  deviceId: string;
  protocol: string;
  socket: CommandSocket;
}

function encodeRequestLocation(protocol: string, commandId: string): Buffer | null {
  if (protocol === 'gt06') {
    const flag = Number.parseInt(commandId.replaceAll('-', '').slice(0, 8), 16) >>> 0;
    return encodeGt06Command('WHERE#', 1, flag);
  }
  if (protocol === 'teltonika') return encodeTeltonikaCommand('getgps');
  return null;
}

function write(socket: CommandSocket, frame: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.write(frame, (error) => (error ? reject(error) : resolve()));
  });
}

/** Active admitted sockets plus a serialized poll/write path per device. The
 * durable command row is claimed by the API; Redis wake-ups only reduce delay. */
export class ActiveCommandSessions {
  private readonly sessions = new Map<string, ActiveSession>();
  private readonly drains = new Map<string, Promise<number>>();

  constructor(private readonly client: DeviceCommandClient) {}

  register(imei: string, deviceId: string, protocol: string, socket: CommandSocket): () => void {
    const session = { deviceId, protocol, socket };
    this.sessions.set(imei, session);
    return () => {
      if (this.sessions.get(imei) === session) this.sessions.delete(imei);
    };
  }

  drain(imei: string, expectedDeviceId?: string): Promise<number> {
    const existing = this.drains.get(imei);
    if (existing) return existing;
    const operation = this.drainOnce(imei, expectedDeviceId).finally(() => this.drains.delete(imei));
    this.drains.set(imei, operation);
    return operation;
  }

  private async drainOnce(imei: string, expectedDeviceId?: string): Promise<number> {
    const session = this.sessions.get(imei);
    if (!session || session.socket.destroyed || (expectedDeviceId && session.deviceId !== expectedDeviceId)) return 0;
    if (!supportsImmediateDeviceCommand(session.protocol, 'request_location')) return 0;

    const commands = await this.client.pending(session.deviceId, ['request_location']);
    let written = 0;
    for (const command of commands) {
      if (session.socket.destroyed || this.sessions.get(imei) !== session) break;
      const frame = encodeRequestLocation(session.protocol, command.id);
      if (!frame) continue;
      try {
        await write(session.socket, frame);
        written += 1;
      } catch (error) {
        await this.client.ack(command.id, 'failed', `socket_write: ${(error as Error).message}`);
      }
    }
    return written;
  }
}

let commandClient: HttpDeviceCommandClient | null = null;

export function getDeviceCommandClient(): HttpDeviceCommandClient {
  commandClient ??= new HttpDeviceCommandClient(new URL(env.sinkUrl).origin, env.sinkToken);
  return commandClient;
}
