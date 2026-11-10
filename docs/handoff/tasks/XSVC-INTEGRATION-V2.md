# Task Card: `XSVC-INTEGRATION-V2` — ATI V3 Cross-Service Integration Gate V2 (Sheets `#306` + Trello `#313` + Calendar `#314`)

- **Mã task:** `XSVC-INTEGRATION-V2`
- **Nhánh tích hợp cô lập:** `VinhDat267/ati-v3-cross-service-integration-gate`
- **Worktree chuyên dụng:** `C:\Users\VinhDat\orca\workspaces\ATI_Project\ati-v3-cross-service-integration-gate`
- **Trạng thái tổng thể:** `IN PROGRESS` (`Task A: COMPLETED`; `Tasks B–E: PENDING / NOT RUN`)
- **Tài liệu chuẩn tắc:** `AGENTS.md` (v3.1), `docs/superpowers/specs/2026-09-29-ai-workflow-platform-v3-design.md`, `docs/team-workflow.md`, `docs/handoff/REVIEW-CHECKLIST.md`
- **Hồ sơ kiểm toán (Audit Bundle):** `docs/audits/2026-11-10-cross-service-integration/` (`01`..`08`)

---

## 1. Mục tiêu (Objective)

Hợp nhất có truy vết nguồn gốc (traceable `--no-ff` merges), kiểm thử liên dịch vụ thực chứng (PostgreSQL 16 thật + đa tiến trình OS + Chromium E2E + loopback HTTP) và nghiệm thu kỹ thuật **Gate A** cho một cây mã kết hợp duy nhất từ 3 Draft PR đã xanh CI trên cùng nền `origin/main`:

