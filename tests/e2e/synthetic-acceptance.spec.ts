import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { totpCode } from '../../packages/shared/src/totp.ts';

const API_ORIGIN = 'http://localhost:8787';
const PASSWORD = 'Synthetic-Only-123!';

interface SyntheticAccount {
  accessToken: string;
  email: string;
  tenantName: string;
}

async function registerSyntheticAccount(request: APIRequestContext, label: string): Promise<SyntheticAccount> {
  const stamp = `${Date.now()}-${label}`;
  const email = `browser-${stamp}@example.test`;
  const tenantName = `Synthetic Fleet ${stamp}`;
  const response = await request.post(`${API_ORIGIN}/auth/register`, {
    data: { email, password: PASSWORD, name: 'Synthetic Test Driver', tenantName },
  });
  expect(response.status(), await response.text()).toBe(201);
  const body = (await response.json()) as { tokens: { accessToken: string } };
  return { accessToken: body.tokens.accessToken, email, tenantName };
}

async function deleteSyntheticAccount(request: APIRequestContext, accessToken: string) {
  const response = await request.delete(`${API_ORIGIN}/me/tenant`, {
    headers: { authorization: `Bearer ${accessToken}` },
    data: { password: PASSWORD, confirm: 'delete my workspace' },
  });
  expect(response.status(), await response.text()).toBe(204);
}

async function signIn(page: Page, account: SyntheticAccount) {
  await page.goto('/login');
  await disableMotion(page);
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password').fill(PASSWORD);
  const signInButton = page.getByRole('button', { name: 'Sign in' });
  await expect(signInButton).toBeEnabled();
  await signInButton.click();
}

async function disableMotion(page: Page) {
  await page.addStyleTag({
    content: '*, *::before, *::after { animation: none !important; transition: none !important; }',
  });
}

async function expectNoSeriousAccessibilityViolations(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  const blocking = result.violations.filter((violation) =>
    violation.impact === 'serious' || violation.impact === 'critical',
  );
  expect(blocking, blocking.map((violation) => `${violation.id}: ${violation.help}`).join('\n')).toEqual([]);
}

