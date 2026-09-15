import { describe, expect, it } from "vitest";
import path from "node:path";
import { makeApiFixture } from "./fixture.js";

type ApprovalRef = {
  id: string;
  workflow_version_id: string;
  snapshot_hash: string;
};

describe("API-05 loopback acceptance", () => {
  it("runs the b02 lifecycle over HTTP, drains events, trace and reconciliation", async () => {
    const fixture = await makeApiFixture({
      plannerMode: "dev_fixture",
      workerEnabled: true,
    });
    try {
      const token = await fixture.login();
      const created = await fixture.call("/runs", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ source_prompt: fixture.b02Prompt }),
      });
      expect(created.status).toBe(202);
      const { run_id } = (await created.json()) as { run_id: string };
      const beforeWrites = await fixture.db
        .client`SELECT count(*)::int AS n FROM hub_receipts WHERE user_id=${fixture.userId}`;
      let seq = 0;
      const seen: number[] = [];
      let approval: ApprovalRef | null = null;
      let terminal = "";
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        const events = await fixture.call(
          `/runs/${run_id}/events?since_seq=${seq}`,
          { headers: { authorization: `Bearer ${token}` } },
        );
        expect(events.status).toBe(200);
        const page = (await events.json()) as {
          events: Array<{ seq: number }>;
          next_seq: number;
        };
        for (const event of page.events) {
          expect(event.seq).toBeGreaterThan(seq);
          seen.push(event.seq);
          seq = event.seq;
        }
        const detail = (await fixture
          .call(`/runs/${run_id}`, {
            headers: { authorization: `Bearer ${token}` },
          })
          .then((r) => r.json())) as {
          status: string;
          approval?: ApprovalRef | null;
        };
        const currentApproval = detail.approval;
        if (
          detail.status === "awaiting_approval" &&
          currentApproval &&
          !approval
        ) {
          approval = currentApproval;
          const writes = await fixture.db
            .client`SELECT count(*)::int AS n FROM hub_receipts WHERE user_id=${fixture.userId}`;
          expect(writes).toEqual(beforeWrites);
          const decided = await fixture.call(`/runs/${run_id}/approval`, {
            method: "POST",
            headers: {
              authorization: `Bearer ${token}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              approval_id: currentApproval.id,
              workflow_version_id: currentApproval.workflow_version_id,
              snapshot_hash: currentApproval.snapshot_hash,
              decision: "approved",
            }),
          });
          expect(decided.status).toBe(200);
        }
        terminal = detail.status;
        if (
          [
            "succeeded",
            "failed",
            "reconciliation_required",
            "cancelled",
            "expired",
            "rejected",
            "refused",
            "needs_input",
          ].includes(terminal)
        )
          break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(approval).not.toBeNull();
      expect(terminal).toBe("succeeded");
      expect(seen.length).toBeGreaterThan(0);
      const tracePages: unknown[] = [];
      let cursor = "";
      do {
        const response = await fixture.call(
          `/runs/${run_id}/trace${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
          { headers: { authorization: `Bearer ${token}` } },
        );
        expect(response.status).toBe(200);
        const page = (await response.json()) as {
          attempts: unknown[];
          next_cursor: string | null;
        };
        tracePages.push(...page.attempts);
        cursor = page.next_cursor ?? "";
      } while (cursor);
      expect(tracePages.length).toBeGreaterThan(0);
      const reconciliation = await fixture.call(
        `/runs/${run_id}/reconciliation`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      expect(reconciliation.status).toBe(200);
      expect(await reconciliation.json()).toMatchObject({
        run_id,
        read_only: true,
      });
      const afterWrites = await fixture.db
        .client`SELECT count(*)::int AS n FROM hub_receipts WHERE user_id=${fixture.userId}`;
      expect(afterWrites[0]!.n).toBeGreaterThan(beforeWrites[0]!.n);
    } finally {
      await fixture.close();
    }
  }, 60_000);

  it("runs the two-server filesystem fixture only after HTTP approval", async () => {
    const fixture = await makeApiFixture({
      plannerMode: "dev_fixture",
      workerEnabled: true,
      filesystemEnabled: true,
    });
    try {
      const token = await fixture.login();
      const created = await fixture.call("/runs", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ source_prompt: fixture.fsCopyPrompt }),
      });
      expect(created.status).toBe(202);
      const { run_id } = (await created.json()) as { run_id: string };
      const deadline = Date.now() + 30_000;
      let detail: {
        status: string;
        approval?: {
          id: string;
          workflow_version_id: string;
          snapshot_hash: string;
        } | null;
      } = { status: "" };
      while (Date.now() < deadline) {
        detail = (await fixture
          .call(`/runs/${run_id}`, {
            headers: { authorization: `Bearer ${token}` },
          })
          .then((r) => r.json())) as typeof detail;
        if (detail.status === "awaiting_approval") break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(detail.status).toBe("awaiting_approval");
      expect(fixture.allowedRoot).toBeTruthy();
      const target = path.join(
        fixture.allowedRoot!,
        "reports",
        "notes-copy.txt",
      );
      const fs = await import("node:fs/promises");
      await expect(fs.access(target)).rejects.toThrow();
      const approval = detail.approval!;
      const decided = await fixture.call(`/runs/${run_id}/approval`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          approval_id: approval.id,
          workflow_version_id: approval.workflow_version_id,
          snapshot_hash: approval.snapshot_hash,
          decision: "approved",
        }),
      });
      expect(decided.status).toBe(200);
      let status = detail.status;
      while (Date.now() < deadline) {
        status = (
          (await fixture
            .call(`/runs/${run_id}`, {
              headers: { authorization: `Bearer ${token}` },
            })
            .then((r) => r.json())) as { status: string }
        ).status;
        if (["succeeded", "failed", "reconciliation_required"].includes(status))
          break;
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      expect(status).toBe("succeeded");
      expect(await fs.readFile(target, "utf8")).toBe(
        "Tiến độ ATI\nAPI: Done\n",
      );
      const markers = await fixture.db
        .client`SELECT count(*)::int AS n FROM filesystem_dispatches WHERE run_id=${run_id}`;
      const receipts = await fixture.db
        .client`SELECT count(*)::int AS n FROM hub_receipts WHERE user_id=${fixture.userId}`;
      expect(markers[0]!.n).toBe(1);
      expect(receipts[0]!.n).toBe(1);
    } finally {
      await fixture.close();
    }
  }, 60_000);
});
