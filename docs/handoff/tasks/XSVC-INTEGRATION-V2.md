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

1. **Cô lập tuyệt đối worktree & quy tắc song song Task C/D:** Chỉ thao tác trên `C:\Users\VinhDat\orca\workspaces\ATI_Project\ati-v3-cross-service-integration-gate` (`VinhDat267/ati-v3-cross-service-integration-gate`). Không tạo nested worktree bên trong thư mục này; không đụng chạm `main` đang dở, các nhánh/worktree khác của agent khác, `docs/handoff/CURRENT-STATE.md` hoặc `docs/handoff/ROADMAP.md`. Tuyệt đối không cho 2 worker chạy đồng thời trên cùng một worktree: nếu chạy song song Task C và Task D, mỗi worker bắt buộc có `git worktree` cô lập riêng biệt; nếu chạy trên cùng worktree tích hợp thì phải bàn giao tuần tự từng pha một.
2. **Không tác động môi trường thật:** Chỉ dùng loopback HTTP (`127.0.0.1`) và PostgreSQL 16 dùng riêng, cô lập port cho kiểm thử (không nạp `.env` thật, không tái sử dụng DB/credential của tiến trình khác). Không gọi API thật Google/Trello/Slack/Telegram, không gửi email mời họp thật, không chạy migration/flag trên môi trường production, **không merge vào `main`**, **không chuyển PR khỏi trạng thái `Draft`**.
3. **Giữ nguyên kiến trúc chuẩn tắc & bộ nhãn nghiệm thu của Owner:**
   - Không nới lỏng `evaluations/generic-plumbing/static-guard.test.ts` (`adapter-factory.ts` và `schedule-service.ts`), không thêm cơ chế tự động retry cho trạng thái `unknown`, không bịa đặt mã lỗi không tồn tại trong code, chỉ sửa tích hợp tối thiểu theo TDD (`RED -> GREEN`) khi tái hiện lỗi tương tác liên PR.
   - **Gate A (4 kết luận hợp lệ duy nhất):** `PASS — VERIFIED WITHIN TESTED SCOPE`, `CONDITIONAL — NON-BLOCKING GAPS`, `NOT READY — BLOCKING DEFECT OR MISSING CRITICAL EVIDENCE`, `FAIL — CONFIRMED REGRESSION`.
   - **Gate B (2 kết luận hợp lệ duy nhất):** `MERGE READY FOR OWNER REVIEW` hoặc `NOT READY`.
   - **Gate C:** `PRODUCTION ACTIVATION — HOLD`.
   - **Quy tắc tương đương cây mã (Tree Equivalence):** Chỉ được kết luận tương đương tuyệt đối khi SHA full-tree (`HEAD^{tree}`) trùng khớp hoàn toàn 100% không loại trừ bất kỳ đường dẫn nào; mọi khác biệt chỉ gồm tài liệu phải công bố tách biệt.

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
  - Chạy trọn vẹn `npm run check` + `node scripts/test-v3-browser.mjs` / `npm run test:browser:v3` (đủ **25** nhóm kịch bản), mở **Draft PR**, xác minh workflow `.github/workflows/v3-check.yml` (`v3 check`, gồm **1 job duy nhất `v3`** chạy cả `npm run check` lẫn `npm run test:browser:v3`) xanh trên đúng `HEAD` cuối, hoàn thiện bộ hồ sơ `04..08`.

---

## 4. Lệnh Kiểm tra Chuẩn (Actual Verified Package Scripts)

```powershell
# Layer A: Web Build, Typecheck, Evaluations (incl. Static Guard) & Targeted Suites
# Lưu ý: chỉ @wap/chat-web định nghĩa script "build" (npm run build:v3); không tồn tại eval:security hay check:plumbing.
npm run build:v3
npm run typecheck:v3
npm run test:eval:v3
npx vitest run evaluations/generic-plumbing/static-guard.test.ts

# Layer B: Migrations & Backend Real-PostgreSQL Suites (với DATABASE_URL cô lập, không nạp live .env)
node db/v3/migrate.mjs
npm test --workspace=@wap/tool-schemas
npm test --workspace=@wap/tool-adapters
npm test --workspace=@wap/planner
npm test --workspace=@wap/executor
npm test --workspace=@wap/chat-api

# Layer C & D: Frontend Unit, Full Check & All 25 Browser E2E Scenarios
# Root "check" thực tế trong package.json:
# npm run typecheck:v3 && npm run test:v3 && npm run test:eval:v3 && npm run build:v3 && node scripts/test-v3-web-build-security.mjs && npm run test:launcher:v3 && node --test scripts/v3-local-env.test.mjs scripts/fake-oidc.test.mjs scripts/google-oidc-fixture.test.mjs scripts/slack/inventory.test.mjs scripts/fake-slack-personal.test.mjs scripts/slack/contract-probe.test.mjs
npm test --workspace=@wap/chat-web
npm run check
node scripts/test-v3-browser.mjs
```

