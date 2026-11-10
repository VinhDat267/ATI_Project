# Task Card: `XSVC-INTEGRATION-V2` — ATI V3 Cross-Service Integration Gate V2 (Sheets `#306` + Trello `#313` + Calendar `#314`)

- **Mã task:** `XSVC-INTEGRATION-V2`
- **Nhánh tích hợp cô lập:** `VinhDat267/ati-v3-cross-service-integration-gate`
- **Worktree chuyên dụng:** `C:\Users\VinhDat\orca\workspaces\ATI_Project\ati-v3-cross-service-integration-gate`
- **Trạng thái tổng thể:** `IN PROGRESS` (`Tasks A, B & C: COMPLETED`; `Tasks D & E: PENDING / NOT RUN`)
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
- **Task B — Branch Assembly & Conflict Resolution (`COMPLETED`):**
  - Merge có truy vết theo thứ tự `Trello (#313) -> Calendar (#314) -> Sheets (#306)` (`M0`, `M1`, `M2`), giải quyết 3 xung đột văn bản (`schedule-service.ts`, `slack-adapter.ts`, `scripts/test-v3-browser.mjs`) và căn chỉnh đoạn tổng quan Google trong `PrivacyPage.tsx` theo đúng hợp đồng tại `03-SHARED-FILE-CONFLICT-AND-CONTRACT-MATRIX.md`.
  - Xuất `02-SOURCE-ANCESTRY-AND-MERGE-EVIDENCE.md`.
- **Task C — Backend, DB Migrations (`0001..0035`), Concurrency, Crash/Kill & Negative Auth (`COMPLETED`):**
  - Sở hữu kiểm thử/sửa lỗi tích hợp tầng `packages/**`, `apps/chat-api/**`, `db/v3/**` (tạo `apps/chat-api/tests/services/schedules/cross-service-combined-gate.test.ts` và `apps/chat-api/tests/helpers/cross-service-scheduler-worker.ts`).
  - Chứng minh trên PostgreSQL 16 thật (fresh `0001..0035` gồm **47** file `.sql` + upgrade `<=0032 -> 0033 -> 0034 -> 0035`), 3 digest đến hạn đồng thời (`S1`), 2 tiến trình OS `ScheduleRunner` (`S2`), tạm dừng/hủy trước và sau rào chắn gửi (`S3`), kill tiến trình con thật (`SIGKILL`, `S4a` & `S4b`) + `reconcileScheduleRuns` + append lease fencing, thu hồi credential trước khi gửi (`S5`), cô lập lỗi hỗn hợp (`S6`), và ma trận negative auth `N1`–`N7` (`unauthorizedOutbound === 0`).
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

### 5.2. Kết quả Task B (Branch Assembly, Shared Contract Resolutions & Focused Proofs — `COMPLETED` `2026-11-10`)
- **Đính chính provenance Task A trước khi merge (`f228d8a4159b944a466f246ec44a9b6e1b28b74c`, tree `ac3f4abdb526e51942303896a48999e4b251b671`):**
  - Đã chuẩn hóa tên script thực tế trong `package.json`, cấu trúc 1 job `v3` của `.github/workflows/v3-check.yml`, phân loại `SHARED CONTRACT RISK` (tách biệt giả thuyết trước merge với lỗi tái hiện thực tế), bộ nhãn kết luận chuẩn của Owner cho Gate A/B/C, quy tắc so sánh full-tree không loại trừ đường dẫn, nhãn `NO STATIC OVERLAP (RUNTIME NOT VERIFIED)`, và quy tắc cô lập worktree cho Task C/D.
