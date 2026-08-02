import { defineConfig, devices } from '@playwright/test';

const webOrigin = 'http://localhost:3001';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: webOrigin,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'], colorScheme: 'light', viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'chromium-mobile',
      use: { ...devices['Pixel 7'], colorScheme: 'dark', viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: [
    {
      command: `WEB_ORIGIN=${webOrigin} pnpm --filter @trackflow/api dev`,
      url: 'http://localhost:8787/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command:
        'NEXT_PUBLIC_API_BASE_URL=/api API_PROXY_TARGET=http://localhost:8787 pnpm --filter @trackflow/web build && ' +
        'API_PROXY_TARGET=http://localhost:8787 pnpm --filter @trackflow/web exec next start -p 3001',
      url: webOrigin,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
