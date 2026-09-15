import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RunDetailSchema } from "@wap/dsl/browser";

const rootElement = document.getElementById("app");
if (!rootElement) {
  throw new Error("Root element #app not found");
}

const sample = {
  run_id: "00000000-0000-4000-8000-000000000001",
  status: "planning" as const,
  workflow_version_id: null,
  plan: null,
  planner_result: null,
  approval: null,
  time_zone: "Asia/Ho_Chi_Minh",
  runtime: {},
  last_seq: 0,
};

const parsed = RunDetailSchema.parse(sample);

createRoot(rootElement).render(
  <StrictMode>
    <main style={{ padding: "24px", fontFamily: "sans-serif" }}>
      <h1>ATI Workflow Platform</h1>
      <p id="smoke-status">Trạng thái khởi tạo: {parsed.status}</p>
    </main>
  </StrictMode>
);
