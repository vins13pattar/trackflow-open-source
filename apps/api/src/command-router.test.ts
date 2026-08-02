import { describe, expect, it } from 'vitest';
import { commandWakeupChannel, type CommandWakeup } from '@trackflow/shared';
import { CommandWakeupRouter } from './command-router.js';

const message: CommandWakeup = {
  version: 1,
  instanceId: 'ingest-bom-2',
  imei: '865432019876543',
  deviceId: '11111111-1111-4111-8111-111111111111',
  commandId: '22222222-2222-4222-8222-222222222222',
};

describe('CommandWakeupRouter', () => {
  it('targets only the presence holder channel', async () => {
    const calls: Array<{ channel: string; body: string }> = [];
    const router = new CommandWakeupRouter({
      publish: async (channel, body) => {
        calls.push({ channel, body });
        return 1;
      },
    });
    await expect(router.request(message)).resolves.toBe(true);
    expect(calls).toEqual([{ channel: commandWakeupChannel(message.instanceId), body: JSON.stringify(message) }]);
  });

  it('reports fallback when no shared broker or holder subscriber is available', async () => {
    await expect(new CommandWakeupRouter(null).request(message)).resolves.toBe(false);
    await expect(new CommandWakeupRouter({ publish: async () => 0 }).request(message)).resolves.toBe(false);
  });
});