test.describe('synthetic local acceptance', () => {
  test('registers a tenant, adds a tracker, and opens its connection guide', async ({ page, request }, testInfo) => {
    const stamp = `${Date.now()}-${testInfo.project.name}`;
    const email = `browser-${stamp}@example.test`;
    const tenantName = `Synthetic Fleet ${stamp}`;
    const deviceName = `Synthetic Van ${stamp}`;
    const imei = String(Date.now()).slice(-15).padStart(15, '8');
    const browserErrors: string[] = [];
    let accessToken: string | null = null;

    page.on('pageerror', (error) => browserErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });

    try {
      await page.goto('/register');
      await disableMotion(page);
      await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
      const createAccount = page.getByRole('button', { name: 'Create account' });
      await expect(createAccount).toBeEnabled();
      await expectNoSeriousAccessibilityViolations(page);

      await page.getByLabel('Your name').fill('Synthetic Test Driver');
      await page.getByLabel('Company').fill(tenantName);
      await page.getByLabel('Work email').fill(email);
      await page.getByLabel('Password').fill(PASSWORD);

      await createAccount.click();
      await expect(page).toHaveURL(/\/dashboard$/);
      accessToken = await page.evaluate(() => window.localStorage.getItem('trackflow.accessToken'));
      expect(accessToken).toBeTruthy();

      await expect(page.getByRole('heading', { name: 'Live Map', exact: true })).toBeVisible();
      await expectNoSeriousAccessibilityViolations(page);

      if (testInfo.project.name === 'chromium-mobile') {
        await page.getByRole('button', { name: 'Open menu' }).click();
        const mobileNavigation = page.getByRole('dialog', { name: 'Mobile navigation' });
        await expect(mobileNavigation).toBeVisible();
        await expect(mobileNavigation.getByText(tenantName, { exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Close menu' }).click();
        await expect(mobileNavigation).toBeHidden();
      } else {
        await expect(page.getByText(tenantName, { exact: true })).toBeVisible();
      }

      await page.goto('/devices');
      await disableMotion(page);
      await expect(page.locator('main').getByRole('heading', { name: 'Devices', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Add device' }).click();
      await page.getByLabel('Name', { exact: true }).fill(deviceName);
      await page.getByLabel('IMEI (15 digits)').fill(imei);
      await page.getByRole('button', { name: 'Create device' }).click();

      await expect(page.getByText(deviceName, { exact: true })).toBeVisible();
      await expect(page.getByText(imei, { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Connect' }).click();

      const guide = page.getByRole('dialog', { name: `Connect “${deviceName}”` });
      await expect(guide).toBeVisible();
      await expect(guide.getByText('your-trackflow-host', { exact: true })).toBeVisible();
      await expect(guide.getByText('5023', { exact: true })).toBeVisible();
      await expect(guide.getByText(imei, { exact: true })).toBeVisible();
      await expectNoSeriousAccessibilityViolations(page);

      expect(browserErrors, browserErrors.join('\n')).toEqual([]);
    } finally {
      accessToken ??= await page.evaluate(() => window.localStorage.getItem('trackflow.accessToken')).catch(() => null);
      if (accessToken) {
        await deleteSyntheticAccount(request, accessToken);
      }
    }
  });

  test('keeps device data tenant-scoped and expires an invalid browser session', async ({ page, request }, testInfo) => {
    const numericStamp = String(Date.now()).slice(-13).padStart(13, '8');
    const deviceA = `Tenant A Van ${numericStamp}`;
    const deviceB = `Tenant B Van ${numericStamp}`;
    const accounts: SyntheticAccount[] = [];

    try {
      const accountA = await registerSyntheticAccount(request, `${testInfo.project.name}-tenant-a`);
      accounts.push(accountA);
      const accountB = await registerSyntheticAccount(request, `${testInfo.project.name}-tenant-b`);
      accounts.push(accountB);

      for (const [account, name, suffix] of [
        [accountA, deviceA, '1'],
        [accountB, deviceB, '2'],
      ] as const) {
        const response = await request.post(`${API_ORIGIN}/devices`, {
          headers: { authorization: `Bearer ${account.accessToken}` },
          data: { name, imei: `7${numericStamp}${suffix}`, type: 'vehicle', protocol: 'gt06' },
        });
        expect(response.status(), await response.text()).toBe(201);
      }

      await signIn(page, accountA);
      await expect(page).toHaveURL(/\/dashboard$/);
      await page.goto('/devices');
      await disableMotion(page);
      await expect(page.getByText(deviceA, { exact: true })).toBeVisible();
      await expect(page.getByText(deviceB, { exact: true })).toHaveCount(0);

      await page.evaluate(() => window.localStorage.setItem('trackflow.accessToken', 'expired.synthetic.token'));
      await page.reload();
      await expect(page).toHaveURL(/\/login\?expired=1$/);
      await expect(page.getByText('Your session expired. Please sign in again.', { exact: true })).toBeVisible();
    } finally {
      await Promise.all(accounts.map((account) => deleteSyntheticAccount(request, account.accessToken)));
    }
  });

  test('requires and verifies a TOTP challenge before creating a browser session', async ({ page, request }, testInfo) => {
    const account = await registerSyntheticAccount(request, `${testInfo.project.name}-mfa`);

    try {
      const setup = await request.post(`${API_ORIGIN}/me/mfa/setup`, {
        headers: { authorization: `Bearer ${account.accessToken}` },
        data: {},
      });
      expect(setup.status(), await setup.text()).toBe(200);
      const { secret } = (await setup.json()) as { secret: string };

      const enrollmentCode = await totpCode(secret);
      const enable = await request.post(`${API_ORIGIN}/me/mfa/enable`, {
        headers: { authorization: `Bearer ${account.accessToken}` },
        data: { code: enrollmentCode },
      });
      expect(enable.status(), await enable.text()).toBe(200);

      await signIn(page, account);
      await expect(page.getByRole('heading', { name: 'Two-factor authentication' })).toBeVisible();
      await expectNoSeriousAccessibilityViolations(page);

      const authenticationCode = page.getByLabel('Authentication code');
      const verifyButton = page.getByRole('button', { name: 'Verify' });
      const validCode = await totpCode(secret);
      await authenticationCode.fill(validCode === '000000' ? '000001' : '000000');
      await verifyButton.click();
      await expect(page.getByText('Invalid MFA code', { exact: true })).toBeVisible();

      await authenticationCode.fill(await totpCode(secret));
      await verifyButton.click();
      await expect(page).toHaveURL(/\/dashboard$/);
      await expect(page.getByRole('heading', { name: 'Live Map', exact: true })).toBeVisible();
    } finally {
      await deleteSyntheticAccount(request, account.accessToken);
    }
  });
});