| Vai trò | Tham chiếu / PR | Commit SHA cố định | Tree SHA | GitHub Actions `v3 check` |
| --- | --- | --- | --- | --- |
| **Baseline** | `origin/main` | `2eed8d1d4309e833088d6f1d3fa774189049e283` | `eb2ee6f1183eb0cdc51adfa238e3043a0b4ed4b4` | Baseline `main` |
| **Trello Combined** | PR `#313` (`VinhDat267/trello-v3-combined-gate`) | `1c17527f16715b2c6655c170cdb448673a84dd1b` | `f53ed6b2b7cfdeae0f27d18e1fc7831cc69f7d76` | [`42809170181`](https://github.com/VinhDat267/ATI_Project/actions/runs/42809170181) (`success`) |
| **Calendar Combined** | PR `#314` (`VinhDat267/calendar-v3-combined-gate`) | `3807986542dbe3470b8f3f1cd42413cb7bd460dd` | `8805043497bfffe05d9620c520d098abfb00a60c` | [`42835422010`](https://github.com/VinhDat267/ATI_Project/actions/runs/42835422010) (`success`) |
| **Sheets R2** | PR `#306` (`VinhDat267/sheets-gas-recovery-guard-argon`) | `f292884d0ae965ffb9841e7063b8843cd266b17e` | `a9ca98c257a99da8b8d1fde266091f2a3897719b` | [`42811254062`](https://github.com/VinhDat267/ATI_Project/actions/runs/42811254062) (`success`) |

> **Cấm tích hợp riêng lẻ PR thành phần:** Không merge riêng các PR con `#309`, `#310`, `#311` (đã nằm trong `#313`) hoặc `#307`, `#308`, `#312` (đã nằm trong `#314`). Mọi dịch chuyển SHA nguồn phải dừng lại báo `NEEDS OWNER DECISION`, tuyệt đối không tự ý thay thế ngầm.

---

## 2. Phạm vi & Ràng buộc An toàn (Scope & Safety Guardrails)

1. **Cô lập tuyệt đối worktree:** Chỉ thao tác trên `C:\Users\VinhDat\orca\workspaces\ATI_Project\ati-v3-cross-service-integration-gate` (`VinhDat267/ati-v3-cross-service-integration-gate`). Không tạo nested worktree bên trong thư mục này; không đụng chạm `main` đang dở, các nhánh/worktree khác của agent khác, `docs/handoff/CURRENT-STATE.md` hoặc `docs/handoff/ROADMAP.md`.
2. **Không tác động môi trường thật:** Chỉ dùng loopback HTTP (`127.0.0.1`) và PostgreSQL 16 dùng riêng cho kiểm thử. Không gọi API thật Google/Trello/Slack/Telegram, không gửi email mời họp thật, không chạy migration/flag trên môi trường production, **không merge vào `main`**, **không chuyển PR khỏi trạng thái `Draft`**.
3. **Giữ nguyên kiến trúc chuẩn tắc:** Không nới lỏng `evaluations/generic-plumbing/static-guard.test.ts` (`adapter-factory.ts` và `schedule-service.ts`), không thêm cơ chế tự động retry cho trạng thái `unknown`, chỉ sửa tích hợp tối thiểu theo TDD (`RED -> GREEN`) khi tái hiện lỗi tương tác liên PR.

---

## 3. Lộ trình DAG & Phân quyền Sở hữu File (Task DAG A → B → C/D → E)

- **Task A — Preflight, Conflict Matrix & Execution Plan (`COMPLETED`):**
  - Sở hữu độc quyền: `docs/audits/2026-11-10-cross-service-integration/01-INTEGRATION-EXECUTION-PLAN.md`, `03-SHARED-FILE-CONFLICT-AND-CONTRACT-MATRIX.md`, `docs/handoff/tasks/XSVC-INTEGRATION-V2.md`, và `docs/handoff/log/2026-11-10-xsvc-integration-v2-preflight-plan.md`.
  - Chỉ đọc + kiểm tra khả thi `git merge-tree --write-tree`; **chưa merge, chưa sửa mã nguồn, chưa push/mở PR**.
- **Task B — Branch Assembly & Conflict Resolution (`PENDING`):**
  - Merge có truy vết theo thứ tự `Trello (#313) -> Calendar (#314) -> Sheets (#306)` (`M0`, `M1`, `M2`), giải quyết 3 xung đột văn bản (`schedule-service.ts`, `slack-adapter.ts`, `scripts/test-v3-browser.mjs`) và căn chỉnh đoạn tổng quan Google trong `PrivacyPage.tsx` theo đúng hợp đồng tại `03-SHARED-FILE-CONFLICT-AND-CONTRACT-MATRIX.md`.
  - Xuất `02-SOURCE-ANCESTRY-AND-MERGE-EVIDENCE.md`.
- **Task C — Backend, DB Migrations (`0001..0035`), Concurrency, Crash/Kill & Negative Auth (`PENDING`):**
  - Sở hữu kiểm thử/sửa lỗi tích hợp tầng `packages/**`, `apps/chat-api/**`, `db/v3/**` (tạo `apps/chat-api/tests/services/schedules/cross-service-combined-gate.test.ts`).
  - Chứng minh trên PostgreSQL 16 thật (fresh `0001..0035` + upgrade `<=0032 -> 0033 -> 0034 -> 0035`), 3 digest đến hạn đồng thời, 2 tiến trình OS `ScheduleRunner`, kill tiến trình con (`SIGKILL`) + `reconcileScheduleRuns`, thu hồi credential trước khi gửi, ma trận negative auth (`outbound === 0`), biên nhận lỗi (`ts: {}`, `ts: 12345`, `ts: 'undefined'`) và append lease fencing.
- **Task D — Frontend, Privacy, Recovery UI & Chromium E2E (`PENDING`):**
  - Sở hữu kiểm thử/sửa lỗi tích hợp tầng `apps/chat-web/**`, `scripts/test-v3-browser.mjs` (mở rộng `apps/chat-web/tests/browser/mycalendar.spec.ts` cho `C1/C2` cross-midnight/DST/IANA approved instant, `sendInvites` và recurring `timeZone` trên Chromium thật, cùng recovery/privacy của Sheets & Trello).
- **Task E — Full Gate D, Draft PR, Exact-Head CI & Final Verdict (`PENDING`):**
  - Chạy trọn vẹn `npm run check` + `npm run test:browser:v3` (đủ **25** nhóm kịch bản), mở **Draft PR**, xác minh GitHub Actions `v3 check` xanh trên đúng `HEAD` cuối, hoàn thiện bộ hồ sơ `04..08`.

---

## 4. Lệnh Kiểm tra Chuẩn (Supported Commands)

```powershell
# Layer A: Build, Typecheck, Static Guard & Targeted Suites
npm run build --workspaces --if-present
npm run typecheck:v3
npx vitest run evaluations/generic-plumbing/static-guard.test.ts

# Layer B: Migrations & Backend Real-PostgreSQL Suites
npm run db:migrate:v3
npm test --workspace=@wap/tool-schemas
npm test --workspace=@wap/tool-adapters
npm test --workspace=@wap/planner
npm test --workspace=@wap/executor
npm test --workspace=@wap/chat-api

# Layer C & D: Frontend Unit, Full Check & All 25 Browser E2E Scenarios
npm test --workspace=@wap/chat-web
npm run check
npm run test:browser:v3
```

---

## 5. Kết quả (Results)

### 5.1. Kết quả Task A (Preflight & Implementation Plan — `COMPLETED` `2026-11-10`)
- **Xác thực nguồn & môi trường (`INDEPENDENTLY VERIFIED`):**
  - Đã kiểm tra lại `origin/main` (`2eed8d1d4309e833088d6f1d3fa774189049e283`), PR `#306` (`f292884d0ae965ffb9841e7063b8843cd266b17e`, CI `42811254062` `success`), PR `#313` (`1c17527f16715b2c6655c170cdb448673a84dd1b`, CI `42809170181` `success`), và PR `#314` (`3807986542dbe3470b8f3f1cd42413cb7bd460dd`, CI `42835422010` `success`) — không có thay đổi ngầm so với baseline.
  - `.codegraph` không tồn tại tại gốc worktree (`Test-Path .codegraph` -> `False`); sử dụng fallback đọc có giới hạn bằng `git diff`, `git merge-tree --write-tree` và `read_file`.
  - Cấu hình model thực tế: `Gemini 4 Carbon (High)` tại `settings.json:3` & `transcript.jsonl` step `0`, mức nỗ lực `EFFORT LEVEL: 1.00` (`high`), không cấu hình fallback (wire header phản hồi từ upstream provider không lưu trong log cục bộ -> `NOT VERIFIED`).
- **Kiểm kê file & Ma trận xung đột (`INDEPENDENTLY VERIFIED`):**
  - Tổng cộng **106** file thay đổi duy nhất so với `2eed8d1d4309e833088d6f1d3fa774189049e283` (`38` file ở `#306`, `42` file ở `#313`, `36` file ở `#314`; chỉ `#306` thêm migration `db/v3/0035_sheets_gas_r2_remediation.sql`).
  - Giao ba (`#313 ∩ #314 ∩ #306`): **0** file. Giao đôi: **10** file (`1` file `#313 ∩ #314`: `chat-service.ts`; `1` file `#314 ∩ #306`: `PrivacyPage.tsx`; `8` file `#313 ∩ #306`).
  - Thử nghiệm `git merge-tree --write-tree` chỉ đọc:
    - Bước 1 (`#313 + #314`): `exit 0`, tree `b44810211e75698da038a84acbe4ff66aca3b969` (0 xung đột).
    - Bước 2 (`( #313 + #314 ) + #306` với `--merge-base=2eed8d1d...`): `exit 1`, tree `13a7adfb713dad9b1ddc086d984f8fdabb37b79b`, đúng **3** file xung đột văn bản (`apps/chat-api/src/services/schedules/schedule-service.ts`, `packages/tool-adapters/src/slack/slack-adapter.ts`, `scripts/test-v3-browser.mjs`).
  - Phát hiện quan trọng trước khi merge: trong `SlackAdapter.sendMessage`, biểu thức `String(res.ts).trim()` của `#313` nếu giữ nguyên một mình sẽ biến `ts: {}` thành `"[object Object]"` và `ts: 12345` thành `"12345"` (làm gãy `GAS-01` của `#306`), trong khi biểu thức của `#306` một mình bỏ sót `ts: 'undefined'`, `channel` rỗng và `details: { requestSent: true }` (làm gãy `TRELLO-AUDIT-08` của `#313`). Hợp đồng giao chặt đã được khóa trước tại `03-SHARED-FILE-CONFLICT-AND-CONTRACT-MATRIX.md`.
- **Sản phẩm bàn giao Task A:**
  - `docs/audits/2026-11-10-cross-service-integration/01-INTEGRATION-EXECUTION-PLAN.md`
  - `docs/audits/2026-11-10-cross-service-integration/03-SHARED-FILE-CONFLICT-AND-CONTRACT-MATRIX.md`
  - `docs/handoff/tasks/XSVC-INTEGRATION-V2.md`
  - `docs/handoff/log/2026-11-10-xsvc-integration-v2-preflight-plan.md`

### 5.2. Kết quả Tasks B, C, D, E (`PENDING / NOT RUN`)
- Chưa thực thi merge, chưa sửa mã nguồn, chưa chạy kiểm thử tích hợp trên cây gộp, chưa push hoặc mở Draft PR trong phạm vi Task A. Sẽ được điền tiếp ở các pha thực thi kế tiếp.
