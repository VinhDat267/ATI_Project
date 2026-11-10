# GAS-REMEDIATION · Google Sheets & Scheduled Digest R2 Audit Remediation (`GAS-01` .. `GAS-12`)

**Trạng thái:** Đang thực hiện · **Nhánh:** `VinhDat267/sheets-gas-remediation-argon` · **Baseline SHA:** `2eed8d1d4309e833088d6f1d3fa774189049e283`

## 1. Mục tiêu & Phạm vi

Khắc phục triệt để 12 phát hiện từ báo cáo kiểm toán độc lập R2 (`GAS-01` → `GAS-12`) đối với Google Sheets (`mysheets` / `sheets`), Scheduled Digest (`sheets_digest`), và công cụ Google Drive/Docs đi kèm, tuân thủ chặt chẽ ranh giới sở hữu module theo 4 pha tuần tự:
1. **Phase 1 (`packages/tool-schemas` + Task Card):** Mở rộng hợp đồng kiểu dữ liệu (`SheetsDigestPreviewInfo.includeAiSummary`, `SheetsDigestDelivery` receipt & dispatch snapshot fields, `SheetsAppendLeaseStore`).
2. **Phase 2 (`db/v3` + `packages/tool-adapters`):**
   - Migration bổ sung `db/v3/0035_sheets_gas_r2_remediation.sql` (`schedule_runs.dispatched_config` / `dispatched_config_hash` + trigger snapshot tại thời điểm tạo/claim run; bảng `sheets_append_leases` điều phối ghi tuần tự liên tiến trình không giữ kết nối DB qua HTTP).
   - `GAS-01`: `SlackAdapter.sendMessage` kiểm tra nghiêm ngặt `typeof res?.ts === 'string' && res.ts.trim().length > 0`.
   - `GAS-06`: Hợp nhất `parseSheetNumber` / `parseSheetNumericCell` và đọc giá trị kiểu số (`valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`) kết hợp metadata `locale` (`vi_VN` / `en_US`) mà không đánh mất chuỗi hiển thị hay giới hạn đọc an toàn.
   - `GAS-07`: `computeSheetAggregation` lọc, gom nhóm (`groupBy`) và tính toán metric trên dữ liệu gốc chưa cắt; chỉ cắt nhãn hiển thị (`<= 500` ký tự) và truyền cờ `truncated: true`.
   - `GAS-10`: Điều phối tuần tự `append_rows` có khử trùng lặp (`deduplicate` / `keyColumn`) qua `SheetsAppendLeaseStore` (hỗ trợ cả đa instance trong tiến trình và đa worker qua PostgreSQL), đọc lại dữ liệu mới nhất sau khi giữ lease trước khi ghi.
   - `GAS-11`: Giữ mặc định `ENABLE_MYSHEETS_DRIVE_WRITE_TOOLS=false`; ngay cả khi bật `enableDriveWriteTools: true`, khóa mục tiêu `mysheets.move_drive_file` và `mysheets.append_doc_text` vào danh sách tài nguyên được phép (`allowedScope` hoặc tài liệu/thư mục vừa tạo trong phiên), chặn tệp ngoài danh sách với `403 AUTH_ERROR` (`requestSent: false`).
3. **Phase 3 (`apps/chat-api`):**
   - `GAS-01`: `SheetsDigestRunner.executeDigest` bắt buộc kiểm tra biên nhận (receipt) hợp lệ theo từng dịch vụ (`slack`, `gmail`, `telegram`) và khớp đích nhận trước khi ghi nhận `digest_sent`; thiếu/sai biên nhận phải chuyển sang `delivery_unknown` (`needs_attention`) và giữ nguyên dấu vết `delivery_started_at`.
   - `GAS-04`: `ScheduleRunner.executeDigestRun` ưu tiên lưu kết quả `digest_sent` (cùng biên nhận `delivery` và tin nhắn `sheets_digest_sent`) trước nhánh hủy bỏ do tạm dừng/hủy lịch/đổi `version` sau khi đã claim gửi.
   - `GAS-08`: Lưu bản chụp bất biến (`dispatched_config`, `dispatched_config_hash`, `delivery` khởi tạo) tại thời điểm claim run; `resolveRunDelivery('mark_sent')` luôn sử dụng bản chụp của đúng lượt chạy đó, tuyệt đối không lấy cấu hình lịch hiện tại đã bị chỉnh sửa.
   - `GAS-09`: `resolveRunDelivery('retry_new_run')` từ chối ngay từ đầu với `409 SCHEDULE_PAUSED` khi lịch đang `paused` (hoặc không `active`), không tiêu thụ một lần quyền xử lý khi chưa thể chạy lượt bù.
   - `GAS-05`: `analyzeSheetsDigestCandidate` trích xuất, chuẩn hóa, kiểm tra giới hạn (`<= 500` dòng dữ liệu, `<= 26` cột `A..Z`) và gắn `source.range` từ yêu cầu tự nhiên (giữ nguyên khi `createReauthorizePreview`); từ chối fail-closed (`canAutoDigest: false`, `requiresClarification: true`) nếu vùng ô vượt trần hoặc không hợp lệ.
   - `GAS-02`: Cho phép lựa chọn rõ ràng `includeAiSummary: boolean` khi tạo candidate, xác nhận lịch (`confirmProposal`) và cấp quyền lại (`createReauthorizePreview`), gắn vào `digest_config_hash`, giữ nguyên ngữ nghĩa các lịch cũ và bổ sung kiểm thử chống prompt injection.
   - `GAS-10`: Triển khai `PostgresSheetsAppendLeaseStore` trong `apps/chat-api` và tiêm vào `AdapterFactory`.
4. **Phase 4 (`apps/chat-web` + `scripts/` + Docs/Evidence):**
   - `GAS-02`, `GAS-09`, `GAS-11`: Cập nhật `ScheduleMoment.tsx` (tùy chọn bật/tắt tóm tắt AI và giải thích rõ dữ liệu gửi đi), `ScheduleRunRecovery.tsx` / `ScheduleSection.tsx` (hướng dẫn tiếp tục/cấp quyền lại lịch đang tạm dừng trước khi gửi bù), và `PrivacyPage.tsx` (công bố chính xác phạm vi OAuth `drive.file`, 2 công cụ đọc Drive/Docs, công tắc mặc định tắt cho 4 công cụ ghi Drive/Docs, và chính sách dữ liệu cho cả nguồn Cá nhân `mysheets` lẫn Tổ chức `sheets`).
   - `GAS-12`: Nối kịch bản `sheets_digest_v2_recovery` trong `scripts/test-v3-browser.mjs` và `.github/workflows/v3-check.yml`.
   - `GAS-03`: Bổ sung tài liệu checklist và mẫu biên bản nghiệm thu staging trung thực (`NOT_RUN`) tại `docs/ai-evidence/SHEETS-DIGEST-V2-STAGING-RUNBOOK.md`.

## 2. Kết quả

*(Sẽ điền sau khi hoàn tất toàn bộ 4 pha và chạy kiểm thử nghiệm thu)*
