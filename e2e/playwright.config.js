// End-to-end tests of pwndoc-ng, run in the Playwright container of docker-compose.e2e.yml (see run.sh)
const { defineConfig, devices } = require('@playwright/test')

module.exports = defineConfig({
  testDir: './tests',
  // The specs share the data of one instance (initialization, users, audits...): run in order, one at a time
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  globalSetup: require.resolve('./tests/support/global-setup.js'),
  outputDir: './reports/test-results',
  reporter: [
    ['list'],
    ['html', { outputFolder: './reports/html', open: 'never' }],
    ['junit', { outputFile: './reports/junit.xml' }],
    ['json', { outputFile: './reports/results.json' }]
  ],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env.BASE_URL || 'https://pwndoc-ng-frontend:8443',
    ignoreHTTPSErrors: true, // Self-signed certificate of frontend/ssl
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    timezoneId: 'Europe/Paris',
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    acceptDownloads: true
  }
})
