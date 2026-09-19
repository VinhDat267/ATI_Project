import { describe, expect, it, vi } from "vitest";
import {
  createLiveFixture,
  type ApiFixture,
} from "../live/cleanup.js";
import type { PreviewServer } from "vite";

describe("createLiveFixture — Setup Failure Cleanup", () => {
  const makeFakeApi = (): ApiFixture => ({
    baseUrl: "http://127.0.0.1:3999",
    databaseUrl: "postgresql://wap:wap@127.0.0.1:55432/api_it_test",
    email: "test@ati.local",
    password: "secret-password",
    b02Prompt: "test prompt",
    login: vi.fn().mockResolvedValue("fake-token"),
    call: vi.fn().mockResolvedValue(new Response()),
    close: vi.fn().mockResolvedValue(undefined),
  });

  const makeFakePreview = (address: any = { port: 4999 }): PreviewServer =>
    ({
      httpServer: {
        address: () => address,
      },
      close: vi.fn().mockResolvedValue(undefined),
    }) as unknown as PreviewServer;

  it("closes API fixture when preview server fails to start", async () => {
    const fakeApi = makeFakeApi();
    const previewError = new Error("Vite preview port bind failed");

    await expect(
      createLiveFixture({
        makeApiFixture: vi.fn().mockResolvedValue(fakeApi),
        startPreview: vi.fn().mockRejectedValue(previewError),
      }),
    ).rejects.toThrow("Vite preview port bind failed");

    expect(fakeApi.close).toHaveBeenCalledTimes(1);
  });

  it("closes both preview and API when preview address is invalid", async () => {
    const fakeApi = makeFakeApi();
    const fakePreview = makeFakePreview(null); // Invalid address

    await expect(
      createLiveFixture({
        makeApiFixture: vi.fn().mockResolvedValue(fakeApi),
        startPreview: vi.fn().mockResolvedValue(fakePreview),
      }),
    ).rejects.toThrow("Failed to obtain dynamic port for Vite preview server");

    expect(fakePreview.close).toHaveBeenCalledTimes(1);
    expect(fakeApi.close).toHaveBeenCalledTimes(1);
  });

  it("still attempts API close even if preview close throws during cleanup", async () => {
    const fakeApi = makeFakeApi();
    const fakePreview = makeFakePreview(null);
    (fakePreview.close as any).mockRejectedValue(new Error("Preview close failed"));

    await expect(
      createLiveFixture({
        makeApiFixture: vi.fn().mockResolvedValue(fakeApi),
        startPreview: vi.fn().mockResolvedValue(fakePreview),
      }),
    ).rejects.toThrow(/Failed to obtain dynamic port/);

    expect(fakePreview.close).toHaveBeenCalledTimes(1);
    expect(fakeApi.close).toHaveBeenCalledTimes(1);
  });

  it("restores environment variables on setup failure", async () => {
    process.env.WAP_API_TARGET = "original-target";
    const fakeApi = makeFakeApi();

    await expect(
      createLiveFixture({
        makeApiFixture: vi.fn().mockResolvedValue(fakeApi),
        startPreview: vi.fn().mockRejectedValue(new Error("Preview crash")),
      }),
    ).rejects.toThrow("Preview crash");

    expect(process.env.WAP_API_TARGET).toBe("original-target");
  });
});
