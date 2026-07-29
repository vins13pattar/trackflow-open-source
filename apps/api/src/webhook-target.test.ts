import { afterEach, describe, expect, it } from 'vitest';
import { isPrivateAddress, validateWebhookTarget } from './webhook-target.js';

describe('webhook target SSRF guard', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('classifies private, loopback, link-local and mapped addresses', () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '169.254.1.2', '172.31.0.1', '192.168.1.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
    expect(isPrivateAddress('2606:4700:4700::1111')).toBe(false);
  });

  it('rejects unsafe schemes, embedded credentials and mixed DNS answers', async () => {
    process.env.NODE_ENV = 'development';
    const publicResolver = async () => [{ address: '203.0.113.10' }];
    await expect(validateWebhookTarget('file:///etc/passwd', publicResolver)).rejects.toThrow(/http or https/);
    await expect(validateWebhookTarget('https://user:pass@example.com/hook', publicResolver)).rejects.toThrow(/credentials/);
    await expect(
      validateWebhookTarget('https://example.com/hook', async () => [{ address: '8.8.8.8' }, { address: '127.0.0.1' }]),
    ).rejects.toThrow(/public addresses/);
  });

  it('requires HTTPS in production', async () => {
    process.env.NODE_ENV = 'production';
    await expect(validateWebhookTarget('http://example.com/hook', async () => [{ address: '8.8.8.8' }])).rejects.toThrow(/must use https/);
  });
});
