import type { Page } from "@playwright/test";

export const IDS = {
  approval: "7c1e2a90-4b7d-4e2a-9f1c-2d8e6a0b5c13",
  reconcile: "2d94b7e1-5c3a-4f1e-9b2d-7a6c1e0f3b21",
  reconcileConfirmed: "3a6f0c52-8e1b-4d7a-a3c9-5b2e8f1d4c60",
  reconcileConflict: "4b8d2e71-6a0c-4f3b-b8e2-9c1a7d5f2e84",
  running: "5e2c9a14-3b8f-4d6e-a1c7-8f4b2d9e6a35",
  planning: "6f3d0b25-9c1e-4a7f-8b2d-4e7c1a5f9b62",
  expired: "0f7b52e3-8d41-4c6a-a2f9-3e5b7c9d1a04",
  failed: "91d2f6c8-2b5e-4a7d-8c3f-6e1a9b4d7f25",
  needsInput: "b81f0d24-7e3c-4b9a-9d2f-1a6c8e5b3f47",
  refused: "c3a86e19-4f2d-4a8b-b7e1-3c9d5a2f6e18",
  succeeded: "8a4e1c36-2d9f-4b5a-9e3c-7b1d6f8a2c47",
  rejected: "9b5f2d47-1e3a-4c6b-a8d4-2f9e7c3b5d18",
} as const;

/** Opens a hash route and signs in with synthetic fixture credentials. */
export async function openSignedIn(page: Page, hash: string): Promise<void> {
  await page.goto(`/${hash}`);
  await page.getByLabel("Email").fill("demo@ati.local");
  await page.getByLabel("Mật khẩu", { exact: true }).fill("synthetic-password");
  await page.getByRole("button", { name: "Đăng nhập" }).click();
}

export async function fixtureCalls(
  page: Page,
): Promise<Array<{ method: string; path: string }>> {
  return page.evaluate(
    () =>
      (
        window as Window & {
          __WAP_FIXTURE_CALLS__?: Array<{ method: string; path: string }>;
        }
      ).__WAP_FIXTURE_CALLS__ ?? [],
  );
}
