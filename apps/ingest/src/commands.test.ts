import { encodeGt06Command, encodeTeltonikaCommand } from '@trackflow/protocols';
import { describe, expect, it, vi } from 'vitest';
import { ActiveCommandSessions, type CommandSocket, type DeviceCommandClient, type PendingCommand } from './commands.js';

const command: PendingCommand = {
  id: '22222222-2222-4222-8222-222222222222',
  command: 'request_location',
  parameters: {},
  expiresAt: null,
};

class FakeSocket implements CommandSocket {
  destroyed = false;
  readonly writes: Buffer[] = [];

  write(data: Uint8Array, callback?: (error?: Error | null) => void): boolean {
    this.writes.push(Buffer.from(data));
    callback?.();
    return true;
  }
}

function client(commands: PendingCommand[] = [command]): DeviceCommandClient & { pending: ReturnType<typeof vi.fn> } {
  return {
    pending: vi.fn().mockResolvedValue(commands),
    ack: vi.fn().mockResolvedValue(undefined),
  } as DeviceCommandClient & { pending: ReturnType<typeof vi.fn> };
}

describe('ActiveCommandSessions', () => {
  it('polls on an admitted session and writes the GT06 request-location frame once', async () => {
    const api = client();
    const sessions = new ActiveCommandSessions(api);
    const socket = new FakeSocket();
    sessions.register('865432019876543', '11111111-1111-4111-8111-111111111111', 'gt06', socket);

    await expect(sessions.drain('865432019876543')).resolves.toBe(1);
    expect(api.pending).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', ['request_location']);
    const flag = Number.parseInt(command.id.replaceAll('-', '').slice(0, 8), 16) >>> 0;
    expect(socket.writes).toEqual([encodeGt06Command('WHERE#', 1, flag)]);
  });

  it('routes a wake-up only to the current device holder and serializes duplicate wake-ups', async () => {
    const api = client();
    const sessions = new ActiveCommandSessions(api);
    const socket = new FakeSocket();
    sessions.register('865432019876543', '11111111-1111-4111-8111-111111111111', 'teltonika', socket);

    await expect(sessions.drain('865432019876543', 'different-device')).resolves.toBe(0);
    await Promise.all([
      sessions.drain('865432019876543', '11111111-1111-4111-8111-111111111111'),
      sessions.drain('865432019876543', '11111111-1111-4111-8111-111111111111'),
    ]);
    expect(api.pending).toHaveBeenCalledTimes(1);
    expect(socket.writes).toEqual([encodeTeltonikaCommand('getgps')]);
  });

  it('leaves unsupported protocols to the reconnect/poll fallback without claiming rows', async () => {
    const api = client();
    const sessions = new ActiveCommandSessions(api);
    sessions.register('865432019876543', '11111111-1111-4111-8111-111111111111', 'h02', new FakeSocket());
    await expect(sessions.drain('865432019876543')).resolves.toBe(0);
    expect(api.pending).not.toHaveBeenCalled();
  });

  it('does not let a stale socket close remove a newer reconnect', async () => {
    const api = client();
    const sessions = new ActiveCommandSessions(api);
    const oldSocket = new FakeSocket();
    const newSocket = new FakeSocket();
    const unregisterOld = sessions.register(
      '865432019876543',
      '11111111-1111-4111-8111-111111111111',
      'gt06',
      oldSocket,
    );
    sessions.register(
      '865432019876543',
      '11111111-1111-4111-8111-111111111111',
      'gt06',
      newSocket,
    );
    unregisterOld();

    await expect(sessions.drain('865432019876543')).resolves.toBe(1);
    expect(oldSocket.writes).toEqual([]);
    expect(newSocket.writes).toHaveLength(1);
  });
});
