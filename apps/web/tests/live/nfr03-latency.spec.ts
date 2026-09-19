import { test, expect } from "./fixtures.js";
import fs from "node:fs";
import path from "node:path";

interface LatencyObservation {
  seq: number;
  type: string;
  server_created_at: string;
  dom_rendered_at: string;
  latency_ms: number;
  event_seq?: number;
  event_type?: string;
  created_at?: string;
  delta_ms?: number;
}

test.describe("NFR-03 Latency Gate (Local p95 <= 3s)", () => {
  test("collects >= 30 event-to-DOM render latency samples and confirms p95 <= 3000ms", async ({
    page,
    liveContext,
  }) => {
    test.setTimeout(180_000);

    const observations: LatencyObservation[] = [];

    // Sign in
    await page.goto(`${liveContext.previewUrl}/#/login`);
    await page.getByLabel("Email").fill(liveContext.email);
    await page.getByLabel("Mật khẩu", { exact: true }).fill(liveContext.password);
    await page.getByRole("button", { name: "Đăng nhập" }).click();
    await expect(page.getByRole("heading", { name: "Tổng quan" })).toBeVisible();

    // Hook into window to observe DOM updates with timing
    await page.exposeFunction("__recordEventLatency", (obs: LatencyObservation) => {
      observations.push(obs);
    });

    // Run 3-4 runs sequentially to gather >= 30 event observations (each run produces 10-12 events)
    for (let runIdx = 0; runIdx < 4 && observations.length < 30; runIdx++) {
      await page.goto(`${liveContext.previewUrl}/#/new`);
      await page.locator("#request").fill(liveContext.b02Prompt);
      await page.getByRole("button", { name: "Lập kế hoạch" }).click();

      await page.waitForURL(/#\/runs\/[0-9a-f-]{36}/);

      const approveButton = page.getByRole("button", { name: /Duyệt \d+ thao tác ghi/ });
      await expect(approveButton).toBeVisible({ timeout: 25_000 });
      await approveButton.click();

      await expect(page.getByText("Hoàn tất").first()).toBeVisible({ timeout: 25_000 });

      // Extract events from controller snapshot and activity DOM
      const pageObservations: LatencyObservation[] = await page.evaluate(() => {
        const results: LatencyObservation[] = [];
        const rows = document.querySelectorAll("[data-event-seq]");
        rows.forEach((row) => {
          const seq = Number(row.getAttribute("data-event-seq"));
          const createdAt = row.getAttribute("data-event-created-at");
          const renderedAt = row.getAttribute("data-event-rendered-at") || new Date().toISOString();
          const type = row.getAttribute("data-event-type") || "unknown";
          if (seq && createdAt) {
            const rawLatency = new Date(renderedAt).getTime() - new Date(createdAt).getTime();
            const latency = Math.max(0, rawLatency);
            results.push({
              seq,
              type,
              server_created_at: createdAt,
              dom_rendered_at: renderedAt,
              latency_ms: latency,
              event_seq: seq,
              event_type: type,
              created_at: createdAt,
              delta_ms: latency,
            });
          }
        });
        return results;
      });

      observations.push(...pageObservations);
    }

    expect(observations.length).toBeGreaterThanOrEqual(30);

    const latencies = observations.map((o) => o.latency_ms).sort((a, b) => a - b);
    const p95Index = Math.floor(latencies.length * 0.95);
    const p95 = latencies[p95Index] ?? 0;
    const p50Index = Math.floor(latencies.length * 0.5);
    const p50 = latencies[p50Index] ?? 0;
    const min = latencies[0] ?? 0;
    const max = latencies[latencies.length - 1] ?? 0;
    const mean = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);

    const summary = {
      sample_count: observations.length,
      min_ms: min,
      max_ms: max,
      mean_ms: mean,
      p50_ms: p50,
      p95_ms: p95,
      p95_target_ms: 3000,
      pass: p95 <= 3000,
      observations,
    };

    // Save summary to cache directory for runner consumption
    const writeCache = (filePath: string) => {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(summary, null, 2), "utf8");
    };

    writeCache(path.resolve(process.cwd(), ".cache/nfr03-observations.json"));
    const repoRoot = path.resolve(process.cwd(), "../..");
    if (fs.existsSync(path.resolve(repoRoot, "package.json"))) {
      writeCache(path.resolve(repoRoot, ".cache/nfr03-observations.json"));
    }

    expect(p95).toBeLessThanOrEqual(3000);
  });
});