- **Tái xác thực nguồn & chuỗi commit `--no-ff` (`INDEPENDENTLY VERIFIED`):**
  - Tái kiểm tra ngay trước khi merge (`git fetch origin --prune`, `gh pr view 313/314/306`): `origin/main` (`2eed8d1d4309e833088d6f1d3fa774189049e283`) và cả 3 Draft PR (`#313` `1c17527f...`, `#314` `38079865...`, `#306` `f292884d...`) không dịch chuyển SHA, giữ nguyên `OPEN` + `isDraft: true`.
  - **`M0` (`b0232fdd9f5f59c6d1b4c0fc2b882eaf2fcd8954`, tree `d896d0997d3b79f3265ad40ac10e306b717ac773`, parents `f228d8a4...` + `1c17527f...`):** Merge `--no-ff` PR `#313` Trello (`exit 0`, `0` xung đột).
  - **`M1` (`edbeeffeca97cdb95a4b5dec88f9ee61645910aa`, tree `021ce568864dbb9fb33e095e72bf8e820b0361e9`, parents `b0232fdd...` + `38079865...`):** Merge `--no-ff` PR `#314` Calendar (`exit 0`, auto-merge sạch `chat-service.ts`; kiểm tra trung gian `npm run typecheck:v3` `exit 0`).
  - **`M2` (`678c5337f0558c3158994825a23e9d09d6ad744c`, tree `6185a45a29537cad679a3b161ede539350696877`, parents `edbeeffe...` + `f292884d...`):** Merge `--no-ff` PR `#306` Sheets R2 và giải quyết đúng **3** xung đột văn bản (`schedule-service.ts`, `slack-adapter.ts`, `scripts/test-v3-browser.mjs`) không dùng `ours`/`theirs` mù quáng.
  - **Code+Test Anchor Commit (`07c086bfb5299632fc35dd85cbcf906ce4cd1099`, full-tree `fcd0e64019b0c70eb96f7e0d6352ead5f1fc7d4d`):** Căn chỉnh đoạn tổng quan `"Quyền truy cập Google"` trong `PrivacyPage.tsx` theo TDD (`PRIVACY_RED_EXIT=1` -> `PRIVACY_GREEN_EXIT=0`) và bổ sung 4 bộ kiểm thử hợp đồng gộp (`slack-adapter.test.ts`, `trello-telegram-delivery-invariants.test.ts`, `browser-scenario-selection.test.ts`, `calendar-rem-c-09-oauth-disclosure.test.tsx`).
  - Kiểm tra `git merge-base --is-ancestor <sha> 07c086bfb5299632fc35dd85cbcf906ce4cd1099` trả về `exit 0` cho cả `2eed8d1d`, `1c17527f`, `38079865` và `f292884d`.
- **Kết quả kiểm thử tập trung & chứng minh bắt lỗi hành vi sai (`INDEPENDENTLY VERIFIED` trên `07c086bf`, `has_dotenv=False`):**
  - `npm ci` (`exit 0`), `npm run build:v3` (`exit 0`, `214` modules), `npm run typecheck:v3` (`exit 0`), `npm test --workspace=@wap/tool-schemas` (`exit 0`, `27` files, `593` passed, `0` skipped), `npx vitest run evaluations/generic-plumbing/static-guard.test.ts` (`exit 0`, `2` passed, `0` skipped), `node scripts/test-v3-web-build-security.mjs` (`exit 0`).
  - 9 bộ kiểm thử non-DB (`slack-adapter.test.ts` loopback HTTP thật, `trello-audit-remediation.test.ts`, `browser-scenario-selection.test.ts` `25` kịch bản, `schedule-sheets-digest-v2.test.tsx`, `schedule-trello-digest-mode.test.tsx`, `mysheets-ui.test.tsx`, `calendar-rem-c-09-oauth-disclosure.test.tsx`, `packages/planner/tests/read-answers.test.ts`, `packages/planner/tests/schedules.test.ts`): `exit 0` (`9` files, `127` passed, `0` skipped).
  - 2 bộ kiểm thử recovery/snapshot PostgreSQL 16 trên container dùng một lần `ati-xsvc-v2-taskb-56789` (`127.0.0.1:56789/ati_v3_taskb`, `ALLOW_ISOLATED_TEST_PORT=1`, đã xóa sạch bằng `docker rm -f` sau khi chạy; không chạm `ati-cal-combined-gate-56657`): `sheets-gas-r2-remediation.test.ts` + `trello-telegram-delivery-invariants.test.ts` -> `exit 0` (`2` files, `22` passed, `0` skipped).
  - Kiểm chứng độ nhạy bắt lỗi gộp sai (mutation checks): thay tạm fallback `args.channel` của `#313` vào `slack-adapter.ts` bị bắt ngay (`MUTATION_SLACK_EXIT=1`); thay tạm tra cứu `schedule.digest_config` không khóa version của `#313` vào `schedule-service.ts` bị bắt ngay (`MUTATION_SCHED_EXIT=1`); đã khôi phục nguyên trạng `0` byte diff trước khi chạy lượt kiểm chứng sạch cuối cùng.
