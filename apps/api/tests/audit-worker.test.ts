import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

describe("worker infrastructure failures", () => {
  it("keeps its process alive and retries a transient outbox query failure", () => {
    const root = path.resolve(
      fileURLToPath(new URL("../../../", import.meta.url)),
    );
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `
      import {createPrepareWorker} from './apps/api/src/worker.ts';
      let queries=0;
      const worker=createPrepareWorker({
        db:{client:async()=>{if(++queries===1) throw new Error('synthetic private DB failure');return [];}},
        engine:{recoverOrphans:async()=>[]},userId:'00000000-0000-4000-8000-000000000001',intervalMs:20,
      });
      worker.start();
      await new Promise(r=>setTimeout(r,300));
      await worker.stop();
      if(queries<2) throw new Error('query was never retried');
      console.log('survived');
    `,
      ],
      { cwd: root, encoding: "utf8", timeout: 5000, windowsHide: true },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("survived");
    expect(result.stderr).not.toContain("synthetic private");
  });
});
