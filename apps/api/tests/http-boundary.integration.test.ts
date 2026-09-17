import { request } from "node:http";
import { describe, expect, it } from "vitest";
import { makeApiFixture } from "./fixture.js";

function sendChunked(
  baseUrl: string,
  token: string,
  chunks: string[],
): Promise<{ status: number; body: string }> {
  const target = new URL(`${baseUrl}/runs`);
  return new Promise((resolve, reject) => {
    const req = request(
      target,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => (body += chunk));
        response.on("end", () =>
          resolve({ status: response.statusCode ?? 0, body }),
        );
      },
    );
    req.on("error", reject);
    for (const chunk of chunks) req.write(chunk);
    req.end();
  });
}

describe("API request body boundary", () => {
  it("rejects malformed and oversized chunked run bodies without database mutation", async () => {
    const fixture = await makeApiFixture({
      workerEnabled: false,
      plannerMode: "dev_fixture",
    });
    try {
      const token = await fixture.login();
      const malformed = await sendChunked(fixture.baseUrl, token, [
        '{"source_',
        'prompt":',
      ]);
      expect(malformed.status).toBe(400);
      const oversized = await sendChunked(
        fixture.baseUrl,
        token,
        Array.from({ length: 65 }, () => "x".repeat(1024)),
      );
      expect(oversized.status).toBe(413);
      expect(
        await fixture.db.client`
          SELECT
            (SELECT count(*)::int FROM workflows) AS workflows,
            (SELECT count(*)::int FROM runs) AS runs,
            (SELECT count(*)::int FROM run_events) AS events,
            (SELECT count(*)::int FROM run_outbox) AS jobs`,
      ).toEqual([{ workflows: 0, runs: 0, events: 0, jobs: 0 }]);
    } finally {
      await fixture.close();
    }
  });
});
