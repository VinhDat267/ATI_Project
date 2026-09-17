import { describe, expect, it } from "vitest";
import { makeApiFixture } from "./fixture.js";

async function createRun(
  fixture: Awaited<ReturnType<typeof makeApiFixture>>,
  token: string,
) {
  const response = await fixture.call("/runs", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ source_prompt: fixture.b02Prompt }),
  });
  expect(response.status).toBe(202);
  return (await response.json()) as { run_id: string };
}

describe("API-04 cancellation and expiry", () => {
  it("cancels queued planning runs and rejects a second terminal cancel", async () => {
    const fixture = await makeApiFixture({
      workerEnabled: false,
      plannerMode: "dev_fixture",
    });
    try {
      const token = await fixture.login();
      const { run_id } = await createRun(fixture, token);
      const cancel = await fixture.call(`/runs/${run_id}/cancel`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: "{}",
      });
      expect(cancel.status).toBe(202);
      expect(
        await fixture
          .call(`/runs/${run_id}`, {
            headers: { authorization: `Bearer ${token}` },
          })
          .then((r) => r.json()),
      ).toMatchObject({ status: "cancelled" });
      const second = await fixture.call(`/runs/${run_id}/cancel`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: "{}",
      });
      expect(second.status).toBe(409);
    } finally {
      await fixture.close();
    }
  });

  it("expires pending approvals using the database clock", async () => {
    const fixture = await makeApiFixture({
      workerEnabled: true,
      plannerMode: "dev_fixture",
    });
    try {
      const token = await fixture.login();
      const { run_id } = await createRun(fixture, token);
      const deadline = Date.now() + 15_000;
      let approvalId = "";
      while (Date.now() < deadline) {
        const detail = (await fixture
          .call(`/runs/${run_id}`, {
            headers: { authorization: `Bearer ${token}` },
          })
          .then((r) => r.json())) as {
          status: string;
          approval?: { id: string } | null;
        };
        if (detail.status === "awaiting_approval") {
          approvalId = detail.approval!.id;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(approvalId).toBeTruthy();
      await fixture.db
        .client`UPDATE approvals SET expires_at=clock_timestamp()-interval '1 second' WHERE id=${approvalId}`;
      let status = "";
      while (Date.now() < deadline + 5_000) {
        status = (
          (await fixture
            .call(`/runs/${run_id}`, {
              headers: { authorization: `Bearer ${token}` },
            })
            .then((r) => r.json())) as { status: string }
        ).status;
        if (status === "expired") break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(status).toBe("expired");
      expect(
        await fixture.db.client`
          SELECT count(*)::int AS n FROM hub_receipts
          WHERE user_id=${fixture.userId}`,
      ).toEqual([{ n: 0 }]);
      const cancel = await fixture.call(`/runs/${run_id}/cancel`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: "{}",
      });
      expect(cancel.status).toBe(409);
    } finally {
      await fixture.close();
    }
  }, 45_000);
});
