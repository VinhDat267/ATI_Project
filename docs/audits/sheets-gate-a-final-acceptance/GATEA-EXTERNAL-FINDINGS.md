# Google Sheets Digest Gate A — External Audit Findings & Risk Register (`GATEA-EXTERNAL-FINDINGS.md`)

- **Phiên bản báo cáo:** `FEAC v1.2 (Governance, Pre-Merge vs Gate 10 Separation & Risk Acceptance Formalized)`
- **Ngày kiểm toán:** `2026-11-09`
- **Repository:** [`VinhDat267/ATI_Project`](https://github.com/VinhDat267/ATI_Project)
- **Phạm vi kiểm định:** 9 Stacked Draft PRs (`#289` → `#299`, HEAD `b80c238941c4927cbd6c9b435816a4fdc6522f4e` trên `origin/main` `08c8d8c5e7bf12625857ac3496fb96ec3914e34f`)
- **Phương pháp:** 2-Axis Independent Review (`Axis A — Spec, Product & UX Compliance` + `Axis B — Security, Tenant Isolation, Delivery Reliability & Code Quality`) kết hợp `DBA / Shared-Service Regression Audit` *(Lưu ý: Phê duyệt của các subagent kiểm toán nội bộ là bằng chứng kỹ thuật nội bộ, không phải là submitted GitHub PR review).*

---

## 1. Tổng hợp Phân loại Findings

| Mức độ (Severity) | Số lượng Code / Runtime Defects | Số lượng Governance / Sign-Off Gates | Số lượng P3 Defense-in-Depth / Operational Notes | Trạng thái Chặn (Blocking Status) |
| :--- | :---: | :---: | :---: | :--- |
| **P0 (Critical Security / Data Loss / Cross-Tenant Leak)** | **`0`** | `0` | `0` | **Không có P0** |
| **P1 (Major Spec Violation / Duplicate Send / Broken Recovery)** | **`0`** | `0` | `0` | **Không có P1** |
| **P2 (Governance / Human Approval / Live Provider Staging Gate)** | **`0`** *(code)* | **`4`** (`GATEA-EXT-A01`, `GATEA-EXT-A03`, `GATEA-EXT-RS-5` — mở; `GATEA-EXT-RB-01` runbook ancestry — đã sửa trong tài liệu kiểm toán FEAC v1.2) | `0` | **Không chặn Implementation Acceptance; thuộc thẩm quyền quyết định của Chủ dự án (`PENDING OWNER DECISION`)** |
| **P3 (Defense-in-Depth / Observability / Operational Runbook)** | **`0`** | `0` | **`5`** (`GATEA-EXT-01`, `GATEA-EXT-02`, `GATEA-EXT-G5-01`, `GATEA-EXT-G5-02`, `GATEA-EXT-A02`) | **Không chặn Merge (`Non-blocking`); có bảng chấp nhận rủi ro & lộ trình xử lý rõ ràng bên dưới** |

---

## 2. Chi tiết Các Cổng Quyết Định Thuộc Thẩm Quyền Chủ Dự Án (`P2` — Không Tự Ý Đánh Dấu `APPROVED`)

> [!IMPORTANT]
> Theo nguyên tắc quản trị độc lập của FEAC:
> 1. AI Auditor **tuyệt đối không tự ký thay Chủ dự án (`VinhDat267`)** đối với các quyết định `GATEA-EXT-A01`, `GATEA-EXT-A03` và việc chấp nhận 5 rủi ro `P3`.
> 2. Phê duyệt của các subagent kiểm toán nội bộ (`Axis A`, `Axis B`, `DBA`) là bằng chứng kỹ thuật nội bộ, **không phải là submitted GitHub PR review** (`reviewDecision: ""` trên cả 9 PR `#289..#299` và `PR #302`).
> 3. Các quyết định của Chủ dự án được tách bạch thành **Nhóm A — Bắt buộc phê duyệt TRƯỚC MERGE GATE** và **Nhóm B — Hoãn chính thức sang CỔNG GATE 10 (Sau Merge / Trước Khi Bật Production)** (xem bảng ký duyệt tại [`FINAL-GATE-VERDICT.md` §3](./FINAL-GATE-VERDICT.md#3-phân-tách-minh-bạch-các-quyết-định-của-chủ-dự-án-owner-sign-off-reconciliation)).

### 2.1. `GATEA-EXT-A01` — Quyết định Cấp Quyền Merge Chuỗi 9 Stacked PRs & GitHub PR Review (`G0-06`, `G9-06`)
- **Phân loại & Mức độ:** `P2` (Pre-Merge Blocking Governance Gate — **Nhóm A tại Merge Gate**)
- **Người có thẩm quyền duy nhất:** **Project Owner (`VinhDat267`)**
- **Trạng thái hiện tại:** **`OPEN — PENDING EXPLICIT PROJECT OWNER MERGE GO`**
- **Bằng chứng hiện trạng trên GitHub (`2026-11-09`):**
  - Cả 9 PR (`#289`, `#290`, `#291`, `#292`, `#293`, `#294`, `#295`, `#297`, `#299`) đều đang ở trạng thái `isDraft: true`, `state: "OPEN"`, `mergeable: "MERGEABLE"`, `reviewDecision: ""`, và `v3 check` = `COMPLETED / SUCCESS` tại đúng 40-char HEAD SHA đã khóa.
- **Nội dung Quyết định cần Chủ dự án phê duyệt trước khi Merge:**
  1. Xác nhận chấp thuận báo cáo FEAC v1.2 (công bố trên nhánh kiểm toán độc lập `docs/sheets-gate-a-feac-audit` / [`PR #302`](https://github.com/VinhDat267/ATI_Project/pull/302)).
  2. Cho phép chuyển tuần tự từng PR từ `Draft` sang `Ready for review` và thực hiện merge theo đúng thứ tự 9 bước `#289 → #290 → #291 → #292 → #293 → #294 → #295 → #297 → #299` tại [`STACKED-PR-INTEGRATION-MATRIX.md`](./STACKED-PR-INTEGRATION-MATRIX.md) (không gộp `PR #300` hay `PR #301`).
  3. Ghi nhận cách thể hiện quyết định review trên GitHub: cả 9 PR do chính tài khoản `VinhDat267` mở, GitHub không cho tác giả tự *approve* PR của mình; cần reviewer độc lập có quyền approve hoặc review dạng *comment* ghi rõ `MERGE GO`.

### 2.1a. `GATEA-EXT-RB-01` — Lỗi kiểm tra ancestry trong runbook merge (FEAC v1.2 — `CLOSED IN AUDIT DOCS`)
- **Phân loại:** `P2` (Runbook / Release Process). **Phát hiện bởi:** Project Owner external review của `PR #302` @ `4ec88bc7`.
- **Lỗi:** Runbook cũ dùng `git merge-base --is-ancestor origin/main <next_SHA>` sau `gh pr merge --merge`; merge commit mới trên `main` không phải tổ tiên của nhánh PR kế tiếp nên phép kiểm tra luôn thất bại.
- **Sửa:** [`STACKED-PR-INTEGRATION-MATRIX.md`](./STACKED-PR-INTEGRATION-MATRIX.md) Mục 5 dùng `is-ancestor <prev_SHA> origin/main` + `is-ancestor <prev_SHA> <next_SHA>` + kiểm tra parent/tree của merge commit, kèm 7 cổng mỗi bước (SHA, base, expected delta, ancestry, CI mới trên trạng thái tích hợp mới, review, branch protection).
- **Bằng chứng:** [`runbook-rehearsal/stacked-merge-rehearsal-output.txt`](./runbook-rehearsal/stacked-merge-rehearsal-output.txt) — `PASS=85 FAIL=0`; lệnh cũ exit `1` ở `8/8` bước, lệnh mới exit `0` ở `8/8` bước.

### 2.1b. `GATEA-EXT-RS-5` — Release Safety của CD ngoài GitHub Actions (FEAC v1.2 — `OPEN — PENDING OWNER CONFIRMATION A5`)
- **Phân loại:** `P2` (Pre-Merge Blocking Governance — **Nhóm A, mục `A5`**).
- **Đã kiểm chứng:** chỉ có workflow `v3 check` (không deploy, không secrets, không `environment:`); migration trong CI chỉ chạm Postgres container tạm; cờ Sheets Digest V2 mặc định fail-closed; Gate A không thêm hay bật công cụ ghi MySheets Drive/Docs (các công cụ này đã có trên `main` trước Gate A, sau `MYSHEETS_ENABLED` mặc định `off`; kill-switch thuộc `PR #300`).
- **Chưa kiểm chứng được:** GitHub App `vercel` đã cài cho tài khoản (check suite `queued`, `0` check runs, `0` GitHub Deployments); cấu hình project Vercel nằm ngoài repo.
- **Yêu cầu:** Merge GO giữ `HOLD` cho tới khi Chủ dự án xác nhận `A5` (xem [`FINAL-GATE-VERDICT.md`](./FINAL-GATE-VERDICT.md) Mục 3.1).

---

### 2.2. `GATEA-EXT-A03` — Phân tách Quyết định Pre-Merge (`G8B-02` Copy & Default Flags) và Quyết định Hoãn sang Gate 10 (`G5-04`/`G10-04` Policy & `G8B-01`/`G10-06` Live Provider)
- **Phân loại & Mức độ:** `P2` (Product Policy & Staging UAT Gate — chia rõ **Nhóm A: Pre-Merge** và **Nhóm B: Gate 10**)
- **Người có thẩm quyền duy nhất:** **Project Owner / Product Owner (`VinhDat267`)** phối hợp cùng **DBA / Release Ops**
- **Trạng thái hiện tại:** **`OPEN — PENDING OWNER PRE-MERGE & GATE 10 DECISIONS`**
- **Ranh giới an toàn khi Merge vào `main`:**
  - Việc merge chuỗi `#289..#299` vào `main` **hoàn toàn an toàn** vì mã nguồn mặc định ở chế độ đóng an toàn (`fail-closed`):
    - `SHEETS_DIGEST_EMIT_V2 = false`
    - `SHEETS_DIGEST_V2_MODE = 'compat'`
    - `SHEETS_DIGEST_V1_COMPAT_POLICY = 'strict_pause_all'`
- **Bảng phân tách các hạng mục thuộc `GATEA-EXT-A03` theo Cổng Phê Duyệt:**

| Mã Hạng Mục | Cổng Áp Dụng | Nội dung Quyết định / Kiểm định | Thời hạn Bắt buộc (Deadline) | Trạng thái Ký |
|---|---|---|---|---|
| **`G8B-02` (`GATEA-EXT-A03-Copy`)** | **Nhóm A — TRƯỚC MERGE GATE** | Phê duyệt văn bản tiếng Việt trên giao diện khôi phục (`ScheduleMoment`, `ScheduleRunRecovery`, `ScheduleSection` — xem 6 ảnh chụp thực tế tại [`PRODUCT-UX-ACCEPTANCE.md`](./PRODUCT-UX-ACCEPTANCE.md)). | **Bắt buộc TRƯỚC KHI merge `PR #299` vào `main`.** | `PENDING OWNER SIGN-OFF (PRE-MERGE)` |
| **`G5-04` / `G10-07` (`GATEA-EXT-A03-Defaults`)** | **Nhóm A — TRƯỚC MERGE GATE** | Xác nhận giữ nguyên 3 cờ runtime mặc định fail-closed (`SHEETS_DIGEST_EMIT_V2=false`, `SHEETS_DIGEST_V2_MODE=compat`, `SHEETS_DIGEST_V1_COMPAT_POLICY=strict_pause_all`) khi merge vào `main`. | **Bắt buộc TRƯỚC KHI merge chuỗi `#289..#299` vào `main`.** | `PENDING OWNER SIGN-OFF (PRE-MERGE)` |
| **`G5-04` / `G10-04` (`GATEA-EXT-A03-Policy`)** | **Nhóm B — HOÃN SANG CỔNG GATE 10** | Sau khi chạy `--mode=inventory` chỉ đọc trên DB thật (`G10-03`), Chủ dự án ký chọn giữ `strict_pause_all` hay cho phép `allow_consistency_candidate` cho lịch cá nhân Class A. | **Tại Cổng Gate 10 (`G10-04`)** — **TRƯỚC KHI** chạy `--mode=apply` hoặc bật `SHEETS_DIGEST_V2_MODE=enforce`. | `DEFERRED TO GATE 10 — PENDING OWNER POLICY` |
| **`G8B-01` / `G10-06` (`GATEA-EXT-A03-LiveProvider`)** | **Nhóm B — HOÃN SANG CỔNG GATE 10** | Kiểm thử tích hợp với máy chủ Google Sheets / Gmail / Slack thật (`LIVE_PROVIDER_VERIFIED`, hiện đang là `NOT_TESTED` trong sandbox) cùng diễn tập `--mode=dry-run` và `rollback` trên staging. | **Tại Cổng Gate 10 (`G10-06`)** — **TRƯỚC KHI** bật `SHEETS_DIGEST_EMIT_V2=true` hoặc `SHEETS_DIGEST_V2_MODE=enforce` trên production. | `DEFERRED TO GATE 10 (NO-GO / HOLD)` |

---

## 3. Bảng Quản lý & Chấp nhận Rủi ro cho 5 Ghi chú `P3` (`Non-Blocking Findings`)

| Mã Finding | Gate / Check | Mức độ | Tóm tắt Kỹ thuật & Biện pháp Giảm thiểu Hiện có trong Code | Chủ sở hữu (Owner) | Thời điểm / Mốc Xử lý (Target Timing) | Trạng thái Chấp nhận Rủi ro |
|---|---|---|---|---|---|---|
| **`GATEA-EXT-01`** | `G7-03` | `P3` (Defense-in-Depth) | [`schedule-sheets-digest-v2-real-backend.test.tsx:78-89`](https://github.com/VinhDat267/ATI_Project/blob/b80c238941c4927cbd6c9b435816a4fdc6522f4e/apps/chat-web/tests/schedule-sheets-digest-v2-real-backend.test.tsx#L78-L89) (`b80c2389`) chỉ cho phép `loopback:5432/ati_v3` khi `CI=true`/`1` (khớp container `postgres:16` của `.github/workflows/v3-check.yml`), kết hợp schema ngẫu nhiên riêng biệt. Không bao giờ chạy test suite trên máy chủ production. | Security / CI Owner (`@wap/chat-web`) | **Post-Merge Backlog (Optional Hardening):** Bổ sung biến sentinel `ATI_CI_EPHEMERAL_POSTGRES=1` trong `.github/workflows/v3-check.yml` ở đợt nâng cấp CI tiếp theo. | `NON-BLOCKING — PENDING OWNER RISK ACCEPTANCE` |
| **`GATEA-EXT-02`** | `G7-05` | `P3` (Observability Hygiene) | [`schedule-sheets-digest-v2-real-backend.test.tsx:171-195`](https://github.com/VinhDat267/ATI_Project/blob/b80c238941c4927cbd6c9b435816a4fdc6522f4e/apps/chat-web/tests/schedule-sheets-digest-v2-real-backend.test.tsx#L171-L195) (`b80c2389`) ưu tiên ném lỗi gốc `setupErr` khi migration lỗi giữa chừng và đã được chứng minh bằng Negative Test #3 (`midfail_cleanup_*` = `0`, `foreign_preserve_*` = `1`). Đường đóng bình thường `close()` không bọc `try/catch`. | QA / Frontend Owner (`@wap/chat-web`) | **Post-Merge Backlog (Optional Hygiene):** Có thể thêm `console.warn` trong khối `catch` phụ nếu muốn log lỗi đóng kết nối thứ cấp. | `NON-BLOCKING — PENDING OWNER RISK ACCEPTANCE` |
| **`GATEA-EXT-G5-01`** | `G5-01` / `G10-02` | `P3` (DBA Runbook Note) | [`db/v3/0033_sheets_digest_v2_remediation.sql:35-40`](https://github.com/VinhDat267/ATI_Project/blob/e3e1e2b86e7f2619844d9030f07c96f978051214/db/v3/0033_sheets_digest_v2_remediation.sql#L35-L40) (`e3e1e2b8`) thực hiện `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT` trên `schedule_runs` (theo mẫu chung của `0016..0032`). Chạy lặp 2 lần an toàn (`< 5ms`). | DBA / Release Ops | **Tại Bước `G10-02` (Gate 10 Production Migration):** Chạy `npm run db:migrate:v3` trong khung giờ thấp điểm để tránh tranh chấp khóa ngắn trên `schedule_runs`. | `NON-BLOCKING — PENDING OWNER RISK ACCEPTANCE` |
| **`GATEA-EXT-G5-02`** | `G5-06` / `G10-03` | `P3` (DBA Runbook Note) | [`sheets-digest-v2-migration.ts:685-703`](https://github.com/VinhDat267/ATI_Project/blob/c7ef31cb761f74a5ce3a1afef525f30d60b742c1/apps/chat-api/src/services/schedules/sheets-digest-v2-migration.ts#L685-L703) (`c7ef31cb`) giải mã kiểm tra toàn bộ `service_credentials` đang `active` trước khi chạy `inventory`/`dry-run`/`apply`/`rollback`. Nếu có bản ghi hỏng ciphertext sẽ dừng ngay với `INVALID_ENCRYPTION_KEY (<credentialId>)` và `0` DB writes. | DBA / Release Ops | **Tại Bước `G10-03` (Gate 10 Production Inventory):** Đưa hướng dẫn xử lý mã `INVALID_ENCRYPTION_KEY (<credentialId>)` vào runbook vận hành cho DBA. | `NON-BLOCKING — PENDING OWNER RISK ACCEPTANCE` |
| **`GATEA-EXT-A02`** | `G0-07` (`AGENTS.md` §4) | `P3` (Documentation Hygiene) | Task 0 (`PR #289`) có file `docs/handoff/tasks/RMD-00-sheets-digest-baseline.md` và log riêng; các Task 1–7 (`PR #290..#299`) được theo dõi tập trung trong spec/plan v2.4 để không gây xung đột `CURRENT-STATE.md` / `ROADMAP.md` giữa chuỗi stacked PR. | Release / Documentation Owner | **Ngay Sau Bước Merge Thứ 9 (`PR #299` → `main`):** Cập nhật `docs/handoff/CURRENT-STATE.md`, `docs/handoff/ROADMAP.md` và ghi 1 file tổng kết Gate A vào `docs/handoff/log/`. | `NON-BLOCKING — PENDING OWNER RISK ACCEPTANCE` |

---

## 4. Chi tiết Phân tích Kỹ thuật của 5 Ghi chú `P3`

### 4.1. `GATEA-EXT-01` — Cơ chế Cho phép Port `5432` khi `CI=true` trong `validateTestDatabaseUrl()` (`G7-03`)
- **Vị trí:** [`apps/chat-web/tests/schedule-sheets-digest-v2-real-backend.test.tsx:78-89`](https://github.com/VinhDat267/ATI_Project/blob/b80c238941c4927cbd6c9b435816a4fdc6522f4e/apps/chat-web/tests/schedule-sheets-digest-v2-real-backend.test.tsx#L78-L89) (Commit `b80c238941c4927cbd6c9b435816a4fdc6522f4e`, `PR #299`)
- **Phân tích:**
  - Hàm `validateTestDatabaseUrl()` từ chối toàn bộ host không phải loopback, từ chối port runtime `55533`, từ chối database khác `/ati_v3`, và yêu cầu port dedicated `56534` ở môi trường local.
  - Khi `process.env.CI === 'true' || process.env.CI === '1'`, hàm cho phép `loopback:5432/ati_v3` để tương thích với container `postgres:16` trong `.github/workflows/v3-check.yml` (vốn bind `5432:5432` trên GitHub Actions runner).
  - Mỗi lần chạy test chỉ thao tác trong một schema ngẫu nhiên riêng biệt (`${prefix}_${randomUUID().replace(/-/g, '')}`) và chỉ `DROP SCHEMA` đúng schema đó.

### 4.2. `GATEA-EXT-02` — Quan sát Lỗi Secondary Cleanup khi Setup/Migration Lỗi Giữa Chừng (`G7-05`)
- **Vị trí:** [`apps/chat-web/tests/schedule-sheets-digest-v2-real-backend.test.tsx:171-195`](https://github.com/VinhDat267/ATI_Project/blob/b80c238941c4927cbd6c9b435816a4fdc6522f4e/apps/chat-web/tests/schedule-sheets-digest-v2-real-backend.test.tsx#L171-L195) (Commit `b80c238941c4927cbd6c9b435816a4fdc6522f4e`, `PR #299`)
- **Phân tích:**
  - Khi `runAllMigrations(pool)` gặp lỗi sau khi đã `CREATE SCHEMA "${ownedSchema}"`, khối `catch (setupErr)` đóng `pool` và thực thi `await admin.query('DROP SCHEMA IF EXISTS "' + ownedSchema + '" CASCADE')` trước khi `throw setupErr`.
  - Negative test #3 (`lines 791-864`) đã chứng minh trên PostgreSQL thật rằng khi DDL lỗi ở câu lệnh thứ 2, schema tạo dở (`midfail_cleanup_*`) được xóa sạch (`rowCount === 0`) và schema ngoại lai (`foreign_preserve_*`) được bảo toàn (`rowCount === 1`).

### 4.3. `GATEA-EXT-G5-01` — Hành vi `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT` trong `0033_sheets_digest_v2_remediation.sql` (`G5-01`, `G10-02`)
- **Vị trí:** [`db/v3/0033_sheets_digest_v2_remediation.sql:35-40`](https://github.com/VinhDat267/ATI_Project/blob/e3e1e2b86e7f2619844d9030f07c96f978051214/db/v3/0033_sheets_digest_v2_remediation.sql#L35-L40) (Commit `e3e1e2b86e7f2619844d9030f07c96f978051214`, `PR #292`)
- **Phân tích:**
  - Đã kiểm chứng chạy 2 lần liên tiếp trên schema cô lập (`feac_g501_rehearsal_0089c8dae284`) và qua `npm run db:migrate:v3` với thời gian thực thi `< 5ms` và `0` lỗi. Thực hiện trong khung giờ thấp điểm khi chạy trên production ở bước `G10-02`.

### 4.4. `GATEA-EXT-G5-02` — Phạm vi Kiểm tra `ENCRYPTION_KEY` Trước Khi Chạy Migration CLI (`G5-06`, `G10-03`)
- **Vị trí:** [`apps/chat-api/src/services/schedules/sheets-digest-v2-migration.ts:685-703`](https://github.com/VinhDat267/ATI_Project/blob/c7ef31cb761f74a5ce3a1afef525f30d60b742c1/apps/chat-api/src/services/schedules/sheets-digest-v2-migration.ts#L685-L703) (Commit `c7ef31cb761f74a5ce3a1afef525f30d60b742c1`, `PR #297`)
- **Phân tích:**
  - Trước khi chạy bất kỳ mode nào (`inventory`, `dry-run`, `apply`, `rollback`), `runSheetsDigestV2Migration` giải mã kiểm tra các bản ghi `service_credentials` đang `status = 'active'` để đảm bảo `ENCRYPTION_KEY` chính xác 100% trước khi phân loại hoặc mở transaction.

### 4.5. `GATEA-EXT-A02` — Tổ chức Tài liệu Handoff cho Chuỗi Task `RMD-00..RMD-04` (`G0-07`)
- **Vị trí:** [`docs/handoff/tasks/RMD-00-sheets-digest-baseline.md`](https://github.com/VinhDat267/ATI_Project/blob/dd7fd0b7b73a5e3f7d1ce26a4965694ca512780f/docs/handoff/tasks/RMD-00-sheets-digest-baseline.md) & [`docs/superpowers/plans/2026-11-08-sheets-digest-gate-a-remediation.md`](https://github.com/VinhDat267/ATI_Project/blob/dd7fd0b7b73a5e3f7d1ce26a4965694ca512780f/docs/superpowers/plans/2026-11-08-sheets-digest-gate-a-remediation.md)
- **Phân tích:**
  - Sau khi hoàn tất merge toàn bộ chuỗi `#289..#299` vào `main`, Reviewer cập nhật `docs/handoff/CURRENT-STATE.md`, `docs/handoff/ROADMAP.md` và thêm một bản ghi tổng kết Gate A vào `docs/handoff/log/` theo đúng `AGENTS.md` §4.5.

---

## 5. Đối chiếu Giữa Hai Trục Kiểm định (`Axis A` vs `Axis B` vs `DBA`)

- **Có sự bất đồng (Discrepancy) giữa các Independent Reviewers hay không?** **KHÔNG (`0` discrepancies).**
  - **Axis A (`64957501-7d8b-4d0c-9294-6fa8e12efd86`):** Xác nhận toàn bộ yêu cầu nghiệp vụ, schema V2, bounded window 500 dòng, 2-phase reauthorize preview/confirm, UI recovery, accessibility và 6 kịch bản UAT đều đạt **`PASS`** về mặt kỹ thuật, đồng thời tách bạch rõ các mục chờ Chủ dự án ký (`GATEA-EXT-A01`, `GATEA-EXT-A03`).
  - **Axis B (`0951905a-ae4e-452e-916f-25a832015181`):** Xác nhận toàn bộ ranh giới tenant, kiểm tra quyền từ DB tại thời điểm chạy, lock order chống deadlock, atomic pre-send claim `claimSheetsDigestDelivery`, bảo vệ chống gửi trùng `SHEETS_DELIVERY_UNKNOWN`, an toàn test database `validateTestDatabaseUrl()` và ma trận tích hợp 9 PR đều đạt **`PASS`** (`0 P0/P1/P2` lỗi kỹ thuật).
  - **DBA & Regression (`45925859-c525-440c-9554-aa7cee8d05e7`):** Xác nhận migration `0033` chạy 2 lần an toàn, CLI `inventory`/`dry-run` có `0` câu lệnh ghi DB, `apply`/`rollback` CAS bảo vệ lịch người dùng đã sửa và giữ nguyên trạng thái tạm dừng khi quyền bị thu hồi, và `214` file kiểm thử backend (`2,262` tests) + `116` file frontend (`1,207` tests) đều **`PASS`**.