---

## 5. Kết quả (Results)

### 5.1. Kết quả Task A (Preflight & Implementation Plan — `COMPLETED` `2026-11-10`; đính chính provenance đầu Task B)
- **Xác thực nguồn & môi trường (`INDEPENDENTLY VERIFIED`):**
  - Đã kiểm tra lại `origin/main` (`2eed8d1d4309e833088d6f1d3fa774189049e283`), PR `#306` (`f292884d0ae965ffb9841e7063b8843cd266b17e`, CI `42811254062` `success`), PR `#313` (`1c17527f16715b2c6655c170cdb448673a84dd1b`, CI `42809170181` `success`), và PR `#314` (`3807986542dbe3470b8f3f1cd42413cb7bd460dd`, CI `42835422010` `success`) — không có thay đổi ngầm so với baseline.
  - `.codegraph` không tồn tại tại gốc worktree (`Test-Path .codegraph` -> `False`); sử dụng fallback đọc có giới hạn bằng `git diff`, `git merge-tree --write-tree` và `read_file`.
  - Cấu hình model thực tế: Orca `worker-show` `launch.effective = antigravity/gemini-4-carbon-high/high` (đã được coordinator Codex xác minh độc lập), `Gemini 4 Carbon (High)` tại `settings.json:3` & `transcript.jsonl` step `0`, mức nỗ lực `EFFORT LEVEL: 1.00` (`high`), không cấu hình fallback; raw wire header từ upstream provider không lưu trong log cục bộ -> `NOT VERIFIED`.
- **Kiểm kê file & Ma trận xung đột (`INDEPENDENTLY VERIFIED`):**
  - Tổng cộng **106** file thay đổi duy nhất so với `2eed8d1d4309e833088d6f1d3fa774189049e283` (`38` file ở `#306`, `42` file ở `#313`, `36` file ở `#314`; chỉ `#306` thêm migration `db/v3/0035_sheets_gas_r2_remediation.sql`).
  - Giao ba (`#313 ∩ #314 ∩ #306`): **0** file. Giao đôi: **10** file (`1` file `#313 ∩ #314`: `chat-service.ts`; `1` file `#314 ∩ #306`: `PrivacyPage.tsx`; `8` file `#313 ∩ #306`).
  - Thử nghiệm `git merge-tree --write-tree` chỉ đọc:
    - Bước 1 (`#313 + #314`): `exit 0`, tree `b44810211e75698da038a84acbe4ff66aca3b969` (0 xung đột).
    - Bước 2 (`( #313 + #314 ) + #306` với `--merge-base=2eed8d1d...`): `exit 1`, tree `13a7adfb713dad9b1ddc086d984f8fdabb37b79b`, đúng **3** file xung đột văn bản (`apps/chat-api/src/services/schedules/schedule-service.ts`, `packages/tool-adapters/src/slack/slack-adapter.ts`, `scripts/test-v3-browser.mjs`).
  - Phát hiện rủi ro hợp đồng dùng chung (`SHARED CONTRACT RISK`) trước khi merge: trong `SlackAdapter.sendMessage` (nền `2eed8d1d` dùng `String(res.ts)`), bản `#313` đã kiểm tra `typeof res?.ts === 'string'`, từ chối `'undefined'` và gắn `details: { requestSent: true }`, nhưng lại fallback về `args.channel` khi `res.channel` thiếu/không phải chuỗi và chưa chặn `'null'`; ngược lại bản `#306` kiểm tra `typeof res?.ts === 'string'` nhưng bỏ sót `'undefined'`/`'null'`, không kiểm tra `res.channel` (vẫn fallback `args.channel`) và thiếu `details: { requestSent: true }` (`StepError` với `category: 'UNKNOWN'`, `retryable: false`). Hợp đồng giao chặt đã được khóa trước tại `03-SHARED-FILE-CONFLICT-AND-CONTRACT-MATRIX.md`.
- **Sản phẩm bàn giao Task A:**
  - `docs/audits/2026-11-10-cross-service-integration/01-INTEGRATION-EXECUTION-PLAN.md`
  - `docs/audits/2026-11-10-cross-service-integration/03-SHARED-FILE-CONFLICT-AND-CONTRACT-MATRIX.md`
  - `docs/handoff/tasks/XSVC-INTEGRATION-V2.md`
  - `docs/handoff/log/2026-11-10-xsvc-integration-v2-preflight-plan.md`

### 5.2. Kết quả Tasks B, C, D, E (`PENDING / NOT RUN`)
- Chưa thực thi merge, chưa sửa mã nguồn, chưa chạy kiểm thử tích hợp trên cây gộp, chưa push hoặc mở Draft PR trong phạm vi Task A. Sẽ được điền tiếp ở các pha thực thi kế tiếp.
