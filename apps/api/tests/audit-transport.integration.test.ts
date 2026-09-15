import { expect, it } from "vitest";
import { makeApiFixture } from "./fixture.js";

it("does not report a closed real MCP transport as connected", async () => {
  const f = await makeApiFixture({ workerEnabled: true });
  try {
    const token = await f.login();
    const headers = { authorization: `Bearer ${token}` };
    const before = await f.call("/servers", { headers });
    expect(await before.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slug: "task_hub", status: "connected" }),
      ]),
    );
    await f.gateway!.close();
    const after = await f.call("/servers", { headers });
    expect(after.status).toBe(200);
    expect(await after.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slug: "task_hub", status: "error" }),
      ]),
    );
  } finally {
    await f.close();
  }
});
