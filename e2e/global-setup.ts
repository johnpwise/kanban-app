import { chromium } from "@playwright/test";

import type { FullConfig } from "@playwright/test";

export const E2E_STORAGE_STATE_PATH = "e2e/.auth/storageState.json";

const TEST_EMAIL = "e2e-test@example.com";
const TEST_PASSWORD = "e2e-test-password";

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use?.baseURL ?? "http://localhost:3000";
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto(`${baseURL}/sign-up`);
  await page.getByLabel("Email").fill(TEST_EMAIL);
  await page.getByLabel("Password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(`${baseURL}/`);

  await page.context().storageState({ path: E2E_STORAGE_STATE_PATH });
  await browser.close();
}
