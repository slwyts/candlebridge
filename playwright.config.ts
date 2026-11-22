import { defineConfig } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4191/candlebridge/';
export default defineConfig({
  testDir: './apps/playground/test',
  timeout: 45_000,
  workers: 2,
  use: { baseURL, browserName: 'chromium', locale: 'en-US', trace: 'retain-on-failure' },
  webServer: {
    command:
      'npm exec --workspace=@candlebridge/playground -- vite preview --host 127.0.0.1 --port 4191 --strictPort --base /candlebridge/',
    url: baseURL,
    reuseExistingServer: false
  }
});
