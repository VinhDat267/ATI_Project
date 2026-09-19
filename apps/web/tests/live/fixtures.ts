import { test as base, expect } from "@playwright/test";
import {
  createLiveFixture,
  safeTeardown,
  type LiveFixtureContext,
} from "./cleanup.js";

export const test = base.extend<{
  liveContext: LiveFixtureContext;
}>({
  liveContext: async ({}, use) => {
    const fixture = await createLiveFixture();
    try {
      await use(fixture);
    } finally {
      await safeTeardown(fixture);
    }
  },
  baseURL: async ({ liveContext }, use) => {
    await use(liveContext.previewUrl);
  },
});

export { expect };
