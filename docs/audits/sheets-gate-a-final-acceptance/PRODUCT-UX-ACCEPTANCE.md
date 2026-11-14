# Google Sheets Digest Gate A — Product, UX & Real-User Workflow Acceptance (`PRODUCT-UX-ACCEPTANCE.md`)

- **Phiên bản báo cáo:** `FEAC v1.2 (GitHub Permalinks & Screenshot References Verified)`
- **Ngày kiểm toán:** `2026-11-09`
- **Auditor:** Independent Axis A Spec, Product & UX Compliance Reviewer (`64957501-7d8b-4d0c-9294-6fa8e12efd86`)
- **Cumulative Stack HEAD (`PR #299`):** `b80c238941c4927cbd6c9b435816a4fdc6522f4e`

---

## 1. Kiểm định 8 Hành trình Giao diện & Khả năng Tiếp cận (`Gate 6: G6-01..G6-08`)

| Hành trình | Yêu cầu Sản phẩm & UX | Vị trí Mã nguồn (`apps/chat-web/src/`) | Bằng chứng Kiểm thử & Ảnh Chụp Màn Hình Thực Tế (`Playwright`) | Trạng thái |
|---|---|---|---|---|
| **1 (`G6-01`)** | Hiển thị rõ lý do lịch V1 bị tạm dừng (`REAUTH_REQUIRED`) và nút CTA `"Xem trước & Cấp quyền lại"` dẫn tới đúng cuộc hội thoại | [`ScheduleSection.tsx:94-100, 128`](https://github.com/VinhDat267/ATI_Project/blob/b80c238941c4927cbd6c9b435816a4fdc6522f4e/apps/chat-web/src/pages/History/ScheduleSection.tsx#L94-L100), [`ScheduleActions.tsx:19, 37-87`](https://github.com/VinhDat267/ATI_Project/blob/b80c238941c4927cbd6c9b435816a4fdc6522f4e/apps/chat-web/src/pages/Cockpit/ScheduleActions.tsx#L37-L87) | `data-testid="btn-reauthorize-schedule-preview"` hiển thị ngay khi `status === 'paused'` có `REAUTH_PAUSE_REASON_RE` hoặc sau khi bấm `"Chạy tiếp"` trả về `409 REAUTHORIZATION_REQUIRED`. Ảnh chụp: [`01-history-paused-v1-reauth-cta-desktop.png`](./screenshots/01-history-paused-v1-reauth-cta-desktop.png) | **PASS** |
| **2 (`G6-02`)** | Reauthorization Preview hiển thị đầy đủ nguồn, chủ sở hữu, tên bảng tính, tab, vùng dữ liệu, kênh đích và cảnh báo liên không gian | [`ScheduleMoment.tsx:566-591`](https://github.com/VinhDat267/ATI_Project/blob/b80c238941c4927cbd6c9b435816a4fdc6522f4e/apps/chat-web/src/pages/Cockpit/ScheduleMoment.tsx#L566-L591) | `data-testid="sheets-digest-v2-preview"` và `data-testid="sheets-digest-cross-boundary-warning"` hiển thị rõ ràng trên cả Desktop (`1440x900`) và Mobile (`375x812`). Ảnh chụp: [`02-cockpit-reauthorize-preview-409-desktop.png`](./screenshots/02-cockpit-reauthorize-preview-409-desktop.png), [`03-cockpit-reauthorize-preview-mobile.png`](./screenshots/03-cockpit-reauthorize-preview-mobile.png) | **PASS** |
| **3 (`G6-02` / `G1-05`)** | Tuyệt đối không lộ `credentialId` UUID hoặc thông tin nhạy cảm trên giao diện | [`ScheduleMoment.tsx:566-591`](https://github.com/VinhDat267/ATI_Project/blob/b80c238941c4927cbd6c9b435816a4fdc6522f4e/apps/chat-web/src/pages/Cockpit/ScheduleMoment.tsx#L566-L591), [`sheets-digest-candidate.ts:187-260`](https://github.com/VinhDat267/ATI_Project/blob/e8e7ce31d950acd7dcdc915c65f175893d2770cf/apps/chat-api/src/services/schedules/sheets-digest-candidate.ts#L187-L260) | Kiểm chứng bằng `expect(bodyText).not.toContain(SOURCE_CRED_UUID)` và `not.toContain(DEST_CRED_UUID)` trong `schedule-sheets-digest-v2.test.tsx`, `schedule-sheets-digest-v2-real-backend.test.tsx` và `sheets-digest-v2-recovery.spec.ts`. | **PASS** |
| **4 (`G6-03`)** | Hiển thị đúng các trạng thái lỗi `409 STALE_PROPOSAL` / `DIGEST_PREVIEW_CHANGED` / `REAUTHORIZATION_NOT_READY` và tải lại hội thoại, không tự động tiếp tục | [`ScheduleMoment.tsx:145-167, 602`](https://github.com/VinhDat267/ATI_Project/blob/b80c238941c4927cbd6c9b435816a4fdc6522f4e/apps/chat-web/src/pages/Cockpit/ScheduleMoment.tsx#L145-L167), [`ScheduleActions.tsx:60-64, 87`](https://github.com/VinhDat267/ATI_Project/blob/b80c238941c4927cbd6c9b435816a4fdc6522f4e/apps/chat-web/src/pages/Cockpit/ScheduleActions.tsx#L60-L64) | Hiển thị `<p role="alert">Kết nối Google Sheets vừa được cập nhật, vui lòng kiểm tra lại và xác nhận.</p>` và gọi `reloadScheduleConversation(convId)`. Ảnh chụp: [`02-cockpit-reauthorize-preview-409-desktop.png`](./screenshots/02-cockpit-reauthorize-preview-409-desktop.png) | **PASS** |
| **5 (`G6-04` / `G4-08`)** | Giao diện khôi phục gửi báo cáo (`sheets-delivery-recovery-panel`) chỉ xuất hiện khi lượt chạy thực sự ở trạng thái `needs_attention` + `SHEETS_DELIVERY_UNKNOWN` + `deliveryStartedAt` + chưa xử lý | [`ScheduleRunRecovery.tsx:30-41`](https://github.com/VinhDat267/ATI_Project/blob/b80c238941c4927cbd6c9b435816a4fdc6522f4e/apps/chat-web/src/pages/Cockpit/ScheduleRunRecovery.tsx#L30-L41), [`ScheduleSection.tsx:95-112`](https://github.com/VinhDat267/ATI_Project/blob/b80c238941c4927cbd6c9b435816a4fdc6522f4e/apps/chat-web/src/pages/History/ScheduleSection.tsx#L95-L112) | Khi lỗi là `GMAIL_RATE_LIMIT` hoặc `SHEETS_READ_FAILED`, `sheets-delivery-recovery-panel` hoàn toàn không xuất hiện (`count = 0`). Ảnh chụp đối chứng: [`04-history-delivery-unknown-recovery-desktop.png`](./screenshots/04-history-delivery-unknown-recovery-desktop.png) vs [`06-history-non-unknown-gmail-rate-limit-guard.png`](./screenshots/06-history-non-unknown-gmail-rate-limit-guard.png) | **PASS** |
| **6 (`G6-05`)** | Phân biệt rõ hai hành động `"Tôi đã kiểm tra, báo cáo đã được gửi"` (`mark_sent`) và `"Chưa thấy báo cáo — gửi lại ở lượt chạy mới"` (`retry_new_run`) | [`ScheduleRunRecovery.tsx:118-163`](https://github.com/VinhDat267/ATI_Project/blob/b80c238941c4927cbd6c9b435816a4fdc6522f4e/apps/chat-web/src/pages/Cockpit/ScheduleRunRecovery.tsx#L118-L163) | Nút `btn-resolve-mark-sent` và `btn-resolve-retry-new-run` có nhãn tiếng Việt rõ ràng; ẩn hoàn toàn nút `"Lập lại kế hoạch"` (`canReplan = false`) đối với lượt chạy không rõ trạng thái gửi. | **PASS** |
| **7 (`G6-05`)** | Bắt buộc tích chọn checkbox xác nhận nguy cơ gửi trùng trước khi bật nút `retry_new_run`, và tự động reset checkbox khi đổi sang lượt chạy khác | [`ScheduleRunRecovery.tsx:60-63, 138-162`](https://github.com/VinhDat267/ATI_Project/blob/b80c238941c4927cbd6c9b435816a4fdc6522f4e/apps/chat-web/src/pages/Cockpit/ScheduleRunRecovery.tsx#L60-L63) | `btn-resolve-retry-new-run` bị `disabled` khi chưa tích `checkbox-confirm-duplicate-risk`; `useEffect` reset `confirmDuplicateRisk = false` khi `[run.id, run.deliveryResolution]` thay đổi. | **PASS** |
| **8 (`G6-06` / `G6-08`)** | Sau khi xử lý, ẩn các nút thao tác và hiển thị huy hiệu audit (`delivery-resolution-badge`) kèm thời gian và mã lượt chạy bù (`deliveryFollowupRunId`); phân biệt rõ provenance kiểm thử | [`ScheduleRunRecovery.tsx:65-91`](https://github.com/VinhDat267/ATI_Project/blob/b80c238941c4927cbd6c9b435816a4fdc6522f4e/apps/chat-web/src/pages/Cockpit/ScheduleRunRecovery.tsx#L65-L91) | Hiển thị `"Đã tạo lượt gửi bù mới · Mã lượt chạy bù: run-followup-e2e-2"` hoặc `"Đã xác nhận thủ công là đã gửi"`. Ảnh chụp: [`05-history-delivery-resolved-badge-desktop.png`](./screenshots/05-history-delivery-resolved-badge-desktop.png) | **PASS** |

---

## 2. Nghiệm thu 6 Kịch bản Người Dùng Thực Tế (`Gate 8B: UAT-01..UAT-06`)

### `UAT-01`: Tạo & Chạy Báo cáo Định kỳ Google Sheets Cá nhân → Gmail Cá nhân
- **Thiết lập:** Bảng tính cá nhân (`mysheets`), tài khoản gửi Gmail (`senderEmail`) và địa chỉ nhận (`recipientEmail`) được pin trong `SheetsDigestConfigV2`, múi giờ và giờ chạy cố định.
- **Hành vi đã kiểm chứng (`REAL_BACKEND_POSTGRES_INTEGRATION` + `MOCKED_API_E2E`):**
  - Bước Preview (`buildSheetsDigestPreviewInfo`) hiển thị đúng tên bảng tính, tab, phạm vi ô (`A1:F50`), email chủ sở hữu bảng tính, email tài khoản Gmail gửi và email người nhận mà không lộ UUID credential.
  - Bước Confirm (`verifySheetsDigestCandidateInTx`) khóa `FOR SHARE` các dòng `service_credentials` và lưu `digest_config` v2 cùng `digest_config_hash`.
  - Khi đến hạn chạy (`executeSheetsDigestRun`), Runner đọc cửa sổ dữ liệu giới hạn (`readDigestWindow`), yêu cầu `claimSheetsDigestDelivery` ghi `delivery_started_at` nguyên tử rồi mới gửi qua đúng `senderEmail` tới `recipientEmail`.
- **Bằng chứng:** [`sheets-digest-candidate-v2.test.ts:157-177, 424-480`](https://github.com/VinhDat267/ATI_Project/blob/e8e7ce31d950acd7dcdc915c65f175893d2770cf/apps/chat-api/tests/services/sheets-digest-candidate-v2.test.ts#L157-L177), [`sheets-digest-e2e-pipeline.test.ts:269-333`](https://github.com/VinhDat267/ATI_Project/blob/e8e7ce31d950acd7dcdc915c65f175893d2770cf/apps/chat-api/tests/services/sheets-digest-e2e-pipeline.test.ts#L269-L333), [`schedule-sheets-digest-v2-real-backend.test.tsx:411-578`](https://github.com/VinhDat267/ATI_Project/blob/b80c238941c4927cbd6c9b435816a4fdc6522f4e/apps/chat-web/tests/schedule-sheets-digest-v2-real-backend.test.tsx#L411-L578).
- **Trạng thái:** **`PASS` (`REAL_BACKEND_POSTGRES_INTEGRATION` + `MOCKED_API_E2E`)** | `LIVE_PROVIDER_VERIFIED`: `NOT_TESTED`.

---

### `UAT-02`: Cô lập Dữ liệu Tổ chức (`Organization Isolation`), Hỗ trợ Song song `sheets` + `mysheets`, và Chặn Rò rỉ Ra Ngoài (`ORG_DATA_EGRESS_FORBIDDEN`)
- **Thiết lập:** Hai Workspace Tổ chức A và B; người dùng chỉ thuộc Workspace A; kết nối cả `sheets` dùng chung của Tổ chức A và `mysheets` cá nhân.
- **Hành vi đã kiểm chứng (`REAL_BACKEND_POSTGRES_INTEGRATION`):**
  1. Trong chế độ Tổ chức (`workspaceMode === 'organization'`), [`gmail-tools-runtime.ts:78-107`](https://github.com/VinhDat267/ATI_Project/blob/e8e7ce31d950acd7dcdc915c65f175893d2770cf/apps/chat-api/src/config/gmail-tools-runtime.ts#L78-L107) giữ nguyên cả công cụ `sheets.*` của Tổ chức lẫn `mysheets.*` cá nhân (`stripSharedSheets = hasMySheetsSpreadsheets && !isOrgMode`).
  2. Mọi nỗ lực đọc bảng tính thuộc Tổ chức B đều bị chặn với `0` lệnh gọi HTTP.
  3. Nếu nguồn dữ liệu là bảng tính của Tổ chức (`service: 'sheets'`), việc gửi báo cáo ra kênh cá nhân (`gmail` hoặc `telegram` cá nhân) bị chặn cứng với mã lỗi `ORG_DATA_EGRESS_FORBIDDEN`.
  4. Ngược lại, nếu trong Tổ chức người dùng chọn đọc bảng tính cá nhân (`mysheets`) để gửi vào kênh của Tổ chức (`slack` hoặc `gmail`), hệ thống cho phép kèm cảnh báo rõ ràng trên Preview (`crossBoundaryWarning`).
- **Bằng chứng:** [`sheets-digest-candidate-v2.test.ts:69-154, 209-244, 388-423, 482-514`](https://github.com/VinhDat267/ATI_Project/blob/e8e7ce31d950acd7dcdc915c65f175893d2770cf/apps/chat-api/tests/services/sheets-digest-candidate-v2.test.ts#L69-L154), [`sheets-digest-e2e-pipeline.test.ts:205-237, 299-333`](https://github.com/VinhDat267/ATI_Project/blob/e8e7ce31d950acd7dcdc915c65f175893d2770cf/apps/chat-api/tests/services/sheets-digest-e2e-pipeline.test.ts#L205-L237).
- **Trạng thái:** **`PASS` (`REAL_BACKEND_POSTGRES_INTEGRATION`)** | `LIVE_PROVIDER_VERIFIED`: `NOT_TESTED`.

---

### `UAT-03`: Thu hồi Quyền (`Revoke Credential` / `Narrow Scope` / `Remove Member`) Sau Khi Đã Xác Nhận Lịch V2
- **Thiết lập:** Lịch V2 đang `active`; sau đó chủ sở hữu thu hồi OAuth credential, thu hẹp `allowed_scope` (bỏ chọn bảng tính hoặc kênh đích), hoặc bị xóa khỏi Workspace Tổ chức (kể cả ngay trong lúc Runner đang đọc dữ liệu từ Google Sheets).
- **Hành vi đã kiểm chứng (`REAL_BACKEND_POSTGRES_INTEGRATION`):**
  - Nếu thu hồi trước khi chạy hoặc trước bước `claimSheetsDigestDelivery` (`T_revoke < T_claim`): `claimSheetsDigestDelivery` kiểm tra lại `users`, `workspace_members` và `service_credentials` dưới khóa `FOR SHARE NOWAIT` trong transaction, từ chối cấp quyền gửi, chuyển lịch sang `status = 'paused'` với `pause_reason = 'REAUTH_REQUIRED: ...'`, phát thông báo `schedule_state` vào cuộc hội thoại, và đảm bảo **`0` lượt gửi ra ngoài** (không bao giờ fallback sang credential khác).
- **Bằng chứng:** [`sheets-digest-concurrency.test.ts:1160-1499`](https://github.com/VinhDat267/ATI_Project/blob/e3e1e2b86e7f2619844d9030f07c96f978051214/apps/chat-api/tests/services/sheets-digest-concurrency.test.ts#L1160-L1499) (`TC-05`, `TC-06`, `TC-07`).
- **Trạng thái:** **`PASS` (`REAL_BACKEND_POSTGRES_INTEGRATION`)**.

---

### `UAT-04`: Lịch Legacy V1 Bị Tạm Dừng → Chặn `Resume` Thường → Cấp Quyền Lại Hai Pha (`Reauthorize Preview & Confirm`)
- **Thiết lập:** Lịch V1 đang bị tạm dừng bởi chính sách `strict_pause_all` hoặc do thiếu `credentialId` ghim sẵn.
- **Hành vi đã kiểm chứng (`REAL_BACKEND_POSTGRES_INTEGRATION` + `MOCKED_API_E2E`):**
  - Khi bấm `"Chạy tiếp"` (`POST /api/schedules/:id/resume`), API từ chối với `409 REAUTHORIZATION_REQUIRED` và không tự ý nâng cấp hay gắn credential.
  - Giao diện hiển thị nút `"Xem trước & Cấp quyền lại"`. Khi bấm nút này, hệ thống tạo bản xem trước V2 mới trong cuộc hội thoại (`POST /api/schedules/:id/reauthorize-preview`).
  - Sau khi người dùng kiểm tra thông tin nguồn/đích và bấm `"Xác nhận"`, lịch được nâng cấp nguyên tử lên `version: 2`, lưu `digest_config_hash`, xóa `pause_reason` và chuyển sang `status = 'active'`.
- **Bằng chứng:** [`sheets-digest-reauthorize.test.ts:150-718`](https://github.com/VinhDat267/ATI_Project/blob/d97574f81a509c471ca81d21631e2ca757adfe60/apps/chat-api/tests/services/sheets-digest-reauthorize.test.ts#L150-L718), [`schedule-sheets-digest-v2-real-backend.test.tsx:482-578`](https://github.com/VinhDat267/ATI_Project/blob/b80c238941c4927cbd6c9b435816a4fdc6522f4e/apps/chat-web/tests/schedule-sheets-digest-v2-real-backend.test.tsx#L482-L578), [`sheets-digest-v2-recovery.spec.ts:449-489`](https://github.com/VinhDat267/ATI_Project/blob/b80c238941c4927cbd6c9b435816a4fdc6522f4e/apps/chat-web/tests/browser/sheets-digest-v2-recovery.spec.ts#L449-L489).
- **Trạng thái:** **`PASS` (`REAL_BACKEND_POSTGRES_INTEGRATION` + `MOCKED_API_E2E`)**.

---

### `UAT-05`: Mất Kết Nối Sau Khi Bắt Đầu Gửi (`SHEETS_DELIVERY_UNKNOWN`) → Khôi Phục Thủ Công An Toàn (`mark_sent` & `retry_new_run`)
- **Thiết lập:** Sau khi `claimSheetsDigestDelivery` đã ghi `delivery_started_at`, kết nối tới Slack/Gmail bị đứt giữa chừng (socket hang up / HTTP 502 / thiếu `ts` hoặc `messageId`).
- **Hành vi đã kiểm chứng (`REAL_BACKEND_POSTGRES_INTEGRATION` + `MOCKED_API_E2E`):**
  - Runner **không tự động gửi lại** (`1` lần gọi duy nhất tới provider), chuyển lượt chạy sang `needs_attention` với mã lỗi `SHEETS_DELIVERY_UNKNOWN`.
  - Mọi yêu cầu `replan` tự động hoặc thủ công trên lượt chạy này đều bị chặn với `409`.
  - Trên giao diện, người dùng có 2 lựa chọn:
    1. Bấm `"Tôi đã kiểm tra, báo cáo đã được gửi"` (`mark_sent`): lưu xác nhận thủ công (`delivery_resolution = 'confirmed_sent'`, `manualConfirmedAt`), giữ nguyên `completed_at = null`, `rowCount = null`, không bịa đặt `slackMessageTs` hay `gmailMessageId`.
    2. Tích chọn checkbox xác nhận nguy cơ gửi trùng rồi bấm `"Chưa thấy báo cáo — gửi lại ở lượt chạy mới"` (`retry_new_run`): giữ nguyên biên bản của lượt chạy cũ (`delivery_resolution = 'retried_new_run'`, `delivery_followup_run_id = <newRunId>`) và tạo một lượt chạy mới độc lập sau khi `COMMIT`.
- **Bằng chứng:** [`sheets-digest-concurrency.test.ts:1502-1750`](https://github.com/VinhDat267/ATI_Project/blob/e3e1e2b86e7f2619844d9030f07c96f978051214/apps/chat-api/tests/services/sheets-digest-concurrency.test.ts#L1502-L1750), [`sheets-digest-delivery-recovery.test.ts:244-801`](https://github.com/VinhDat267/ATI_Project/blob/84057251564b9d88cc0da642ba4cf171c9701074/apps/chat-api/tests/services/sheets-digest-delivery-recovery.test.ts#L244-L801), [`schedule-sheets-digest-v2-real-backend.test.tsx:580-722`](https://github.com/VinhDat267/ATI_Project/blob/b80c238941c4927cbd6c9b435816a4fdc6522f4e/apps/chat-web/tests/schedule-sheets-digest-v2-real-backend.test.tsx#L580-L722).
- **Trạng thái:** **`PASS` (`REAL_BACKEND_POSTGRES_INTEGRATION` + `MOCKED_API_E2E`)**.

---

### `UAT-06`: Chung Sống Đa Dịch Vụ (`Multi-Service Coexistence`)
- **Thiết lập:** Các lịch `plan`, `calendar_digest`, `notion_digest`, `trello_digest`, `github_digest`, `jira_digest`, `telegram_digest` chạy song song cùng lịch `sheets_digest`.
- **Hành vi đã kiểm chứng (`REAL_BACKEND_POSTGRES_INTEGRATION`):**
  - Các endpoint `reauthorize-preview`, `confirmProposal(reauthorize)`, `resolve-delivery` và công cụ CLI `sheets-digest-v2-migrate` đều kiểm tra nghiêm ngặt `schedule.kind === 'sheets_digest'`.
  - Toàn bộ `198` file kiểm thử của các dịch vụ lân cận (`2,226` tests) đều chạy xanh (`0` lỗi), chứng minh không có bất kỳ lịch trình thuộc dịch vụ khác bị pause, đổi người nhận hay biến thành `sheets_digest`.
- **Bằng chứng:** [`sheets-digest-reauthorize.test.ts:720-890`](https://github.com/VinhDat267/ATI_Project/blob/d97574f81a509c471ca81d21631e2ca757adfe60/apps/chat-api/tests/services/sheets-digest-reauthorize.test.ts#L720-L890), [`sheets-digest-delivery-recovery.test.ts:620-740`](https://github.com/VinhDat267/ATI_Project/blob/84057251564b9d88cc0da642ba4cf171c9701074/apps/chat-api/tests/services/sheets-digest-delivery-recovery.test.ts#L620-L740), [`sheets-digest-v2-migration.test.ts`](https://github.com/VinhDat267/ATI_Project/blob/c7ef31cb761f74a5ce3a1afef525f30d60b742c1/apps/chat-api/tests/services/sheets-digest-v2-migration.test.ts) test #6b, và bộ kiểm thử Gate 8 (`TEST-AND-CI-EVIDENCE.md`).
- **Trạng thái:** **`PASS` (`REAL_BACKEND_POSTGRES_INTEGRATION`)**.
