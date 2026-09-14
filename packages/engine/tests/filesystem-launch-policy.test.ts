import { afterEach, describe, expect, it } from "vitest";
import { loadFilesystemLaunch } from "../src/launch-policy.js";

const original = process.env.G1_FILESYSTEM_ENABLED;
afterEach(() => {
  if (original === undefined) delete process.env.G1_FILESYSTEM_ENABLED;
  else process.env.G1_FILESYSTEM_ENABLED = original;
});

describe("filesystem launch policy", () => {
  it("keeps the default CLI launch disabled", async () => {
    delete process.env.G1_FILESYSTEM_ENABLED;
    await expect(
      loadFilesystemLaunch(process.cwd(), "00000000-0000-4000-8000-000000000001"),
    ).resolves.toBeUndefined();
  });

  it("fails closed when enabled but the trusted demo root is missing", async () => {
    process.env.G1_FILESYSTEM_ENABLED = "1";
    await expect(
      loadFilesystemLaunch(process.cwd(), "00000000-0000-4000-8000-000000000001"),
    ).rejects.toMatchObject({ code: "CONFIG" });
  });

  it("rejects arbitrary flag values instead of silently downgrading", async () => {
    process.env.G1_FILESYSTEM_ENABLED = "maybe";
    await expect(
      loadFilesystemLaunch(process.cwd(), "00000000-0000-4000-8000-000000000001"),
    ).rejects.toMatchObject({ code: "CONFIG" });
  });
});