- **Sản phẩm bàn giao Task B:**
  - `docs/audits/2026-11-10-cross-service-integration/02-SOURCE-ANCESTRY-AND-MERGE-EVIDENCE.md`
  - Cập nhật `01-INTEGRATION-EXECUTION-PLAN.md`, `03-SHARED-FILE-CONFLICT-AND-CONTRACT-MATRIX.md`, `docs/handoff/tasks/XSVC-INTEGRATION-V2.md`
  - `docs/handoff/log/2026-11-10-xsvc-integration-v2-task-b-assembly.md`

### 5.3. Kết quả Task C (Backend Runtime Gate, Migrations `0001..0035`, OS `SIGKILL` & Negative Auth — `COMPLETED` `2026-11-11`)
- **Code+Test Anchor Commit (`7dcd3753742c755f3493ba3f010a7a743c72a074`, full-tree `f12bcb2d71d2812f95486d985e5431fe36ef9a89`):**
  - Chạy trên container PostgreSQL 16.15 dùng một lần do Task C sở hữu `ati-xsvc-v2-taskc-56791` (`432c5fa8ca7d`, `127.0.0.1:56791->5432/tcp`, DB `ati_v3_taskc`, `ALLOW_ISOLATED_TEST_PORT=1`, `has_dotenv=False`), đã dọn sạch bằng `docker rm -f ati-xsvc-v2-taskc-56791` sau khi xác minh; tuyệt đối không đụng chạm `ati-cal-combined-gate-56657` (`9718bcf4290f`) hay `ati-v3-test-db-56534`.
  - **Xác minh Migration thực tế (`node db/v3/migrate.mjs`):** Đã kiểm kê chính xác **47** file `.sql` thuộc dải tiền tố `0001..0035` (`44` file `<=0032` + `0033`, `0034`, `0035`); chứng minh chạy mới nhiều lần (idempotent) và nâng cấp từ `<=0032` lên `0035` bảo toàn 100% dòng dữ liệu đã seed + kích hoạt trigger `trg_schedule_runs_capture_dispatched_config` (`exit 0`). Ghi nhận việc `0034` có `BEGIN; ... COMMIT;` tường minh làm nhả sớm `pg_advisory_xact_lock(20260929)` của `migrate.mjs` vào `07` (`XSVC-RISK-09`).
  - **Chu trình TDD `RED -> GREEN` cho 4 lỗi tích hợp/ủy quyền thực tế (0 migration mới, 0 nới lỏng timeout/assertion):**
    1. `calendar-digest-runner.ts` & `trello-digest-runner.ts`: bổ sung `connections.telegram` (và kiểm khớp pin `telegramCredentialId` cho Trello) khi lấy adapter `telegram` từ `AdapterFactory` (`XSVC-RISK-01`).
    2. `adapter-factory.ts` & `execution-service.ts`: chặn fail-closed `workspaceId` rỗng ở chế độ `organization` (và `userId` rỗng / `service_account` ở chế độ `personal`) **trước** khi tính `cacheKey` / tra cứu cache hoặc mở snapshot hội thoại (`XSVC-RISK-02`).
    3. `adapter-factory.ts`: tái kiểm trạng thái `active` trên `CredentialRepo` ở mọi lệnh gọi `phase === 'execution'` để trục xuất adapter trong warm cache ngay khi credential bị thu hồi/xóa trước lúc gửi (`XSVC-RISK-03`), giữ nguyên `static-guard.test.ts` (`2/2` PASS).
    4. `plan-repo.ts` (`assertSourceDispatchAllowed`) & `execution-service.ts`: kiểm tra trực tiếp trong transaction trạng thái `users.status` / `workspace_members.status = 'active'` và khớp `expectedScope` (`workspaceMode`, `workspaceId`) ngay trước khi thực thi từng bước (`XSVC-RISK-04`).
  - **Kết quả kiểm thử thực chứng (`INDEPENDENTLY VERIFIED` trên `7dcd3753`):**
    - `cross-service-combined-gate.test.ts`: `RED` baseline `9 passed | 6 failed` -> `GREEN` **`15/15` passed** (`0` skipped), bao gồm đủ `S1`–`S6` (PID thật của tiến trình con OS: `S2` `33948`/`10340`, `S4a` digest `SIGKILL` `pid=33456` `exitCode=1`, `S4b` append lease `SIGKILL` `pid=32580` `exitCode=1`), `N1`–`N7` (`unauthorizedOutbound === 0` cho cả 7 nhóm, tách bạch rõ các precheck metadata hợp lệ tối thiểu của Trello), biên nhận lỗi/partial-write, manual recovery snapshot, và độ phủ/múi giờ IANA của Calendar.
    - Layer A Workspaces: `npm run typecheck:v3` (`exit 0`), `static-guard.test.ts` (`2/2`), `@wap/tool-schemas` (`27` files / `593` tests), `@wap/tool-adapters` (`712` Vitest + `32` `node --test` = `744` tests), `@wap/planner` (`40` files / `567` tests), `@wap/executor` (`7` files / `56` tests), `npm run test:eval:v3` (`31` files / `500` passed, `1` skipped).
    - Hồi quy hậu sửa lỗi `@wap/chat-api`: **82/82** file bị ảnh hưởng (**800/800** tests, `0` skipped) PASS với `--maxWorkers=2` + `node db/v3/migrate.mjs` trên `public` (ghi nhận thêm hiện tượng tranh chấp lock DDL `beforeAll` `10000ms` của Vitest khi chạy 276 file với 12 worker mặc định trên WSL2 vào phân loại `environmental` tại `05`).
