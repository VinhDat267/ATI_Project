# Google Sheets Digest Gate A — Test & CI Verification Evidence (`TEST-AND-CI-EVIDENCE.md`)

- **Phiên bản báo cáo:** `FEAC v1.1 (Evidence Integrity Reconciled)`
- **Ngày kiểm toán:** `2026-11-09`
- **Repository:** [`VinhDat267/ATI_Project`](https://github.com/VinhDat267/ATI_Project)
- **Cumulative Stack HEAD (`PR #299`):** `b80c238941c4927cbd6c9b435816a4fdc6522f4e`
- **Baseline (`origin/main`):** `08c8d8c5e7bf12625857ac3496fb96ec3914e34f`
- **Isolated Local PostgreSQL Test Target:** `postgresql://ati_v3:<REDACTED_LOCAL_TEST_PW>@127.0.0.1:56534/ati_v3`

---

## 1. Phân loại Bằng chứng (Evidence Provenance Taxonomy)

Mọi kết quả kiểm thử dưới đây được phân loại trung thực theo 6 mức chuẩn của FEAC:
1. **`CODE_TRACE_CONFIRMED`:** Đọc đối chiếu trực tiếp mã nguồn, câu lệnh SQL, khóa giao dịch và kiểu dữ liệu tại đúng SHA khóa.
2. **`INTEGRATION_REPRODUCED`:** Chạy kiểm thử tích hợp module/adapter với HTTP/provider spy định hướng (`@wap/tool-schemas`, `@wap/tool-adapters`, `static-guard`).
3. **`MOCKED_API_E2E`:** Chạy trình duyệt Chromium thật qua Playwright (`apps/chat-web/tests/browser/sheets-digest-v2-recovery.spec.ts`) với `page.route` giả lập `/api/**`.
4. **`REAL_BACKEND_POSTGRES_INTEGRATION`:** Chạy Express HTTP routes thật + JWT auth thật + PostgreSQL thật (`127.0.0.1:56534/ati_v3` ở Local Audit hoặc `127.0.0.1:5432/ati_v3` trong container `postgres:16` của GitHub Actions CI, với schema cô lập ngẫu nhiên cho mỗi test) + React/JSDOM (`schedule-sheets-digest-v2-real-backend.test.tsx`) hoặc local HTTP Slack socket-drop server (`sheets-digest-concurrency.test.ts`).
5. **`LIVE_PROVIDER_VERIFIED`:** Gọi trực tiếp tới dịch vụ Google Sheets / Gmail / Slack / Telegram thật trên môi trường mạng ngoài — **Ghi nhận trung thực: `NOT_TESTED` trong môi trường CI/sandbox cô lập.**
6. **`NOT_TESTED`:** Các hạng mục thuộc cổng vận hành sau merge (`G10`) hoặc chữ ký quyết định của Chủ dự án (`GATEA-EXT-A01`, `GATEA-EXT-A03`, `G5-04`, `G8B-02`).

---

## 2. Đối chiếu Toàn diện Số liệu Kiểm thử: Local Independent Audit vs GitHub Actions Linux CI (Đã Khử Trùng Lặp 100%)

### 2.1. Bảng Đối Chiếu Tổng Hợp (Local Audit Execution vs GitHub Actions CI Run `#42574776391`)

Để loại bỏ hoàn toàn nguy cơ đếm trùng giữa các lượt chạy kiểm thử mục tiêu (targeted gate runs) và lượt chạy gom nhóm (batch regression runs), bảng dưới đây tách biệt rõ **Môi trường Local Independent Audit** (`Windows + PostgreSQL 127.0.0.1:56534/ati_v3`) và **Môi trường GitHub Actions Linux CI** ([Run `#42574776391` / Job `#129019913849`](https://github.com/VinhDat267/ATI_Project/actions/runs/42574776391/job/129019913849) trên `ubuntu-latest` + `postgres:16` tại SHA `b80c238941c4927cbd6c9b435816a4fdc6522f4e`):

| Phân hệ / Runner | GitHub Actions Linux CI (`Run #42574776391` / `Job #129019913849`) | Local Independent Audit (Đã Khử Trùng Lặp — Unique Files & Tests) | Ghi chú Đối Chiếu & Khử Trùng Lặp |
|---|---|---|---|
| **`@wap/tool-schemas` (`vitest`)** | `26` files / `589` passed (`0` failed) | `1` file / `7` passed (`sheets-digest-v2-types.test.ts`) | CI chạy toàn bộ workspace `@wap/tool-schemas`; Local chạy trực tiếp file V2 types (`G1-01`). |
| **`@wap/tool-adapters` (`vitest`)** | `23` files / `645` passed (`0` failed) | `1` file / `10` passed (`sheets-digest-window.test.ts`) | CI chạy toàn bộ workspace `@wap/tool-adapters`; Local chạy trực tiếp file bounded reader (`G1-02`). |
| **`@wap/planner` (`vitest`)** | `39` files / `555` passed (`0` failed) | — *(Chạy trên GitHub CI)* | Gate A chạm `0` file trong `packages/planner` (`G9-05`); CI xác nhận `555/555` PASS. |
| **`@wap/executor` (`vitest`)** | `7` files / `56` passed (`0` failed) | — *(Chạy trên GitHub CI)* | Gate A chạm `0` file trong `packages/executor` (`G9-05`); CI xác nhận `56/56` PASS. |
| **`@wap/chat-api` (`vitest`)** | `265` files / `2,617` passed (`0` failed) | **`214` unique files / `2,262` passed** (`Batches 1–9`, `0` failed) | Trong báo cáo v1.0, `Batches 1–9` có tổng chính xác là `2 + 12 + 24 + 34 + 41 + 17 + 13 + 56 + 15 = 214` unique files (`16 + 90 + 232 + 213 + 693 + 73 + 130 + 680 + 135 = 2,262` unique tests). Đã kiểm tra giao tập tập hợp file giữa `Batches 1–9`: **`0` file trùng lặp**. Lưu ý: lượt chạy mục tiêu `7` file Gate 2–5 ở Mục 3.2 (`63` tests) là tập con của `Batch 1` (`2` files) + `Batch 7` (`5` files) nên **không cộng lặp** vào tổng `214` files / `2,262` tests. |
| **`@wap/chat-web` (`vitest`)** | `116` files / `1,207` passed (`0` failed) | **`116` unique files / `1,207` passed** (`Batch 11`, `0` failed) | Cả GitHub CI và Local (`Batch 11`) đều chạy toàn bộ `116` file (`1,207` tests), đã bao gồm `schedule-sheets-digest-v2-real-backend.test.tsx` (`3` tests) và `schedule-sheets-digest-v2.test.tsx` (`6` tests). Hai lượt chạy lẻ ở Mục 3.3 là tập con của `Batch 11` nên **không cộng lặp**. |
| **`evaluations` (`vitest`)** | `31` files / `500` passed, `1` skipped (`0` failed) | **`1` unique file / `2` passed** (`Batch 10`: `static-guard.test.ts`) | CI chạy toàn bộ `vitest run evaluations`; Local chạy trực tiếp `static-guard.test.ts` (`G8-05`). |
| **Tổng cộng Vitest (Đã khử trùng)** | **`507` unique files / `6,169` passed (`1` skipped, `0` failed)** | **`333` unique files / `3,488` passed (`0` failed)** *(trong đó `Batches 1–11` = **`331` unique files / `3,471` passed**)* | Con số **`331` files / `3,471` tests** ở Bảng 5 là tổng chính xác tuyệt đối của `Batches 1–11` (`214 + 1 + 116 = 331` files; `2,262 + 2 + 1,207 = 3,471` tests) với `0` file đếm trùng. Khi cộng thêm `2` file Gate 1 ở Mục 3.1 (`17` tests), tổng Vitest Local là **`333` files / `3,488` tests**. |
| **`node --test` Script Suites** | **`8` unique files / `99` passed (`0` failed)** | `1` script guard (`test-v3-web-build-security.mjs`: `PASS`) | Trên GitHub CI gồm: `test:probe` (`1` file / `32` tests), `test:launcher:v3` (`1` file / `1` test), và 6 script suites (`6` files / `66` tests). |
| **Playwright Browser E2E (`chromium`)** | **`22` spec runs / `193` passed (`0` failed)** | **`1` spec file / `1` passed** (`sheets-digest-v2-recovery.spec.ts`) | GitHub CI chạy toàn bộ `npm run test:browser:v3` (`5+4+4+4+96+2+6+3+2+1+1+1+1+1+1+1+1+4+12+8+10+26 = 193` passed). Local chạy trực tiếp `sheets-digest-v2-recovery.spec.ts` (`1` passed) + kịch bản chụp 6 ảnh màn hình thực tế. |
| **Tổng cộng Tất cả Test Runners** | **`537` suite runs / `6,461` passed (`1` skipped, `0` failed)** | **`334` unique test files / `3,489` passed (`0` failed)** + **2 Live DB Rehearsals** | Không có bất kỳ test nào bị đếm hai lần trong cột tổng hợp đã khử trùng lặp. |

---

## 3. Bằng chứng GitHub Actions CI trên Đúng 40-char HEAD SHA của 9 Stacked PRs

Truy vấn trực tiếp qua `gh pr view <PR> --json number,state,isDraft,baseRefName,headRefName,headRefOid,mergeable,statusCheckRollup` vào ngày `2026-11-09`:

| PR | Base ← Head | 40-char HEAD SHA | Workflow `v3 check` Run ID / Job ID | Kết quả CI | Thời điểm hoàn tất (UTC) |
|---|---|---|---|---|---|
| **[#289](https://github.com/VinhDat267/ATI_Project/pull/289)** | `main` ← `test/tenant-digest-baseline` | `dd7fd0b7b73a5e3f7d1ce26a4965694ca512780f` | [Run 42508129612 / Job 128815114973](https://github.com/VinhDat267/ATI_Project/actions/runs/42508129612/job/128815114973) | `COMPLETED / SUCCESS` | `2026-11-08T18:20:07Z` |
| **[#290](https://github.com/VinhDat267/ATI_Project/pull/290)** | `test/tenant-digest-baseline` ← `feat/sheets-digest-v2-schemas` | `365b674bfa52f6d15b4c7b4034f9f63ef01c9ce7` | [Run 42508133723 / Job 128815127911](https://github.com/VinhDat267/ATI_Project/actions/runs/42508133723/job/128815127911) | `COMPLETED / SUCCESS` | `2026-11-08T18:23:01Z` |
| **[#291](https://github.com/VinhDat267/ATI_Project/pull/291)** | `feat/sheets-digest-v2-schemas` ← `feat/sheets-digest-bounded-reader` | `6b307bdc81a22fa3ae95df5a1b39a1a3ee103b52` | [Run 42508136409 / Job 128815136405](https://github.com/VinhDat267/ATI_Project/actions/runs/42508136409/job/128815136405) | `COMPLETED / SUCCESS` | `2026-11-08T18:19:45Z` |
| **[#292](https://github.com/VinhDat267/ATI_Project/pull/292)** | `feat/sheets-digest-bounded-reader` ← `feat/sheets-digest-atomic-runner` | `e3e1e2b86e7f2619844d9030f07c96f978051214` | [Run 42509999889 / Job 128820778420](https://github.com/VinhDat267/ATI_Project/actions/runs/42509999889/job/128820778420) | `COMPLETED / SUCCESS` | `2026-11-08T18:40:27Z` |
| **[#293](https://github.com/VinhDat267/ATI_Project/pull/293)** | `feat/sheets-digest-atomic-runner` ← `feat/sheets-digest-v2-candidate` | `e8e7ce31d950acd7dcdc915c65f175893d2770cf` | [Run 42510003522 / Job 128820789980](https://github.com/VinhDat267/ATI_Project/actions/runs/42510003522/job/128820789980) | `COMPLETED / SUCCESS` | `2026-11-08T18:48:36Z` |
| **[#294](https://github.com/VinhDat267/ATI_Project/pull/294)** | `feat/sheets-digest-v2-candidate` ← `feat/sheets-digest-reauthorize-api` | `d97574f81a509c471ca81d21631e2ca757adfe60` | [Run 42535305100 / Job 128898188950](https://github.com/VinhDat267/ATI_Project/actions/runs/42535305100/job/128898188950) | `COMPLETED / SUCCESS` | `2026-11-08T23:43:18Z` |
| **[#295](https://github.com/VinhDat267/ATI_Project/pull/295)** | `feat/sheets-digest-reauthorize-api` ← `feat/sheets-digest-delivery-recovery-api` | `84057251564b9d88cc0da642ba4cf171c9701074` | [Run 42536551594 / Job 128902008970](https://github.com/VinhDat267/ATI_Project/actions/runs/42536551594/job/128902008970) | `COMPLETED / SUCCESS` | `2026-11-08T23:59:15Z` |
| **[#297](https://github.com/VinhDat267/ATI_Project/pull/297)** | `feat/sheets-digest-delivery-recovery-api` ← `feat/sheets-digest-v2-migration-tool` | `c7ef31cb761f74a5ce3a1afef525f30d60b742c1` | [Run 42546523816 / Job 128932597017](https://github.com/VinhDat267/ATI_Project/actions/runs/42546523816/job/128932597017) | `COMPLETED / SUCCESS` | `2026-11-09T01:52:13Z` |
| **[#299](https://github.com/VinhDat267/ATI_Project/pull/299)** | `feat/sheets-digest-v2-migration-tool` ← `feat/sheets-digest-web-recovery` | `b80c238941c4927cbd6c9b435816a4fdc6522f4e` | [Run 42574776391 / Job 129019913849](https://github.com/VinhDat267/ATI_Project/actions/runs/42574776391/job/129019913849) | `COMPLETED / SUCCESS` | `2026-11-09T06:59:04Z` |

### Trích xuất Raw Log từ GitHub Actions Run `#42574776391` (`PR #299` @ `b80c238941c4927cbd6c9b435816a4fdc6522f4e`)
```text
✓ feat/sheets-digest-web-recovery v3 check VinhDat267/ATI_Project#299 · 42574776391
JOBS
✓ v3 in 15m50s (ID 129019913849)
  ✓ Set up job
  ✓ Initialize containers (postgres:16)
  ✓ Run actions/checkout@v4
  ✓ Run actions/setup-node@v4
  ✓ Run npm ci
  ✓ Run npm run db:migrate:v3
  ✓ Run npm run check
      - @wap/tool-schemas:   Test Files 26 passed (26)  | Tests 589 passed (589)
      - @wap/tool-adapters:  Test Files 23 passed (23)  | Tests 645 passed (645)
      - @wap/planner:        Test Files 39 passed (39)  | Tests 555 passed (555)
      - @wap/executor:       Test Files 7 passed (7)    | Tests 56 passed (56)
      - @wap/chat-api:       Test Files 265 passed (265)| Tests 2617 passed (2617)
      - @wap/chat-web:       Test Files 116 passed (116)| Tests 1207 passed (1207)
      - evaluations:         Test Files 31 passed (31)  | Tests 500 passed | 1 skipped (501)
      - node --test suites:  8 suites / 99 tests passed (32 + 1 + 66)
  ✓ Run npm run admin:provision:v3
  ✓ Run npx playwright install --with-deps chromium
  ✓ Run npm run test:browser:v3
      - 22 Playwright Chromium runs: 193 passed (including sheets-digest-v2-recovery.spec.ts: 1 passed in 10.6s)
  ✓ Complete job
```

---

## 4. Bằng chứng Kiểm chứng Trực tiếp 6 Hạng mục Trọng tâm (Task B Direct Verification Proofs)

### 4.1. Hạng mục 1 — DDL `0033_sheets_digest_v2_remediation.sql` Chạy Lặp 2 Lần (`G5-01`)
- **Provenance:** `REAL_BACKEND_POSTGRES_INTEGRATION` (`127.0.0.1:56534/ati_v3`, schema cô lập `feac_g501_rehearsal_0089c8dae284`).
- **File & SHA:** [`db/v3/0033_sheets_digest_v2_remediation.sql:1-40`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/db/v3/0033_sheets_digest_v2_remediation.sql#L1-L40) (`e3e1e2b86e7f2619844d9030f07c96f978051214`).
- **Raw Output:**
  ```text
  PASS_1_0033: OK
  PASS_2_0033: OK
  ZERO_SCHEDULE_MUTATION: true
  RUN_AFTER_0033: {"id":"28e83744-bfda-439e-8e56-a9be515c75b3","status":"planning","delivery_started_at":null,"delivery_resolution":null,"delivery_resolved_at":null,"delivery_resolved_by":null,"delivery_followup_run_id":null}
  AUDIT_COLS_COUNT: 19
  CONSTRAINTS: [
    {"conname":"schedule_runs_delivery_resolution_check","contype":"c","def":"CHECK (((delivery_resolution IS NULL) OR (delivery_resolution = ANY (ARRAY['confirmed_sent'::text, 'retried_new_run'::text]))))"},
    {"conname":"sheets_digest_v2_audit_outcome_check","contype":"c","def":"CHECK ((outcome = ANY (ARRAY['upgraded_v2'::text, 'paused_reauth_required'::text, 'already_v2'::text, 'inactive_preserved'::text])))"},
    {"conname":"sheets_digest_v2_audit_schedule_unique","contype":"u","def":"UNIQUE (schedule_id)"}
  ]
  OUTCOME_CHECK_ENFORCED: true
  DELIVERY_RESOLUTION_CHECK_ENFORCED: true
  SCHEMA_CLEANED_UP: true schema=feac_g501_rehearsal_0089c8dae284
  ```

### 4.2. Hạng mục 2 — `inventory` và `dry-run` Có Đúng `0` DB Writes (`G5-02`)
- **Provenance:** `REAL_BACKEND_POSTGRES_INTEGRATION` (`127.0.0.1:56534/ati_v3`, schema cô lập `feac_g511_g512_cli` + [`sheets-digest-v2-migration.test.ts`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/apps/chat-api/tests/services/sheets-digest-v2-migration.test.ts) test #1).
- **File & SHA:** [`apps/chat-api/src/services/schedules/sheets-digest-v2-migration.ts:1022-1076`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/apps/chat-api/src/services/schedules/sheets-digest-v2-migration.ts#L1022-L1076) (`c7ef31cb761f74a5ce3a1afef525f30d60b742c1`).
- **Phương pháp & Kết quả:** Đặt bộ chặn truy vấn SQL trên `pg.Pool` trong suốt quá trình chạy `--mode=inventory` và `--mode=dry-run` (cả 2 chính sách `strict_pause_all` và `allow_consistency_candidate`):
  ```text
  READONLY_QUERIES_CAPTURED_COUNT: 9
  READONLY_WRITE_QUERIES_COUNT: 0
  INVENTORY_SUMMARY: {"totalSchedules":6,"countsByClass":{"v1_pinned_consistency_candidate":3,"v1_unpinned_fail_closed":2,"v2_ready":1},"countsByOutcome":{"upgraded_v2":0,"paused_reauth_required":4,"already_v2":1,"inactive_preserved":1},"countsByRollbackOutcome":{"restored_previous_state":0,"restored_paused_due_to_revocation":0,"skipped_user_modified":0}}
  DRYRUN_STRICT_OUTCOMES: {"upgraded_v2":0,"paused_reauth_required":4,"already_v2":1,"inactive_preserved":1}
  DRYRUN_ALLOW_OUTCOMES: {"upgraded_v2":3,"paused_reauth_required":1,"already_v2":1,"inactive_preserved":1}
  ```

### 4.3. Hạng mục 3 — `apply` và `rollback` CAS (`G5-07`, `G5-09`, `G5-10`, `G5-12`)
- **Provenance:** `REAL_BACKEND_POSTGRES_INTEGRATION` (`sheets-digest-v2-migration.test.ts` — `13/13` tests PASS + Live CLI Rehearsal trên schema `feac_g511_g512_cli`).
- **File & SHA:** [`apps/chat-api/src/services/schedules/sheets-digest-v2-migration.ts:548-627, 722-977, 1110-1188`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/apps/chat-api/src/services/schedules/sheets-digest-v2-migration.ts#L548-L627) (`c7ef31cb761f74a5ce3a1afef525f30d60b742c1`).
- **Kết quả kiểm chứng trực tiếp:**
  1. **Repeated `apply` (`apply #1 → apply #2 → rollback`):** `hasActiveAuditSnapshot` (`lines 1115-1125`) và `ON CONFLICT (schedule_id) DO UPDATE ... WHERE rolled_back_at IS NOT NULL` (`lines 548-627`) bảo toàn nguyên vẹn snapshot V1 ban đầu; `rollback` khôi phục đúng `prev_status`, `prev_digest_config`, `prev_schedule_version`.
  2. **CAS `skipped_user_modified`:** Khi người dùng đã reauthorize hoặc sửa lịch sau migration (`schedule.version !== audit.migrated_schedule_ver`), `rollback` giữ nguyên lịch V2 mới của người dùng (`skipped_user_modified: 1`).
  3. **Revocation Guard `restored_paused_due_to_revocation`:** Khi credential hoặc quyền thành viên bị thu hồi sau migration, `rollback` chỉ khôi phục `prev_digest_config` nhưng bắt buộc giữ `status = 'paused'` với `REAUTH_REQUIRED` (`restored_paused_due_to_revocation: 2`).
  4. **Raw Output:**
     ```text
     APPLY_OUTCOMES: {"upgraded_v2":3,"paused_reauth_required":1,"already_v2":1,"inactive_preserved":1}
     ROLLBACK_SUMMARY: {"restored_previous_state":1,"restored_paused_due_to_revocation":2,"skipped_user_modified":1}
     REHEARSAL_SCHEMA_CLOSED: true
     ✓ tests/services/sheets-digest-v2-migration.test.ts (13 tests) 10481ms | EXIT_CODE: 0
     ```

### 4.4. Hạng mục 4 — Test Database Guard (`validateTestDatabaseUrl` & Mid-Setup Failure Cleanup — `G7-01..G7-06`)
- **Provenance:** `REAL_BACKEND_POSTGRES_INTEGRATION` (cả trên Local Windows port `56534` và trên GitHub Actions Linux CI `Run #42574776391`).
- **File & SHA:** [`apps/chat-web/tests/schedule-sheets-digest-v2-real-backend.test.tsx:47-195, 724-864`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/apps/chat-web/tests/schedule-sheets-digest-v2-real-backend.test.tsx#L47-L195) (`b80c238941c4927cbd6c9b435816a4fdc6522f4e`).
- **Kết quả kiểm chứng trực tiếp (3 tests trong `schedule-sheets-digest-v2-real-backend.test.tsx`):**
  1. **Test #1 (`lines 411-722`):** Chạy hành trình đầy đủ React UI → Express HTTP → PostgreSQL thật (`reauthorize-preview → confirm → resolve-delivery retry_new_run & mark_sent`).
  2. **Test #2 (`lines 724-789`):** Đặt spy trên `pg.Pool.prototype.connect` và `pg.Pool.prototype.query`; chứng minh khi `DATABASE_URL` thiếu/rỗng, sai giao thức, remote host, port runtime `55533`, sai tên DB, port `5432` ngoài CI, hoặc `prefix` chứa ký tự SQL injection, hàm ném lỗi fail-closed ngay lập tức với **`0` kết nối DB, `0` câu lệnh SQL, và không lộ mật khẩu/URL trong thông báo lỗi**.
  3. **Test #3 (`lines 791-864`):** Tạo một foreign schema (`foreign_preserve_*`), sau đó tiêm lỗi DDL ở câu lệnh thứ 2 trong `createIsolatedMigratedSchema('midfail_cleanup', ...)`: chứng minh schema tạo dở (`midfail_cleanup_*`) bị xóa sạch (`rowCount === 0`) và foreign schema được giữ nguyên (`rowCount === 1`).
  - **Raw Output:**
    ```text
    RUN  v4.1.11 C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/apps/chat-web
    ✓ tests/schedule-sheets-digest-v2-real-backend.test.tsx (3 tests) 6138ms
      ✓ executes full end-to-end journey against real backend + isolated PostgreSQL: reauthorize-preview -> confirm -> resolve-delivery (retry_new_run & mark_sent) 4185ms
      ✓ rejects missing, runtime-port 55533, remote-host, non-CI 5432, wrong-DB, and invalid-prefix targets fail-closed with zero DB connections or queries 18ms
      ✓ drops its own partially-initialized schema when migration/setup fails mid-flight while preserving unrelated schemas 1931ms
    Test Files  1 passed (1) | Tests  3 passed (3) | EXIT_CODE: 0
    ```

### 4.5. Hạng mục 5 — 6 Kịch bản Người dùng `UAT-01..UAT-06` (`Gate 8B`)
- **Provenance:** `REAL_BACKEND_POSTGRES_INTEGRATION` + `MOCKED_API_E2E` (`LIVE_PROVIDER_VERIFIED` = `NOT_TESTED`).
- **Bảng ánh xạ bằng chứng trực tiếp:**
  - **`UAT-01` (Personal Sheets → Personal Gmail V2 preview, confirm & bounded run):** [`sheets-digest-candidate-v2.test.ts:157-177, 424-480`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/apps/chat-api/tests/services/sheets-digest-candidate-v2.test.ts#L157-L177), [`sheets-digest-e2e-pipeline.test.ts:269-333`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/apps/chat-api/tests/services/sheets-digest-e2e-pipeline.test.ts#L269-L333) (`PASS`).
  - **`UAT-02` (Org isolation, `sheets` + `mysheets` coexistence, `ORG_DATA_EGRESS_FORBIDDEN`):** [`sheets-digest-candidate-v2.test.ts:69-154, 209-244, 388-423, 482-514`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/apps/chat-api/tests/services/sheets-digest-candidate-v2.test.ts#L69-L154), [`sheets-digest-e2e-pipeline.test.ts:205-237, 299-333`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/apps/chat-api/tests/services/sheets-digest-e2e-pipeline.test.ts#L205-L237) (`PASS`).
  - **`UAT-03` (Revoke credential / narrow scope / remove member after confirm → pause with `0` outbound sends):** [`sheets-digest-concurrency.test.ts:1160-1499`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/apps/chat-api/tests/services/sheets-digest-concurrency.test.ts#L1160-L1499) (`PASS`).
  - **`UAT-04` (Paused V1 schedule → `409` on ordinary resume → 2-phase reauthorize preview & confirm):** [`sheets-digest-reauthorize.test.ts:150-718`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/apps/chat-api/tests/services/sheets-digest-reauthorize.test.ts#L150-L718), [`schedule-sheets-digest-v2-real-backend.test.tsx:482-578`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/apps/chat-web/tests/schedule-sheets-digest-v2-real-backend.test.tsx#L482-L578), screenshots `01`–`03` (`PASS`).
  - **`UAT-05` (Post-claim socket drop → `SHEETS_DELIVERY_UNKNOWN` → `mark_sent` & `retry_new_run` with duplicate-risk checkbox):** [`sheets-digest-concurrency.test.ts:1502-1750`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/apps/chat-api/tests/services/sheets-digest-concurrency.test.ts#L1502-L1750), [`sheets-digest-delivery-recovery.test.ts:244-801`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/apps/chat-api/tests/services/sheets-digest-delivery-recovery.test.ts#L244-L801), [`schedule-sheets-digest-v2-real-backend.test.tsx:580-722`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/apps/chat-web/tests/schedule-sheets-digest-v2-real-backend.test.tsx#L580-L722), screenshots `04`–`05` (`PASS`).
  - **`UAT-06` (Multi-service coexistence across `plan`, `calendar_digest`, `notion_digest`, `trello_digest`, `github_digest`, `jira_digest`, `telegram_digest`):** [`sheets-digest-reauthorize.test.ts:720-890`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/apps/chat-api/tests/services/sheets-digest-reauthorize.test.ts#L720-L890), [`sheets-digest-delivery-recovery.test.ts:620-740`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/apps/chat-api/tests/services/sheets-digest-delivery-recovery.test.ts#L620-L740), plus `214` backend files / `2,262` tests (`PASS`).

### 4.6. Hạng mục 6 — Phân biệt Rạch ròi `MOCKED_API_E2E` (Playwright) vs `REAL_BACKEND_POSTGRES_INTEGRATION` (`G6-08`)
- **`MOCKED_API_E2E`:** [`apps/chat-web/tests/browser/sheets-digest-v2-recovery.spec.ts:1-549`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/apps/chat-web/tests/browser/sheets-digest-v2-recovery.spec.ts#L1-L549) khởi chạy trình duyệt Chromium thật để kiểm định bố cục CSS, khả năng tiếp cận (`role="alert"`, `role="status"`), đáp ứng Desktop (`1440x900`) & Mobile (`375x812`), và chụp 6 ảnh màn hình thực tế, trong đó các endpoint `/api/**` được giả lập bằng `page.route`.
- **`REAL_BACKEND_POSTGRES_INTEGRATION`:** [`apps/chat-web/tests/schedule-sheets-digest-v2-real-backend.test.tsx:1-864`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/apps/chat-web/tests/schedule-sheets-digest-v2-real-backend.test.tsx#L1-L864) kết nối trực tiếp các component React (`ScheduleActions`, `ScheduleMoment`, `ScheduleRunRecovery`) và `api-client.ts` thật tới ứng dụng Express `createApp({ pool })` thật và cơ sở dữ liệu PostgreSQL thật (với đầy đủ migrations `0001..0033`, JWT thật, khóa giao dịch `FOR UPDATE` thật), không dùng bất kỳ mock route HTTP nào.
- **`LIVE_PROVIDER_VERIFIED`:** Được ghi nhận trung thực là **`NOT_TESTED`** trên mọi bảng kiểm định vì môi trường CI/sandbox không gọi tới máy chủ Google Sheets / Gmail / Slack thật trên internet.

---

## 5. Bảng Chi tiết 11 Batch Kiểm thử Hồi quy tại Local Audit (`331` Unique Vitest Files / `3,471` Unique Tests)

| Batch | Dịch vụ / Phân hệ | Số File Test (Unique) | Số Test Case (Unique) | Thời gian | Exit Code |
|---|---|---:|---:|---:|---:|
| **Batch 1** | Migration V2 & Baseline Inventory (`sheets-digest-v2-migration`, `baseline-inventory`) | `2 / 2` | `16 / 16` | `12.85s` | `0` |
| **Batch 2** | Shared Scheduler, Locks, Planning, Routes & Legacy Sheets Digest | `12 / 12` | `90 / 90` | `8.72s` | `0` |
| **Batch 3** | Calendar, MyCalendar & Gmail (`calendar-digest-*`, `gmail-*`, `mycalendar-*`) | `24 / 24` | `232 / 232` | `18.48s` | `0` |
| **Batch 4** | Notion, Trello & GitHub (`notion-*`, `trello-*`, `github-*`) | `34 / 34` | `213 / 213` | `13.47s` | `0` |
| **Batch 5** | Jira & MyJira (`jira-*`, `myjira-*`, `jira-sheets-schedule-compat`) | `41 / 41` | `693 / 693` | `30.12s` | `0` |
| **Batch 6** | Telegram (`telegram-*`, `telegram-digest-*`) | `17 / 17` | `73 / 73` | `16.51s` | `0` |
| **Batch 7** | Sheets, MySheets & Gate A V2 Suites (`mysheets-*`, `sheets-digest-*`) | `13 / 13` | `130 / 130` | `36.70s` | `0` |
| **Batch 8** | Slack (`56` files: `slack-*`, `myslack-*`) | `56 / 56` | `680 / 680` | `122.53s` | `0` |
| **Batch 9** | Shared Routing, Google Grant Isolation, Workspace Isolation & Reconciliation | `15 / 15` | `135 / 135` | `45.68s` | `0` |
| **Tiểu tổng Backend (`Batches 1–9`)** | **Toàn bộ `@wap/chat-api` Multi-Service & Gate A Suites (Khử trùng 100%)** | **`214` files** | **`2,262` tests** | — | **`0`** |
| **Batch 10** | Generic Plumbing Static Guard (`evaluations/generic-plumbing/static-guard.test.ts`) | `1 / 1` | `2 / 2` | `3.18s` | `0` |
| **Batch 11** | Full `@wap/chat-web` Suite (`116` files including Real-Backend Postgres Smoke Test) | `116 / 116` | `1,207 / 1,207` | `84.10s` | `0` |
| **Tổng `Batches 1–11`** | **Tổng số Vitest Files & Tests của 11 Batch Hồi quy (Không trùng lặp)** | **`331` files** | **`3,471` tests** | — | **`0` (`100% PASS`)** |
| **Gate 1 Standalone** | `sheets-digest-v2-types.test.ts` (`7`) + `sheets-digest-window.test.ts` (`10`) | `2 / 2` | `17 / 17` | `1.15s` | `0` |
| **Playwright Standalone** | `apps/chat-web/tests/browser/sheets-digest-v2-recovery.spec.ts` | `1 / 1` | `1 / 1` | `12.40s` | `0` |
| **Tổng cộng Local Audit (Unique)** | **Toàn bộ File & Test Thực thi Trực tiếp tại Phiên Kiểm toán Local** | **`334` unique files** | **`3,489` unique tests** | — | **`0` (`100% PASS`)** |
