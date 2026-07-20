import { WhatsappChannel } from '@trackflow/notifications';
import { afterEach, describe, expect, it, vi } from 'vitest';

const message = { alertId: 'a', title: 'Hello', body: 'World', severity: 'info' };

describe('WhatsappChannel', () => {
  afterEach(() => vi.restoreAllMocks());

  it('skips per recipient when unconfigured (no token or no phone id)', async () => {
    expect(await new WhatsappChannel().send(message, { phones: ['+91111', '+91222'] })).toMatchObject([
      { channel: 'whatsapp', recipient: '+91111', status: 'skipped' },
      { channel: 'whatsapp', recipient: '+91222', status: 'skipped' },
    ]);
    expect(await new WhatsappChannel('tok').send(message, { phones: ['+91111'] })).toMatchObject([
      { channel: 'whatsapp', recipient: '+91111', status: 'skipped' },
    ]);
  });

  it('posts to the Meta Cloud API with the right URL, auth, and body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const ch = new WhatsappChannel('secret-token', '123456');
    const result = await ch.send(message, { phones: ['+919999'] });

    expect(result).toMatchObject([{ channel: 'whatsapp', recipient: '+919999', status: 'sent' }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://graph.facebook.com/v22.0/123456/messages');
    expect((opts.headers as Record<string, string>).authorization).toBe('Bearer secret-token');
    expect(JSON.parse(opts.body as string)).toEqual({
      messaging_product: 'whatsapp',
      to: '+919999',
      type: 'text',
      text: { body: 'Hello\nWorld' },
    });
  });

  it('reports failures with the HTTP status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 }));
    const result = await new WhatsappChannel('tok', 'phone').send(message, { phones: ['+91'] });
    expect(result[0]).toMatchObject({ status: 'failed', error: 'HTTP 400' });
  });

  it('captures network errors as failed results (never throws)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED')));
    const result = await new WhatsappChannel('tok', 'phone').send(message, { phones: ['+91'] });
    expect(result[0]).toMatchObject({ status: 'failed', error: 'connect ECONNREFUSED' });
  });
});