- **Sản phẩm bàn giao Task C:**
  - `apps/chat-api/tests/services/schedules/cross-service-combined-gate.test.ts` & `apps/chat-api/tests/helpers/cross-service-scheduler-worker.ts` (+ 6 file backend/test trong `7dcd3753`)
  - `docs/audits/2026-11-10-cross-service-integration/05-REGRESSION-TEST-EVIDENCE.md` (kèm log `.txt` tại `evidence/`)
  - `docs/audits/2026-11-10-cross-service-integration/07-INHERITED-RISKS-AND-STAGING-GAPS.md`
  - Cập nhật `02`, `03`, `docs/handoff/tasks/XSVC-INTEGRATION-V2.md` và thêm `docs/handoff/log/2026-11-11-xsvc-integration-v2-task-c-backend.md`
  - **Không sửa** bất kỳ file nào thuộc `apps/chat-web/**`, `scripts/test-v3-browser.mjs`, `CURRENT-STATE.md`, hay `ROADMAP.md`.

### 5.4. Kết quả Tasks D & E (`PENDING / NOT RUN`)
- **Trạng thái Gate hiện tại:** Gate A = `NOT READY — BLOCKING DEFECT OR MISSING CRITICAL EVIDENCE` (chưa thể kết luận `PASS` chỉ từ Task B/C khi chưa có bằng chứng Task D & E); Gate B = `NOT READY`; Gate C = `PRODUCTION ACTIVATION — HOLD`.
- Bàn giao sạch cây làm việc trên nhánh `VinhDat267/ati-v3-cross-service-integration-gate` cho **Task D** (`apps/chat-web/**`, `scripts/test-v3-browser.mjs`, đặc tả Chromium `C1/C2` trong `apps/chat-web/tests/browser/mycalendar.spec.ts`) và **Task E** (`npm run check` + đủ 25 nhóm Chromium + Draft PR + GitHub Actions `v3 check` trên đúng `HEAD` cuối + hoàn thiện bộ hồ sơ `04..08`).
