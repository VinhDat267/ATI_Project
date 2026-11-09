# Google Sheets Digest Gate A — Migration, Inventory & CAS Rollback Review (`MIGRATION-AND-ROLLBACK-REVIEW.md`)

- **Ngày kiểm toán:** `2026-11-09`
- **Auditor:** Independent DBA & Reliability Reviewer (`45925859-c525-440c-9554-aa7cee8d05e7`)
- **Phạm vi kiểm định:**
  - [`db/v3/0033_sheets_digest_v2_remediation.sql`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/db/v3/0033_sheets_digest_v2_remediation.sql#L1-L40) (`PR #292`, SHA `e3e1e2b86e7f2619844d9030f07c96f978051214`)
  - [`apps/chat-api/src/services/schedules/sheets-digest-v2-migration.ts`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/apps/chat-api/src/services/schedules/sheets-digest-v2-migration.ts#L1-L1391) (`PR #297`, SHA `c7ef31cb761f74a5ce3a1afef525f30d60b742c1`)
  - [`apps/chat-api/src/scripts/sheets-digest-v2-migrate.ts`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/apps/chat-api/src/scripts/sheets-digest-v2-migrate.ts#L1-L160) (`PR #297`, SHA `c7ef31cb761f74a5ce3a1afef525f30d60b742c1`)
  - [`apps/chat-api/tests/services/sheets-digest-v2-migration.test.ts`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/apps/chat-api/tests/services/sheets-digest-v2-migration.test.ts) (`13/13` tests PASS)

---

## 1. Kiểm định Schema DDL `0033_sheets_digest_v2_remediation.sql` (`G5-01`)

### 1.1. Cấu trúc DDL & Tính Idempotent
1. **Bảng kiểm toán `sheets_digest_v2_migration_audit` ([`lines 4-26`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/db/v3/0033_sheets_digest_v2_remediation.sql#L4-L26)):**
   - Lưu trữ đầy đủ trạng thái trước và sau migration: `schedule_id` (`UNIQUE`), `user_id`, `workspace_mode`, `workspace_id`, `prev_status`, `prev_pause_reason`, `prev_digest_config`, `prev_digest_hash`, `prev_schedule_version`, `outcome` (`CHECK (outcome IN ('upgraded_v2', 'paused_reauth_required', 'already_v2', 'inactive_preserved'))`), `reason_code`, `reason_detail`, `new_digest_config`, `new_digest_hash`, `migrated_schedule_ver`, `migrated_at`, `rolled_back_at`, `rollback_outcome`.
2. **Các cột theo dõi gửi báo cáo trên `schedule_runs` ([`lines 28-40`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/db/v3/0033_sheets_digest_v2_remediation.sql#L28-L40)):**
   - `delivery_started_at TIMESTAMPTZ` (write-once CAS qua `claimSheetsDigestDelivery`).
   - `delivery_resolution TEXT` với ràng buộc `CHECK (delivery_resolution IS NULL OR delivery_resolution IN ('confirmed_sent', 'retried_new_run'))`.
   - `delivery_resolved_at TIMESTAMPTZ`, `delivery_resolved_by UUID REFERENCES users(id) ON DELETE SET NULL`, `delivery_followup_run_id UUID REFERENCES schedule_runs(id) ON DELETE SET NULL`.
3. **Bằng chứng Chạy Thực Tế 2 Lần Liên Tiếp (`G5-01`):**
   - Thực thi 2 lần liên tiếp trên schema cô lập `feac_g501_rehearsal_0089c8dae284` và chạy `npm run db:migrate:v3` 2 lần liên tiếp trên `127.0.0.1:56534/ati_v3`:
     - `PASS_1_0033: OK`, `PASS_2_0033: OK`
     - `ZERO_SCHEDULE_MUTATION: true` (DDL hoàn toàn additive, không tự ý sửa hay pause bất kỳ dòng nào trong `schedules` hay `schedule_runs`).
     - Các ràng buộc `CHECK` và `UNIQUE` chặn chính xác mọi giá trị `outcome` và `delivery_resolution` không hợp lệ (`OUTCOME_CHECK_ENFORCED: true`, `DELIVERY_RESOLUTION_CHECK_ENFORCED: true`).

---

## 2. Phân loại Tương thích V1 & Chính sách Fail-Closed (`G5-02`, `G5-03`, `G5-04`)

### 2.1. Hai Nhóm Lịch V1 (`Class A` vs `Class B`)
- **Class A (`v1_pinned_consistency_candidate` — [`lines 196-392`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/apps/chat-api/src/services/schedules/sheets-digest-v2-migration.ts#L196-L392)):**
  - Chỉ đạt khi thỏa mãn đồng thời cả **6 điều kiện**:
    1. Lịch thuộc chế độ cá nhân (`workspace_mode = 'personal'`, `workspace_id IS NULL`) và `user.status = 'active'`.
    2. `source.credentialId` đã được ghim sẵn trong V1 config, tồn tại trong `service_credentials` của đúng `user_id` với `status = 'active'`, `workspace_mode = 'personal'`, `created_at <= schedule.created_at`.
    3. Giải mã được `source` credential, có email hợp lệ, và `spreadsheetId` nằm trong `allowed_scope.spreadsheets` (không phải Drive-only).
    4. `destination.credentialId` đã được ghim sẵn trong V1 config, tồn tại trong `service_credentials` của đúng `user_id` với `status = 'active'`, `workspace_mode = 'personal'`, `created_at <= schedule.created_at`.
    5. Nếu đích là `gmail`, giải mã được email người gửi và có `recipientEmail` hợp lệ; nếu đích là `slack`, `channelId` nằm trong `allowed_scope.channels`; nếu đích là `telegram`, `chatId` nằm trong `allowed_scope.chats`.
    6. Không thiếu bất kỳ trường bắt buộc nào (tuyệt đối **không tự suy đoán hay điền bù `credentialId` / `senderEmail`**).
  - **Ranh giới Bằng chứng Trung thực (`evidenceBoundary`):**
    - Được gắn nhãn rõ ràng là `'consistency_only_not_config_immutability_proof'` kèm ghi chú `SHEETS_DIGEST_V2_EVIDENCE_BOUNDARY_NOTE` ([`lines 25-26`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/apps/chat-api/src/services/schedules/sheets-digest-v2-migration.ts#L25-L26)): vì bảng `service_credentials` trước migration `0033` không có cột `updated_at` hay lịch sử thay đổi scope, Class A chỉ chứng minh tính nhất quán tại thời điểm kiểm tra chứ **không chứng minh cấu hình credential chưa từng thay đổi**.
- **Class B (`v1_unpinned_fail_closed`):**
  - Mọi lịch V1 thiếu `credentialId`, thuộc `organization`, hoặc không khớp scope/owner đều thuộc Class B (`evidenceBoundary: 'unpinned_or_inconsistent'`) và **luôn luôn bị chuyển sang `paused_reauth_required`** dưới mọi chính sách.

### 2.2. Chính sách Mặc định `strict_pause_all` (`G5-04`)
- Mặc định trong cả Runner ([`sheets-digest-runner.ts:325-330`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/apps/chat-api/src/services/schedules/sheets-digest-runner.ts#L325-L330)) và Migration CLI ([`sheets-digest-v2-migration.ts:648-653`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/apps/chat-api/src/services/schedules/sheets-digest-v2-migration.ts#L648-L653)) là **`strict_pause_all`** (fail-closed cho cả Class A và Class B).
- Chế độ `allow_consistency_candidate` chỉ có thể được bật tường minh sau khi chạy `--mode=inventory` (`G10-03`) và có chữ ký phê duyệt của Chủ dự án (`G5-04` / `G10-04`).

---

## 3. Bảo vệ Chống Ghi Đè Audit, Chặn Tham Số Sai & Kiểm Tra Khóa Mã Hóa (`G5-05..G5-08`)

1. **Chứng minh `0` DB Writes cho `--mode=inventory` và `--mode=dry-run` (`G5-02`):**
   - Trong buổi diễn tập trực tiếp trên schema `feac_g511_g512_cli`, bộ chặn truy vấn SQL trên `pg.Pool` ghi nhận đúng **`9` câu lệnh `SELECT` và `0` câu lệnh `INSERT`/`UPDATE`/`DELETE`** khi chạy `--mode=inventory` và `--mode=dry-run`.
2. **Chặn `--schedule-id` không hợp lệ và thiếu cờ xác nhận (`G5-05`):**
   - `parseScheduleIdFlag()` ([`sheets-digest-v2-migrate.ts:28-38`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/apps/chat-api/src/scripts/sheets-digest-v2-migrate.ts#L28-L38)) và `runSheetsDigestV2Migration()` ([`sheets-digest-v2-migration.ts:636-646`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/apps/chat-api/src/services/schedules/sheets-digest-v2-migration.ts#L636-L646)) kiểm tra biểu thức chính quy UUID nghiêm ngặt; nếu `--schedule-id` rỗng, thiếu giá trị, bắt đầu bằng `--`, hoặc không phải UUID hợp lệ, hàm ném ngay `INVALID_SCHEDULE_ID` trước khi mở kết nối DB — tuyệt đối không biến thành quét toàn bộ lịch.
   - `mode === 'apply'` bắt buộc `--confirm-production-apply` (`CONFIRM_PRODUCTION_APPLY_REQUIRED`); `mode === 'rollback'` bắt buộc `--confirm-production-rollback` (`CONFIRM_PRODUCTION_ROLLBACK_REQUIRED`).
3. **Kiểm tra `ENCRYPTION_KEY` trước mọi biến đổi DB (`G5-06`):**
   - [`sheets-digest-v2-migration.ts:671-703`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/apps/chat-api/src/services/schedules/sheets-digest-v2-migration.ts#L671-L703) kiểm tra sự tồn tại của `ENCRYPTION_KEY` (`MISSING_ENCRYPTION_KEY`) và giải mã thử các `service_credentials` active (`INVALID_ENCRYPTION_KEY`) trước khi mở bất kỳ transaction nào.
4. **Bảo toàn Bất biến cho Active Audit Snapshot khi Chạy Lại `apply` (`G5-07`):**
   - Nếu một lịch đã được `apply` lần 1 (`outcome = 'upgraded_v2'` hoặc `'paused_reauth_required'`, `rolled_back_at IS NULL`), khi chạy `apply` lần 2:
     - Kiểm tra trong transaction ([`lines 1115-1125, 1167-1183`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/apps/chat-api/src/services/schedules/sheets-digest-v2-migration.ts#L1115-L1125)) phát hiện `hasActiveAuditSnapshot = true` và **bỏ qua việc ghi đè `sheets_digest_v2_migration_audit`**.
     - Đồng thời, câu lệnh `upsertAuditRow()` ([`lines 548-627`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/apps/chat-api/src/services/schedules/sheets-digest-v2-migration.ts#L548-L627)) có điều kiện `ON CONFLICT (schedule_id) DO UPDATE ... WHERE sheets_digest_v2_migration_audit.rolled_back_at IS NOT NULL`.
     - Nhờ bảo vệ kép này, chuỗi **`apply` lần 1 → `apply` lần 2 → `rollback`** luôn khôi phục chính xác trạng thái V1 ban đầu của lần 1 (đã kiểm chứng tại `sheets-digest-v2-migration.test.ts` test #8 & #9).

---

## 4. Cơ chế CAS Rollback & Bảo vệ Quyền Đã Thu Hồi (`G5-09`, `G5-10`, `G5-12`, `G10-10`)

Khi chạy `--mode=rollback --confirm-production-rollback` ([`sheets-digest-v2-migration.ts:722-977`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/apps/chat-api/src/services/schedules/sheets-digest-v2-migration.ts#L722-L977)):
1. **Thứ tự Khóa Chuẩn (Canonical Lock Order):**
   - Khóa `conversations FOR UPDATE` → `schedules FOR UPDATE` → `sheets_digest_v2_migration_audit FOR UPDATE` → `users FOR SHARE` → `workspace_members FOR SHARE` → `service_credentials FOR SHARE`.
2. **Bảo vệ Lịch Đã Được Người Dùng Sửa Hoặc Cấp Quyền Lại (`skipped_user_modified`):**
   - Nếu `schedule.version !== audit.migrated_schedule_ver` hoặc `schedule.kind !== 'sheets_digest'` (ví dụ: người dùng đã bấm "Xem trước & Cấp quyền lại" sang V2 mới hoặc chỉnh sửa lịch sau khi migration), `rollback` **không chạm vào dòng `schedules`**, chỉ ghi nhận `rollback_outcome = 'skipped_user_modified'` và `rolled_back_at = NOW()`.
3. **Bảo vệ Khi Quyền Hoặc Thành Viên Đã Bị Thu Hồi Sau Migration (`restored_paused_due_to_revocation`):**
   - Ngay cả khi `prev_status = 'active'`, `rollback` kiểm tra trực tiếp trạng thái hiện tại của `users`, `workspace_members` và `service_credentials` trong DB. Nếu tài khoản/thành viên không còn active hoặc credential đã bị thu hồi/thu hẹp scope sau thời điểm migration, `rollback` chỉ khôi phục `prev_digest_config` nhưng **bắt buộc giữ `status = 'paused'`** với `pause_reason = 'REAUTH_REQUIRED: ...'` và ghi `rollback_outcome = 'restored_paused_due_to_revocation'`. Tuyệt đối không bao giờ tự kích hoạt lại một lịch đã mất quyền.
4. **Kết quả Diễn tập Thực tế (`G5-11`, `G5-12`):**
   - Trên tập dữ liệu diễn tập 6 lịch (`3` Class A, `2` Class B, `1` V2):
     - Sau `apply` (`allow_consistency_candidate`): `upgraded_v2: 3`, `paused_reauth_required: 1`, `already_v2: 1`, `inactive_preserved: 1`.
     - Mô phỏng sau migration: (a) 1 lịch Class A được người dùng reauthorize (`version` tăng); (b) 1 lịch Class A bị thu hồi credential.
     - Khi chạy `rollback`: kết quả chính xác tuyệt đối là **`restored_previous_state: 1`**, **`restored_paused_due_to_revocation: 2`**, **`skipped_user_modified: 1`**.

---

## 5. Điều kiện Dừng Khẩn Cấp (Stop Rules) cho Gate 10 Production Rollout (`G10-08`, `G10-09`)

Khi chuyển sang giai đoạn **Gate 10 (Sau khi Merge)**, bất kỳ dấu hiệu nào dưới đây đều kích hoạt **HALT NGAY LẬP TỨC** (tắt `SHEETS_DIGEST_EMIT_V2=false`, giữ `SHEETS_DIGEST_V2_MODE=compat`, dừng migration):
1. Phát hiện bất kỳ truy cập chéo tenant hoặc gửi nhầm người nhận (`0` tolerance).
2. Xuất hiện biên nhận gửi báo cáo giả tạo khi provider chưa trả về ID hợp lệ (`ts` / `messageId`).
3. Hệ thống tự động gửi lại báo cáo khi một lượt chạy đang ở trạng thái `SHEETS_DELIVERY_UNKNOWN`.
4. Số lượng lịch V1 bị pause vượt ngoài thống kê đã ký trong báo cáo `--mode=inventory` (`G10-03`).
5. Xung đột khóa DB (`55P03` / deadlock) hoặc sai lệch CAS trong quá trình `apply` / `rollback`.
