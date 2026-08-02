import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const API_ORIGIN = 'http://localhost:8787';
const PASSWORD = 'Synthetic-Only-123!';

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
        const cleanup = await request.delete(`${API_ORIGIN}/me/tenant`, {
          headers: { authorization: `Bearer ${accessToken}` },
          data: { password: PASSWORD, confirm: 'delete my workspace' },
        });
        expect(cleanup.status(), await cleanup.text()).toBe(204);
      }
    }
  });
});
